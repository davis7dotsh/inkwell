import AuthenticationServices
import Foundation
import Observation
import OSLog
import Security
import UIKit

enum OAuthProvider: String, CaseIterable, Identifiable {
    case github, google

    var id: String { rawValue }
    var name: String { self == .github ? "GitHub" : "Google" }
    var strategy: String { "oauth_\(rawValue)" }
}

/// Implements Clerk's native Frontend API protocol with the same device-token,
/// rotating-nonce, and transfer flow used by ClerkKit. Credentials stay in Keychain;
/// browser cookies and URLs are never treated as proof of a signed-in session.
@MainActor @Observable
final class Authentication {
    private(set) var userID: String?
    private(set) var isLoading = true
    private(set) var needsSecondFactor = false
    var error: String?
    var isSignedIn: Bool { userID != nil }

    @ObservationIgnored private let configuration: AppConfiguration
    @ObservationIgnored private let baseURL: URL?
    @ObservationIgnored private let keychain: AuthKeychain
    @ObservationIgnored private let network: URLSession
    @ObservationIgnored private var credentials: AuthCredentials
    @ObservationIgnored private var browser: AuthBrowserSession?
    @ObservationIgnored private var pendingSignIn: ClerkSignIn?
    @ObservationIgnored private var tokenRequests: [String: Task<String, Error>] = [:]
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var requestSequence = 0
    @ObservationIgnored private var appliedSequence = 0

    init(configuration: AppConfiguration) {
        self.configuration = configuration
        baseURL = Self.frontendURL(for: configuration.clerkPublishableKey)
        keychain = AuthKeychain(instance: baseURL?.host ?? "unconfigured")
        credentials = (try? keychain.load()) ?? AuthCredentials()
        // An identity saved after a server-verified login permits cached reading
        // while offline. Every API call still requires a live, unexpired JWT.
        userID = credentials.userID
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.timeoutIntervalForRequest = 30
        sessionConfiguration.httpCookieAcceptPolicy = .never
        network = URLSession(configuration: sessionConfiguration)
    }

