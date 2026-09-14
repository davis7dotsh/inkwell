import Foundation

/// A typed JSON value keeps Convex arguments and responses honest without `Any` casts.
enum JSONValue: Codable, Sendable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else { self = .object(try value.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .bool(let bool): try value.encode(bool)
        case .array(let array): try value.encode(array)
        case .object(let object): try value.encode(object)
        case .null: try value.encodeNil()
        }
    }
}

@MainActor
final class APIClient {
    let configuration: AppConfiguration
    let authentication: Authentication
    private let session: URLSession

    init(configuration: AppConfiguration, authentication: Authentication, session: URLSession = .shared) {
        self.configuration = configuration
        self.authentication = authentication
        self.session = session
    }

    private struct ConvexRequest: Encodable {
        let path: String
        let args: [String: JSONValue]
        let format = "json"
    }
    private struct ConvexResponse: Decodable {
        let status: String
        let value: JSONValue?
        let errorMessage: String?
    }
    private struct APIErrorResponse: Decodable { let error: String?; let message: String? }
    private struct ArticleResponse: Decodable { let articleId: String }

    func convex<T: Decodable>(_ path: String, args: [String: JSONValue] = [:], mutation: Bool = false) async throws -> T {
        guard let base = configuration.convexURL else { throw InkwellError.configuration("Set the ConvexURL build setting to connect your library.") }
        let token = try await authentication.accessToken(template: "convex")
        var request = URLRequest(url: base.appendingPathComponent(mutation ? "api/mutation" : "api/query"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(ConvexRequest(path: path, args: args))
        let data = try await send(request)
        let response = try JSONDecoder().decode(ConvexResponse.self, from: data)
        guard response.status == "success" else { throw InkwellError.server(response.errorMessage ?? "The library server could not complete the request.") }
        return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(response.value ?? .null))
    }

    func mutate(_ path: String, args: [String: JSONValue]) async throws {
        let _: JSONValue = try await convex(path, args: args, mutation: true)
    }

    func addURL(_ url: String) async throws -> String {
        let request = try await apiRequest(path: ["articles"], method: "POST", body: JSONEncoder().encode(["url": url]), contentType: "application/json")
        return try JSONDecoder().decode(ArticleResponse.self, from: await send(request)).articleId
    }

    func retryArticle(id: String, url: String) async throws -> String {
        let request = try await apiRequest(path: ["articles", id, "retry"], method: "POST", body: JSONEncoder().encode(["url": url]), contentType: "application/json")
        return try JSONDecoder().decode(ArticleResponse.self, from: await send(request)).articleId
    }

    func importPDF(fileURL: URL) async throws -> String {
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 50 * 1024 * 1024 else {
            throw InkwellError.invalidData("Choose a PDF smaller than 50 MB.")
        }
        let data = try Data(contentsOf: fileURL)
        guard data.starts(with: Data("%PDF-".utf8)) else { throw InkwellError.invalidData("This file is not a valid PDF.") }
        let boundary = "Inkwell-\(UUID().uuidString)"
        let filename = fileURL.lastPathComponent.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: application/pdf\r\n\r\n".utf8)
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let request = try await apiRequest(path: ["articles", "upload"], method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
        return try JSONDecoder().decode(ArticleResponse.self, from: await send(request)).articleId
    }

    func uploadMemo(articleID: String, memoID: String, fileURL: URL) async throws {
        let audio = try Data(contentsOf: fileURL)
        guard audio.count <= 25 * 1024 * 1024 else { throw InkwellError.invalidData("This recording exceeds the 25 MB upload limit.") }
        let request = try await apiRequest(path: ["memos", articleID, memoID], method: "PUT", body: audio, contentType: "audio/mp4")
        _ = try await send(request)
    }

    func downloadMemo(articleID: String, memoID: String) async throws -> Data {
        let request = try await apiRequest(path: ["memos", articleID, memoID], method: "GET")
        return try await send(request)
    }

    func deleteMemo(articleID: String, memoID: String) async throws {
        let request = try await apiRequest(path: ["memos", articleID, memoID], method: "DELETE")
        _ = try await send(request)
    }

    private func apiRequest(path: [String], method: String, body: Data? = nil, contentType: String? = nil) async throws -> URLRequest {
        guard let base = configuration.apiBaseURL else { throw InkwellError.configuration("Set the APIBaseURL build setting to save articles and voice memos.") }
        let token = try await authentication.accessToken()
        let url = path.reduce(base) { $0.appendingPathComponent($1) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        return request
    }

    private func send(_ original: URLRequest) async throws -> Data {
        var request = original
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw InkwellError.server("The server returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            throw InkwellError.server(detail?.error ?? detail?.message ?? "The server returned HTTP \(response.statusCode). Please try again.")
        }
        return data
    }
}
