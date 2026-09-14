import Foundation

struct TextSpan: Codable, Equatable, Sendable {
    var text: String
    var bold: Bool? = nil
    var italic: Bool? = nil
    var code: Bool? = nil
    var href: String? = nil
}

/// Mirrors packages/content's discriminated Block JSON without changing the wire format.
struct ContentBlock: Codable, Equatable, Sendable {
    var type: String
    var level: Int? = nil
    var spans: [TextSpan]? = nil
    var ordered: Bool? = nil
    var items: [[TextSpan]]? = nil
    var src: String? = nil
    var alt: String? = nil
    var caption: String? = nil
    var width: Double? = nil
    var height: Double? = nil
    var text: String? = nil

    var plainText: String {
        if let text { return text }
        if let spans { return spans.map(\.text).joined() }
        if let items { return items.map { $0.map(\.text).joined() }.joined(separator: "\n") }
        return caption ?? alt ?? ""
    }

    func validate() throws {
        let valid: Bool
        switch type {
        case "heading": valid = (1...6).contains(level ?? 0) && spans != nil
        case "paragraph", "quote": valid = spans != nil
        case "list": valid = ordered != nil && items != nil
        case "image": valid = src != nil
        case "code": valid = text != nil
        case "rule": valid = true
        default: valid = false
        }
        guard valid else { throw InkwellError.invalidData("The article contains an unsupported or incomplete content block.") }
    }
}

struct Article: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var userId: String = ""
    var url: String
    var kind: String = "web"
    var status: String = "ready"
    var error: String? = nil
    var title: String
    var byline: String? = nil
    var siteName: String? = nil
    var excerpt: String? = nil
    var blocksJson: String? = nil
    var savedAt: Double
    var readStatus: String = "unread"
    var pinned: Bool = false
    var tags: [String] = []

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case userId, url, kind, status, error, title, byline, siteName, excerpt, blocksJson, savedAt, readStatus, pinned, tags
    }

    init(id: String, userId: String = "", url: String, kind: String = "web", status: String = "ready", error: String? = nil, title: String, byline: String? = nil, siteName: String? = nil, excerpt: String? = nil, blocksJson: String? = nil, savedAt: Double = Date.now.timeIntervalSince1970 * 1000, readStatus: String = "unread", pinned: Bool = false, tags: [String] = []) {
        self.id = id; self.userId = userId; self.url = url; self.kind = kind; self.status = status
        self.error = error; self.title = title; self.byline = byline; self.siteName = siteName; self.excerpt = excerpt
        self.blocksJson = blocksJson; self.savedAt = savedAt; self.readStatus = readStatus; self.pinned = pinned; self.tags = tags
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        userId = try values.decodeIfPresent(String.self, forKey: .userId) ?? ""
        url = try values.decode(String.self, forKey: .url)
        kind = try values.decode(String.self, forKey: .kind)
        status = try values.decode(String.self, forKey: .status)
        error = try values.decodeIfPresent(String.self, forKey: .error)
        title = try values.decode(String.self, forKey: .title)
        byline = try values.decodeIfPresent(String.self, forKey: .byline)
        siteName = try values.decodeIfPresent(String.self, forKey: .siteName)
        excerpt = try values.decodeIfPresent(String.self, forKey: .excerpt)
        blocksJson = try values.decodeIfPresent(String.self, forKey: .blocksJson)
        savedAt = try values.decode(Double.self, forKey: .savedAt)
        readStatus = try values.decodeIfPresent(String.self, forKey: .readStatus) ?? "unread"
        pinned = try values.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        tags = try values.decodeIfPresent([String].self, forKey: .tags) ?? []
    }

    var blocks: [ContentBlock] { (try? decodedBlocks()) ?? [] }
    var savedDate: Date { Date(timeIntervalSince1970: savedAt / 1000) }
    var sourceName: String { siteName ?? URL(string: url)?.host ?? (kind == "pdf" ? "PDF document" : "Saved article") }

    func decodedBlocks() throws -> [ContentBlock] {
        guard let blocksJson else { return [] }
        let result = try JSONDecoder().decode([ContentBlock].self, from: Data(blocksJson.utf8))
        try result.forEach { try $0.validate() }
        return result
    }
}

struct ArticleTag: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var color: String? = nil
    var createdAt: Double = Date.now.timeIntervalSince1970 * 1000

    enum CodingKeys: String, CodingKey { case id = "_id"; case name, color, createdAt }
}

struct InkPoint: Codable, Equatable, Sendable { var x: Double; var y: Double }
struct InkStroke: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var tool: String
    var color: String
    var width: Double
    var points: [InkPoint]
}
struct AnnotationBox: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}
struct PinnedNote: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var x: Double
    var y: Double
    var text: String
}
struct VoiceMemo: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var x: Double
    var y: Double
    var durationMs: Double
    var transcript: String
    var status: String
    var createdAt: Double
}

struct AnnotationSet: Codable, Equatable, Sendable {
    var contentWidth: Double
    var strokes: [InkStroke] = []
    var boxes: [AnnotationBox] = []
    var notes: [PinnedNote] = []
    var memos: [VoiceMemo] = []
    var layoutJson: String? = nil

    func validate() throws {
        guard contentWidth.isFinite, contentWidth > 0,
              strokes.allSatisfy({ ["pen", "highlighter"].contains($0.tool) && $0.width.isFinite && $0.points.allSatisfy { $0.x.isFinite && $0.y.isFinite } }),
              boxes.allSatisfy({ [$0.x, $0.y, $0.w, $0.h].allSatisfy(\.isFinite) }),
              notes.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              memos.allSatisfy({ [$0.x, $0.y, $0.durationMs, $0.createdAt].allSatisfy(\.isFinite) && ["local", "uploaded"].contains($0.status) }) else {
            throw InkwellError.invalidData("The saved annotations contain invalid geometry. They have been preserved and cannot be overwritten.")
        }
    }
}

/// Decoding is intentionally strict: malformed saved ink must never become an empty writable canvas.
struct AnnotationWire: Decodable {
    var contentWidth: Double
    var strokesJson: String
    var boxesJson: String
    var notesJson: String
    var memosJson: String?
    var layoutJson: String?
    var updatedAt: Double?

    func annotations() throws -> AnnotationSet {
        let decoder = JSONDecoder()
        let result = AnnotationSet(
            contentWidth: contentWidth,
            strokes: try decoder.decode([InkStroke].self, from: Data(strokesJson.utf8)),
            boxes: try decoder.decode([AnnotationBox].self, from: Data(boxesJson.utf8)),
            notes: try decoder.decode([PinnedNote].self, from: Data(notesJson.utf8)),
            memos: try decoder.decode([VoiceMemo].self, from: Data((memosJson ?? "[]").utf8)),
            layoutJson: layoutJson
        )
        try result.validate()
        return result
    }
}

enum InkwellError: LocalizedError {
    case configuration(String)
    case invalidData(String)
    case server(String)
    case signedOut

    var errorDescription: String? {
        switch self {
        case .configuration(let message), .invalidData(let message), .server(let message): return message
        case .signedOut: return "Sign in to access your library."
        }
    }
}