    func restoreSession() async {
        guard browser == nil else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let reply: ClerkReply<ClerkClient?> = try await request("/v1/client")
            try applySession(from: reply.response)
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signIn(provider: OAuthProvider) async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        pendingSignIn = nil
        needsSecondFactor = false
        defer { isLoading = false }
        do {
            // Keep the callback already authorized in the deployed Clerk instances:
            // Expo AuthSession.makeRedirectUri() used the bare custom scheme.
            let redirect = "\(configuration.callbackScheme)://"
            let parameters = ["strategy": provider.strategy, "redirect_url": redirect]
            let created: ClerkReply<ClerkSignIn> = try await request("/v1/client/sign_ins", method: "POST", form: parameters)
            let prepared: ClerkReply<ClerkSignIn> = try await request(
                "/v1/client/sign_ins/\(segment(created.response.id))/prepare_first_factor",
                method: "POST", form: parameters
            )
            guard let redirectString = prepared.response.firstFactorVerification?.externalVerificationRedirectUrl,
                  let redirectURL = URL(string: redirectString), redirectURL.scheme == "https" else {
                throw AuthFailure("The sign-in provider did not return a secure sign-in URL.")
            }
            let webSession = AuthBrowserSession(callbackScheme: configuration.callbackScheme)
            browser = webSession
            defer { browser = nil }
            let callback = try await webSession.open(redirectURL)
            guard callback.scheme == configuration.callbackScheme,
                  (callback.host ?? "").isEmpty,
                  callback.path.isEmpty || callback.path == "/" else {
                throw AuthFailure("The sign-in callback was not recognized.")
            }
            let queryItems = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let nonce = queryItems.first { $0.name == "rotating_token_nonce" }?.value
            let query = nonce.map { [URLQueryItem(name: "rotating_token_nonce", value: $0)] } ?? []
            let completed: ClerkReply<ClerkSignIn> = try await request(
                "/v1/client/sign_ins/\(segment(prepared.response.id))", query: query
            )
            let attempt = completed.response
            if let failure = attempt.firstFactorVerification?.error { throw failure }
            if attempt.firstFactorVerification?.status == "transferable" || attempt.secondFactorVerification?.status == "transferable" {
                let signup: ClerkReply<ClerkSignUp> = try await request("/v1/client/sign_ups", method: "POST", form: ["transfer": "true"])
                if let failure = signup.response.verifications?["external_account"]?.error { throw failure }
                guard let sessionID = signup.response.createdSessionId, signup.response.status == "complete" else {
                    throw AuthFailure("This account needs additional setup. Finish creating it on the Inkwell website, then sign in here.")
                }
                try await activate(sessionID: sessionID)
            } else {
                try await finishSignIn(attempt)
            }
        } catch is CancellationError {
            return
        } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    func verifySecondFactor(code: String, useRecoveryCode: Bool = false) async {
        guard !isLoading, let pendingSignIn else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let result: ClerkReply<ClerkSignIn> = try await request(
                "/v1/client/sign_ins/\(segment(pendingSignIn.id))/attempt_second_factor", method: "POST",
                form: ["strategy": useRecoveryCode ? "backup_code" : "totp", "code": code.trimmingCharacters(in: .whitespacesAndNewlines)]
            )
            try await finishSignIn(result.response)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func cancelSecondFactor() {
        pendingSignIn = nil
        needsSecondFactor = false
        error = nil
    }

    func accessToken(template: String? = nil) async throws -> String {
        guard let sessionID = credentials.sessionID, isSignedIn else { throw AuthFailure("Sign in to sync your library.") }
        let cacheKey = template ?? "__session"
        if let cached = credentials.tokens[cacheKey], cached.expiresAt.timeIntervalSinceNow > 15 { return cached.jwt }
        if let pending = tokenRequests[cacheKey] { return try await pending.value }
        let task = Task<String, Error> { @MainActor in
            let suffix = template.map { "/\(segment($0))" } ?? ""
            let token: ClerkToken = try await request("/v1/client/sessions/\(segment(sessionID))/tokens\(suffix)", method: "POST")
            guard let expiry = Self.expiration(of: token.jwt), expiry > Date() else {
                throw AuthFailure("The server returned an expired session. Please sign in again.")
            }
            credentials.tokens[cacheKey] = AuthCachedToken(jwt: token.jwt, expiresAt: expiry)
            try keychain.save(credentials)
            return token.jwt
        }
        tokenRequests[cacheKey] = task
        defer { tokenRequests[cacheKey] = nil }
        return try await task.value
    }

    func signOut() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        browser?.cancel()
        generation += 1
        tokenRequests.values.forEach { $0.cancel() }
        tokenRequests.removeAll()
        let sessionID = credentials.sessionID
        var remoteFailure: Error?
        if let sessionID {
            do {
                let _: ClerkEmpty = try await request("/v1/client/sessions/\(segment(sessionID))/remove", method: "POST")
            } catch { remoteFailure = error }
        }
        clearCredentials()
        if let remoteFailure {
            error = "Signed out on this iPad. The server could not be reached to close the remote session: \(remoteFailure.localizedDescription)"
        }
    }

    private func finishSignIn(_ attempt: ClerkSignIn) async throws {
        if let failure = attempt.secondFactorVerification?.error { throw failure }
        if attempt.status == "needs_second_factor" {
            let strategies = attempt.supportedSecondFactors?.map(\.strategy) ?? []
            guard strategies.contains("totp") || strategies.contains("backup_code") else {
                throw AuthFailure("This account requires a verification method that is unavailable here. Use an authenticator or recovery code configured in your account.")
            }
            pendingSignIn = attempt
            needsSecondFactor = true
            return
        }
        guard attempt.status == "complete", let sessionID = attempt.createdSessionId else {
            throw AuthFailure("Sign-in did not complete. Try again or use another provider.")
        }
        try await activate(sessionID: sessionID)
        pendingSignIn = nil
        needsSecondFactor = false
    }

    private func activate(sessionID: String) async throws {
        let _: ClerkReply<ClerkSession> = try await request(
            "/v1/client/sessions/\(segment(sessionID))/touch", method: "POST",
            form: ["active_organization_id": "", "intent": "select_org"]
        )
        let reply: ClerkReply<ClerkClient?> = try await request("/v1/client")
        try applySession(from: reply.response, selectedID: sessionID)
        guard isSignedIn else { throw AuthFailure("Your session is no longer active. Please sign in again.") }
    }

    private func applySession(from client: ClerkClient?, selectedID: String? = nil) throws {
        let preferred = selectedID ?? credentials.sessionID ?? client?.lastActiveSessionId
        let session = client?.sessions.first { $0.id == preferred && $0.status == "active" }
            ?? client?.sessions.first { $0.status == "active" }
        guard let session, let user = session.user else {
            credentials.sessionID = nil
            credentials.userID = nil
            credentials.tokens = [:]
            userID = nil
            try keychain.save(credentials)
            return
        }
        if credentials.sessionID != session.id { credentials.tokens = [:] }
        credentials.clientID = client?.id
        credentials.sessionID = session.id
        credentials.userID = user.id
        try keychain.save(credentials)
        userID = user.id
    }

    private func request<Value: Decodable>(
        _ path: String, method: String = "GET", form: [String: String] = [:], query: [URLQueryItem] = []
    ) async throws -> Value {
        guard let baseURL, var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw AuthFailure("Sign-in is unavailable because this app is missing its account configuration.")
        }
        components.percentEncodedPath = path
        components.queryItems = [URLQueryItem(name: "_is_native", value: "true")] + query
        guard let url = components.url else { throw AuthFailure("The sign-in service URL is invalid.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Inkwell/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0") iOS", forHTTPHeaderField: "User-Agent")
        request.setValue(credentials.deviceToken, forHTTPHeaderField: "Authorization")
        request.setValue(credentials.clientID, forHTTPHeaderField: "x-clerk-client-id")
        request.setValue(UIDevice.current.identifierForVendor?.uuidString, forHTTPHeaderField: "x-native-device-id")
        request.setValue(UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone", forHTTPHeaderField: "x-device-type")
        request.setValue(UIDevice.current.model, forHTTPHeaderField: "x-device-model")
        request.setValue(UIDevice.current.systemVersion, forHTTPHeaderField: "x-os-version")
        request.setValue(Bundle.main.bundleIdentifier, forHTTPHeaderField: "x-bundle-id")
        request.setValue(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, forHTTPHeaderField: "x-app-version")
        #if targetEnvironment(simulator)
        request.setValue("true", forHTTPHeaderField: "x-is-sandbox")
        #endif
        if method != "GET" {
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(form.sorted { $0.key < $1.key }.map { "\(segment($0.key))=\(segment($0.value))" }.joined(separator: "&").utf8)
        }
        let currentGeneration = generation
        requestSequence += 1
        let sequence = requestSequence
        let (data, response) = try await network.data(for: request)
        try Task.checkCancellation()
        guard generation == currentGeneration else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw AuthFailure("The sign-in service did not respond.") }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        if sequence >= appliedSequence {
            appliedSequence = sequence
            if let token = http.value(forHTTPHeaderField: "Authorization"), !token.isEmpty { credentials.deviceToken = token }
            if let client = try? decoder.decode(ClerkClientEnvelope.self, from: data).client { credentials.clientID = client.id }
            try keychain.save(credentials)
        }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 { clearCredentials() }
            let failure = (try? decoder.decode(ClerkErrors.self, from: data))?.errors.first
            throw failure ?? AuthFailure("The sign-in service returned an error (\(http.statusCode)). Please try again.")
        }
        return try decoder.decode(Value.self, from: data.isEmpty ? Data("{}".utf8) : data)
    }

