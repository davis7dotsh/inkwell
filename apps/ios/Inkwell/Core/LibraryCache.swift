import Foundation

struct PendingAnnotation: Codable, Equatable {
    var revision: String = UUID().uuidString
    var annotations: AnnotationSet
    var queuedAt: Date = .now
}

struct CachedLibrary: Codable {
    var articles: [Article] = []
    var tags: [ArticleTag] = []
    var details: [String: Article] = [:]
    var annotations: [String: AnnotationSet] = [:]
    var pendingAnnotations: [String: PendingAnnotation] = [:]
}

/// Each account has an independent atomic snapshot, including unsynced edits.
struct LibraryCache {
    let fileURL: URL

    init(userID: String, namespace: String = "default", directory: URL? = nil) {
        let root = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Inkwell", isDirectory: true)
        let account = Data(userID.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
        // Stable environment fingerprint prevents development and production caches mixing.
        let environment = namespace.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        fileURL = root.appendingPathComponent("library-\(String(environment, radix: 16))-\(account).json")
    }

    func read() throws -> CachedLibrary {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return CachedLibrary() }
        return try JSONDecoder().decode(CachedLibrary.self, from: Data(contentsOf: fileURL))
    }

    func write(_ library: CachedLibrary) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(library)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var url = fileURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = false
        try url.setResourceValues(values)
    }
}
