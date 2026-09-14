import XCTest
@testable import Inkwell

final class ModelAndCacheTests: XCTestCase {
    func testLegacyArticleDefaultsAndRichBlocks() throws {
        let articleJSON = ##"{"_id":"article-1","url":"https://example.com","kind":"web","status":"ready","title":"A saved article","savedAt":1720000000000,"blocksJson":"[{\"type\":\"heading\",\"level\":2,\"spans\":[{\"text\":\"Heading\",\"bold\":true}]},{\"type\":\"list\",\"ordered\":false,\"items\":[[{\"text\":\"A link\",\"href\":\"https://example.com\"}]]}]"}"##
        let article = try JSONDecoder().decode(Article.self, from: Data(articleJSON.utf8))
        XCTAssertEqual(article.id, "article-1")
        XCTAssertEqual(article.readStatus, "unread")
        XCTAssertFalse(article.pinned)
        XCTAssertEqual(article.tags, [])
        let blocks = try article.decodedBlocks()
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].spans?.first?.bold, true)
        XCTAssertEqual(blocks[1].items?.first?.first?.href, "https://example.com")
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(article)) as? [String: Any])
        XCTAssertEqual(encoded["_id"] as? String, "article-1")
        XCTAssertNil(encoded["id"])
    }

    func testExistingAnnotationWirePreservesEveryGeometryAndMemoField() throws {
        let wireJSON = ##"{"contentWidth":720,"strokesJson":"[{\"id\":\"ink-1\",\"tool\":\"highlighter\",\"color\":\"#ffcc00\",\"width\":18.5,\"points\":[{\"x\":12.25,\"y\":345.5},{\"x\":210,\"y\":346}]}]","boxesJson":"[{\"id\":\"box-1\",\"x\":10,\"y\":80,\"w\":300,\"h\":42}]","notesJson":"[{\"id\":\"note-1\",\"x\":615,\"y\":105,\"text\":\"Keep this idea\"}]","memosJson":"[{\"id\":\"memo-1\",\"x\":12,\"y\":30,\"durationMs\":9876,\"transcript\":\"A thought\",\"status\":\"uploaded\",\"createdAt\":1720000000000}]","layoutJson":"{\"width\":720,\"layouts\":[[0,{\"y\":80,\"height\":42}]]}","updatedAt":1720000000001}"##
        let wire = try JSONDecoder().decode(AnnotationWire.self, from: Data(wireJSON.utf8))
        let annotations = try wire.annotations()
        XCTAssertEqual(annotations.contentWidth, 720)
        XCTAssertEqual(annotations.strokes[0].points[0], InkPoint(x: 12.25, y: 345.5))
        XCTAssertEqual(annotations.strokes[0].width, 18.5)
        XCTAssertEqual(annotations.boxes[0].w, 300)
        XCTAssertEqual(annotations.boxes[0].h, 42)
        XCTAssertEqual(annotations.notes[0].text, "Keep this idea")
        XCTAssertEqual(annotations.memos[0].durationMs, 9876)
        XCTAssertEqual(annotations.memos[0].status, "uploaded")
        XCTAssertEqual(annotations.layoutJson, ##"{"width":720,"layouts":[[0,{"y":80,"height":42}]]}"##)
        let restored = try JSONDecoder().decode(AnnotationSet.self, from: JSONEncoder().encode(annotations))
        XCTAssertEqual(restored, annotations)
    }

    func testMalformedInkAndUnknownToolsCannotBecomeWritableEmptyAnnotations() throws {
        let malformed = AnnotationWire(contentWidth: 720, strokesJson: "not-json", boxesJson: "[]", notesJson: "[]")
        XCTAssertThrowsError(try malformed.annotations())
        let invalidGeometry = AnnotationWire(contentWidth: 0, strokesJson: "[]", boxesJson: "[]", notesJson: "[]")
        XCTAssertThrowsError(try invalidGeometry.annotations())
        let unknownTool = AnnotationWire(contentWidth: 720, strokesJson: ##"[{"id":"s","tool":"future-tool","color":"#000000","width":2,"points":[]}]"##, boxesJson: "[]", notesJson: "[]")
        XCTAssertThrowsError(try unknownTool.annotations())
        let legacy = AnnotationWire(contentWidth: 720, strokesJson: "[]", boxesJson: "[]", notesJson: "[]")
        XCTAssertEqual(try legacy.annotations().memos, [])
    }

    func testPendingEditsSurviveRelaunchAndRemainAccountScoped() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let alice = LibraryCache(userID: "user/alice", directory: directory)
        let bob = LibraryCache(userID: "user/bob", directory: directory)
        let annotations = AnnotationSet(contentWidth: 700, notes: [PinnedNote(id: "note-1", x: 40, y: 120, text: "Saved offline")])
        let pending = PendingAnnotation(annotations: annotations)
        var snapshot = CachedLibrary()
        snapshot.annotations["article-1"] = annotations
        snapshot.pendingAnnotations["article-1"] = pending
        try alice.write(snapshot)
        let restored = try LibraryCache(userID: "user/alice", directory: directory).read()
        XCTAssertEqual(restored.annotations["article-1"], annotations)
        XCTAssertEqual(restored.pendingAnnotations["article-1"], pending)
        XCTAssertTrue(try bob.read().pendingAnnotations.isEmpty)
        XCTAssertNotEqual(alice.fileURL, bob.fileURL)
        let otherEnvironment = LibraryCache(userID: "user/alice", namespace: "https://other.convex.cloud", directory: directory)
        XCTAssertTrue(try otherEnvironment.read().pendingAnnotations.isEmpty)
        XCTAssertNotEqual(alice.fileURL, otherEnvironment.fileURL)
        XCTAssertEqual(alice.fileURL.deletingLastPathComponent(), directory)
    }

    @MainActor
    func testDemoLibraryMutationsAndAnnotationsStayLocal() async throws {
        let auth = Authentication(configuration: AppConfiguration(apiBaseURL: nil, convexURL: nil, clerkPublishableKey: ""))
        let store = InkwellStore(authentication: auth, demo: true)
        let article = try XCTUnwrap(store.articles.first)
        try await store.rename(id: article.id, title: "My title")
        try await store.setPinned(id: article.id, pinned: false)
        let tag = try await store.createTag(name: "Research", color: "#4DABF7")
        try await store.setTag(articleID: article.id, tagID: tag, attached: true)
        let detail = try await store.article(id: article.id)
        XCTAssertEqual(detail.title, "My title")
        XCTAssertFalse(detail.pinned)
        XCTAssertTrue(detail.tags.contains(tag))
        var annotations = try await store.annotations(articleID: article.id, contentWidth: 720)
        annotations.notes.append(PinnedNote(id: "note", x: 12, y: 30, text: "A note"))
        await store.saveAnnotations(annotations, articleID: article.id)
        let restored = try await store.annotations(articleID: article.id, contentWidth: 720)
        XCTAssertEqual(restored, annotations)
        XCTAssertEqual(store.pendingAnnotationCount, 0)
        XCTAssertNil(store.annotationSyncError)
        XCTAssertFalse(auth.isSignedIn)
        let addedID = try await store.addURL("example.com/a-story")
        let added = try await store.article(id: addedID)
        XCTAssertEqual(added.url, "https://example.com/a-story")
    }
}