    private func clearCredentials() {
        generation += 1
        credentials = AuthCredentials()
        userID = nil
        pendingSignIn = nil
        needsSecondFactor = false
        do { try keychain.delete() } catch { self.error = error.localizedDescription }
    }

    private func segment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? value
    }

    private static func frontendURL(for key: String) -> URL? {
        guard key.hasPrefix("pk_test_") || key.hasPrefix("pk_live_") else { return nil }
        let encoded = String(key.dropFirst(8))
        guard let data = decodeBase64URL(encoded), let raw = String(data: data, encoding: .utf8), raw.hasSuffix("$") else { return nil }
        let host = String(raw.dropLast())
        guard !host.isEmpty, host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == ".") }), host.contains(".") else { return nil }
        return URL(string: "https://\(host)")
    }

    private static func expiration(of jwt: String) -> Date? {
        let pieces = jwt.split(separator: ".")
        guard pieces.count == 3, let data = decodeBase64URL(String(pieces[1])),
              let payload = try? JSONDecoder().decode(AuthTokenExpiry.self, from: data) else { return nil }
        return Date(timeIntervalSince1970: payload.exp)
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        let base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4))
    }
}

private struct AuthCredentials: Codable {
    var deviceToken: String?
    var clientID: String?
    var sessionID: String?
    var userID: String?
    var tokens: [String: AuthCachedToken] = [:]
}

