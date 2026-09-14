import Foundation

struct AppConfiguration: Sendable {
    var apiBaseURL: URL?
    var convexURL: URL?
    var clerkPublishableKey: String
    var callbackScheme: String = "inkwell"

    static var current: AppConfiguration {
        let info = Bundle.main.infoDictionary ?? [:]
        func string(_ key: String) -> String {
            let value = (info[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return value.hasPrefix("$(") ? "" : value
        }
        func url(_ key: String) -> URL? {
            guard let url = URL(string: string(key)), ["http", "https"].contains(url.scheme ?? ""), url.host != nil else { return nil }
            return url
        }
        return AppConfiguration(
            apiBaseURL: url("APIBaseURL"), convexURL: url("ConvexURL"),
            clerkPublishableKey: string("ClerkPublishableKey"), callbackScheme: string("InkwellURLScheme")
        )
    }
}
