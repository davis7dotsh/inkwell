import Foundation
import Observation

@MainActor @Observable
final class InkwellStore {
    private(set) var articles: [Article] = []
    private(set) var tags: [ArticleTag] = []
    private(set) var isLoading = false
    var error: String?
    private(set) var annotationSyncError: String?
    let isDemo: Bool
    let authentication: Authentication
    var pendingAnnotationCount: Int { snapshot.pendingAnnotations.count }

    @ObservationIgnored private let client: APIClient
    private var snapshot = CachedLibrary()
    @ObservationIgnored private var cache: LibraryCache?
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private var cacheReadError: Error?
    @ObservationIgnored private var loadedAnnotationIDs: Set<String> = []
    @ObservationIgnored private var syncing = false
    @ObservationIgnored private var deletedArticleIDs: Set<String> = []
    @ObservationIgnored private var persistedPendingRevisions: [String: String] = [:]

    nonisolated static var demoLaunchRequested: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--demo")
        #else
        false
        #endif
    }

    init(authentication: Authentication, configuration: AppConfiguration = .current, demo: Bool = InkwellStore.demoLaunchRequested) {
        self.authentication = authentication
        self.isDemo = demo
        self.client = APIClient(configuration: configuration, authentication: authentication)
        if demo {
            snapshot = DemoLibrary.make()
            articles = snapshot.articles
            tags = snapshot.tags
        } else if let userID = authentication.userID {
            loadAccount(userID)
        }
    }

    func refresh() async {
        guard !isLoading else { return }
        guard !isDemo else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let account = try prepareAccount()
            async let fetchedArticles: [Article] = client.convex("articles:list")
            async let fetchedTags: [ArticleTag] = client.convex("tags:list")
            let (newArticles, newTags) = try await (fetchedArticles, fetchedTags)
            try requireAccount(account)
            snapshot.articles = newArticles
            snapshot.tags = newTags
            articles = newArticles
            tags = newTags
            error = nil
            try persist()
            await syncAnnotations()
        } catch is CancellationError {
        } catch {
            self.error = articles.isEmpty ? error.localizedDescription : "Showing your saved library. \(error.localizedDescription)"
        }
    }

    func article(id: String) async throws -> Article {
        if isDemo {
            guard let article = snapshot.details[id] ?? articles.first(where: { $0.id == id }) else { throw InkwellError.server("Article not found.") }
            return article
        }
        let account = try prepareAccount()
        do {
            let article: Article = try await client.convex("articles:get", args: ["id": .string(id)])
            try requireAccount(account)
            _ = try article.decodedBlocks()
            snapshot.details[id] = article
            try persist()
            return article
        } catch {
            try requireAccount(account)
            if !(error is DecodingError), let cached = snapshot.details[id] {
                _ = try cached.decodedBlocks()
                self.error = "Showing the saved article. \(error.localizedDescription)"
                return cached
            }
            throw error
        }
    }

    func annotations(articleID: String, contentWidth: Double) async throws -> AnnotationSet {
        if isDemo {
            loadedAnnotationIDs.insert(articleID)
            return snapshot.annotations[articleID] ?? AnnotationSet(contentWidth: contentWidth)
        }
        let account = try prepareAccount()
        if let pending = snapshot.pendingAnnotations[articleID] {
            try pending.annotations.validate()
            loadedAnnotationIDs.insert(articleID)
            return pending.annotations
        }
        do {
            let wire: AnnotationWire? = try await client.convex("annotations:get", args: ["articleId": .string(articleID)])
            try requireAccount(account)
            // Edits can arrive while a refresh is suspended on the network.
            if let pending = snapshot.pendingAnnotations[articleID] { return pending.annotations }
            let annotations = try wire?.annotations() ?? AnnotationSet(contentWidth: contentWidth)
            try annotations.validate()
            snapshot.annotations[articleID] = annotations
            loadedAnnotationIDs.insert(articleID)
            try persist()
            return annotations
        } catch {
            try requireAccount(account)
            if error is DecodingError || isInvalidData(error) {
                loadedAnnotationIDs.remove(articleID)
                throw InkwellError.invalidData("These annotations could not be decoded. Your saved ink has been preserved; editing is disabled to prevent replacing it.")
            }
            if let cached = snapshot.annotations[articleID] {
                try cached.validate()
                loadedAnnotationIDs.insert(articleID)
                annotationSyncError = "Using saved annotations. Changes will sync when connected. \(error.localizedDescription)"
                return cached
            }
            throw error
        }
    }

    /// Writes every completed edit atomically before attempting a server save.
    /// Queue revisions ensure a slow response cannot discard a newer gesture.
    func saveAnnotations(_ annotations: AnnotationSet, articleID: String) async {
        stageAnnotations(annotations, articleID: articleID)
        await syncAnnotations()
    }

    /// The reader calls this synchronously so gesture snapshots enter the durable
    /// queue in event order, before any network task can suspend or be reordered.
    func stageAnnotations(_ annotations: AnnotationSet, articleID: String) {
        do {
            if !isDemo { _ = try prepareAccount() }
            guard loadedAnnotationIDs.contains(articleID), !deletedArticleIDs.contains(articleID) else {
                throw InkwellError.invalidData("Load the saved annotations before editing this article.")
            }
            try annotations.validate()
            snapshot.annotations[articleID] = annotations
            if isDemo { return }
            snapshot.pendingAnnotations[articleID] = PendingAnnotation(annotations: annotations)
            try persist()
            Task { await syncAnnotations() }
        } catch {
            annotationSyncError = "Annotations have not finished saving. \(error.localizedDescription)"
        }
    }

    func syncAnnotations() async {
        guard !isDemo, !syncing, !snapshot.pendingAnnotations.isEmpty else { return }
        syncing = true
        defer { syncing = false }
        do {
            let account = try prepareAccount()
            while let (articleID, pending) = snapshot.pendingAnnotations.sorted(by: { $0.value.queuedAt < $1.value.queuedAt }).first {
                try requireAccount(account)
                // Another gesture may have arrived while the preceding upload was
                // suspended. Its own revision must also be durable before upload.
                try persist()
                try pending.annotations.validate()
                let args = try annotationArguments(pending.annotations, articleID: articleID)
                try await client.mutate("annotations:save", args: args)
                try requireAccount(account)
                if snapshot.pendingAnnotations[articleID]?.revision == pending.revision {
                    snapshot.pendingAnnotations.removeValue(forKey: articleID)
                    do { try persist() }
                    catch {
                        // Keep a retryable entry until the acknowledgement itself is durable.
                        snapshot.pendingAnnotations[articleID] = pending
                        throw error
                    }
                }
            }
            annotationSyncError = nil
        } catch is CancellationError {
        } catch {
            let queueIsDurable = snapshot.pendingAnnotations.allSatisfy { persistedPendingRevisions[$0.key] == $0.value.revision }
            annotationSyncError = queueIsDurable
                ? "Changes are saved on this device and waiting to sync. \(error.localizedDescription)"
                : "Keep the app open: changes could not be saved on this device. \(error.localizedDescription)"
        }
    }

    @discardableResult
    func addURL(_ url: String) async throws -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let parsed = URL(string: value), ["http", "https"].contains(parsed.scheme?.lowercased() ?? ""), parsed.host != nil else { throw InkwellError.invalidData("Enter a complete http or https article URL.") }
        if isDemo {
            let id = UUID().uuidString
            let article = Article(id: id, url: value, title: parsed.host ?? "Saved article", excerpt: "Saved in the simulator demo.", blocksJson: try jsonString([ContentBlock(type: "paragraph", spans: [TextSpan(text: "This URL was added to the local demo library. Sign in to extract and read the real article.")])]))
            snapshot.details[id] = article
            articles.insert(article, at: 0)
            snapshot.articles = articles
            return id
        }
        let account = try prepareAccount()
        let id = try await client.addURL(value)
        try requireAccount(account)
        await refresh()
        return id
    }

    @discardableResult
    func importPDF(_ fileURL: URL) async throws -> String {
        guard !isDemo else { throw InkwellError.server("Sign in to import a PDF. The demo library runs entirely on this device.") }
        let account = try prepareAccount()
        let id = try await client.importPDF(fileURL: fileURL)
        try requireAccount(account)
        await refresh()
        return id
    }

    func retryArticle(_ article: Article) async throws {
        guard !isDemo else { return }
        let account = try prepareAccount()
        _ = try await client.retryArticle(id: article.id, url: article.url)
        try requireAccount(account)
        await refresh()
    }

    func rename(id: String, title: String) async throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw InkwellError.invalidData("Give the article a title.") }
        try await mutate("articles:rename", args: ["id": .string(id), "title": .string(title)])
        try updateArticle(id) { $0.title = title }
    }

    func setReadStatus(id: String, status: String) async throws {
        guard ["unread", "in_progress", "read"].contains(status) else { throw InkwellError.invalidData("Unknown reading status.") }
        try await mutate("articles:setReadStatus", args: ["id": .string(id), "status": .string(status)])
        try updateArticle(id) { $0.readStatus = status }
    }

    func setPinned(id: String, pinned: Bool) async throws {
        try await mutate("articles:setPinned", args: ["id": .string(id), "pinned": .bool(pinned)])
        try updateArticle(id) { $0.pinned = pinned }
    }

    func delete(id: String) async throws {
        try await mutate("articles:remove", args: ["id": .string(id)])
        deletedArticleIDs.insert(id)
        articles.removeAll { $0.id == id }
        snapshot.articles = articles
        snapshot.details.removeValue(forKey: id)
        snapshot.annotations.removeValue(forKey: id)
        snapshot.pendingAnnotations.removeValue(forKey: id)
        loadedAnnotationIDs.remove(id)
        try persist()
    }

    @discardableResult
    func createTag(name: String, color: String? = nil) async throws -> String {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw InkwellError.invalidData("Give the tag a name.") }
        if let existing = tags.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) { return existing.id }
        var args: [String: JSONValue] = ["name": .string(name)]
        if let color { args["color"] = .string(color) }
        let id: String
        if isDemo { id = UUID().uuidString }
        else {
            let account = try prepareAccount()
            id = try await client.convex("tags:create", args: args, mutation: true)
            try requireAccount(account)
        }
        tags.append(ArticleTag(id: id, name: name, color: color))
        try saveTags()
        return id
    }

    func renameTag(id: String, name: String) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw InkwellError.invalidData("Give the tag a name.") }
        guard !tags.contains(where: { $0.id != id && $0.name.caseInsensitiveCompare(name) == .orderedSame }) else { throw InkwellError.invalidData("A tag with that name already exists.") }
        try await mutate("tags:rename", args: ["id": .string(id), "name": .string(name)])
        if let index = tags.firstIndex(where: { $0.id == id }) { tags[index].name = name }
        try saveTags()
    }

    func setTagColor(id: String, color: String?) async throws {
        var args: [String: JSONValue] = ["id": .string(id)]
        if let color { args["color"] = .string(color) }
        try await mutate("tags:setColor", args: args)
        if let index = tags.firstIndex(where: { $0.id == id }) { tags[index].color = color }
        try saveTags()
    }

    func deleteTag(id: String) async throws {
        try await mutate("tags:remove", args: ["id": .string(id)])
        tags.removeAll { $0.id == id }
        for index in articles.indices { articles[index].tags.removeAll { $0 == id } }
        for key in snapshot.details.keys { snapshot.details[key]?.tags.removeAll { $0 == id } }
        snapshot.articles = articles
        try saveTags()
    }

    func setTag(articleID: String, tagID: String, attached: Bool) async throws {
        try await mutate(attached ? "tags:addToArticle" : "tags:removeFromArticle", args: ["articleId": .string(articleID), "tagId": .string(tagID)])
        try updateArticle(articleID) { article in
            article.tags.removeAll { $0 == tagID }
            if attached { article.tags.append(tagID) }
        }
    }

    func uploadMemo(articleID: String, memoID: String, fileURL: URL) async throws {
        guard !isDemo else { throw InkwellError.server("This recording is stored locally in demo mode. Sign in to sync recordings.") }
        let account = try prepareAccount()
        try await client.uploadMemo(articleID: articleID, memoID: memoID, fileURL: fileURL)
        try requireAccount(account)
    }

    func downloadMemo(articleID: String, memoID: String) async throws -> Data {
        guard !isDemo else { throw InkwellError.server("This demo memo has no remote recording.") }
        let account = try prepareAccount()
        let data = try await client.downloadMemo(articleID: articleID, memoID: memoID)
        try requireAccount(account)
        return data
    }

    func deleteMemo(articleID: String, memoID: String) async throws {
        guard !isDemo else { return }
        let account = try prepareAccount()
        try await client.deleteMemo(articleID: articleID, memoID: memoID)
        try requireAccount(account)
    }

    private func mutate(_ path: String, args: [String: JSONValue]) async throws {
        guard !isDemo else { return }
        let account = try prepareAccount()
        try await client.mutate(path, args: args)
        try requireAccount(account)
    }

    private func updateArticle(_ id: String, update: (inout Article) -> Void) throws {
        if let index = articles.firstIndex(where: { $0.id == id }) { update(&articles[index]) }
        if var detail = snapshot.details[id] { update(&detail); snapshot.details[id] = detail }
        snapshot.articles = articles
        try persist()
    }

    private func saveTags() throws {
        tags.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        snapshot.tags = tags
        try persist()
    }

    private func prepareAccount() throws -> String {
        guard let userID = authentication.userID else { throw InkwellError.signedOut }
        if accountID != userID { loadAccount(userID) }
        return userID
    }

    private func requireAccount(_ id: String) throws {
        guard authentication.userID == id, accountID == id else { throw InkwellError.signedOut }
    }

    private func loadAccount(_ id: String) {
        accountID = id
        cache = LibraryCache(userID: id, namespace: client.configuration.convexURL?.absoluteString ?? "unconfigured")
        loadedAnnotationIDs.removeAll()
        deletedArticleIDs.removeAll()
        cacheReadError = nil
        persistedPendingRevisions = [:]
        do { snapshot = try cache?.read() ?? CachedLibrary() }
        catch {
            snapshot = CachedLibrary()
            cacheReadError = error
            self.error = "The saved library could not be opened. Its original file has been preserved. \(error.localizedDescription)"
        }
        persistedPendingRevisions = snapshot.pendingAnnotations.mapValues(\.revision)
        articles = snapshot.articles
        tags = snapshot.tags
    }

    private func persist() throws {
        guard !isDemo else { return }
        if let cacheReadError { throw InkwellError.invalidData("The existing local cache cannot be safely overwritten: \(cacheReadError.localizedDescription)") }
        guard let cache else { throw InkwellError.signedOut }
        try cache.write(snapshot)
        persistedPendingRevisions = snapshot.pendingAnnotations.mapValues(\.revision)
    }

    private func annotationArguments(_ value: AnnotationSet, articleID: String) throws -> [String: JSONValue] {
        var args: [String: JSONValue] = [
            "articleId": .string(articleID), "contentWidth": .number(value.contentWidth),
            "strokesJson": .string(try jsonString(value.strokes)), "boxesJson": .string(try jsonString(value.boxes)),
            "notesJson": .string(try jsonString(value.notes)), "memosJson": .string(try jsonString(value.memos))
        ]
        if let layout = value.layoutJson { args["layoutJson"] = .string(layout) }
        return args
    }

    private func isInvalidData(_ error: Error) -> Bool {
        if case InkwellError.invalidData = error { return true }
        return false
    }
}

func jsonString<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
}