private struct AuthCachedToken: Codable {
    let jwt: String
    let expiresAt: Date
}

private struct AuthTokenExpiry: Decodable { let exp: Double }
private struct ClerkReply<Value: Decodable>: Decodable { let response: Value }
private struct ClerkToken: Decodable { let jwt: String }
private struct ClerkEmpty: Decodable {}
private struct ClerkUser: Decodable { let id: String }
private struct ClerkFactor: Decodable { let strategy: String }
private struct ClerkSession: Decodable {
    let id: String
    let status: String
    let user: ClerkUser?
}
private struct ClerkClient: Decodable {
    let id: String
    let sessions: [ClerkSession]
    let lastActiveSessionId: String?
}
private struct ClerkVerification: Decodable {
    let status: String?
    let externalVerificationRedirectUrl: String?
    let error: AuthFailure?
}
private struct ClerkSignIn: Decodable {
    let id: String
    let status: String
    let createdSessionId: String?
    let firstFactorVerification: ClerkVerification?
    let secondFactorVerification: ClerkVerification?
    let supportedSecondFactors: [ClerkFactor]?
}
private struct ClerkSignUp: Decodable {
    let status: String
    let createdSessionId: String?
    let verifications: [String: ClerkVerification]?
}
private struct ClerkErrors: Decodable { let errors: [AuthFailure] }

private struct AuthFailure: LocalizedError, Decodable {
    let message: String
    let longMessage: String?
    var errorDescription: String? { longMessage ?? message }
    init(_ message: String) { self.message = message; longMessage = nil }
}

private struct ClerkClientEnvelope: Decodable {
    let client: ClerkClient?
    private enum CodingKeys: String, CodingKey { case response, client, meta }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let meta = try? container.nestedContainer(keyedBy: CodingKeys.self, forKey: .meta)
        client = (try? container.decode(ClerkClient.self, forKey: .response))
            ?? (try? container.decode(ClerkClient.self, forKey: .client))
            ?? (try? meta?.decode(ClerkClient.self, forKey: .client))
    }
}

private struct AuthKeychain {
    let instance: String
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "sh.davis7.inkwell", category: "Authentication")

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "sh.davis7.inkwell").native-auth",
         kSecAttrAccount as String: instance]
    }

    func load() throws -> AuthCredentials? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw failure(status, message: "Saved sign-in credentials could not be read securely.")
        }
        return try JSONDecoder().decode(AuthCredentials.self, from: data)
    }

    func save(_ credentials: AuthCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw failure(addStatus, message: "Sign-in credentials could not be saved securely.")
            }
        } else if status != errSecSuccess {
            throw failure(status, message: "Sign-in credentials could not be updated securely.")
        }
    }

    func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw failure(status, message: "Saved sign-in credentials could not be removed from Keychain.")
        }
    }

    private func failure(_ status: OSStatus, message: String) -> AuthFailure {
        let detail = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown Keychain error"
        // Only operating-system diagnostics enter the log; credentials and IDs never do.
        Self.logger.error("\(message, privacy: .public) OSStatus \(status, privacy: .public): \(detail, privacy: .public)")
        return AuthFailure(message)
    }
}

@MainActor
private final class AuthBrowserSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let callbackScheme: String
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?

    init(callbackScheme: String) { self.callbackScheme = callbackScheme }

    func open(_ url: URL) async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                self.continuation = continuation
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { url, error in
                    Task { @MainActor in
                        if let url { self.finish(.success(url)) }
                        else { self.finish(.failure(error ?? AuthFailure("Sign-in did not return a callback."))) }
                    }
                }
                session.presentationContextProvider = self
                self.session = session
                if !session.start() { finish(.failure(AuthFailure("The sign-in window could not be opened."))) }
            }
        } onCancel: {
            Task { @MainActor in self.cancel() }
        }
    }

    func cancel() {
        session?.cancel()
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<URL, Error>) {
        let continuation = self.continuation
        self.continuation = nil
        session = nil
        continuation?.resume(with: result)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
