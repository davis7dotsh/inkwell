import XCTest
@testable import Inkwell

final class MarkdownExporterTests: XCTestCase {
    func testNestedBackticksKeepCodeIntact() {
        let block = ContentBlock(type: "code", text: "const example = `value`;\n```\nend")
        XCTAssertEqual(MarkdownExporter.blockMarkdown(block), "````\nconst example = `value`;\n```\nend\n````")
        XCTAssertEqual(MarkdownExporter.spanMarkdown(TextSpan(text: "`value`", code: true)), "`` `value` ``")
    }

    func testRichTextAndImageDestinationsRemainMarkdown() {
        let span = TextSpan(text: "literal [brackets]", bold: true, italic: true, href: "https://example.com/a(b)")
        XCTAssertEqual(MarkdownExporter.spanMarkdown(span), "[***literal \\[brackets\\]***](https://example.com/a\\(b\\))")
        let image = ContentBlock(type: "image", src: "https://example.com/image one.png", alt: "An image", caption: "A caption")
        XCTAssertEqual(MarkdownExporter.blockMarkdown(image), "![An image](https://example.com/image%20one.png)\n*A caption*")
    }

    func testExportIncludesCompleteArticleAndResolvesScaledAnnotations() throws {
        let blocks = [
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "First passage.")]),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "Second passage.")])
        ]
        let article = Article(id: "test", url: "https://example.com/article", title: "An article", blocksJson: String(decoding: try JSONEncoder().encode(blocks), as: UTF8.self), savedAt: 0)
        let annotations = AnnotationSet(
            contentWidth: 100,
            boxes: [AnnotationBox(id: "box", x: 0, y: 30, w: 100, h: 10)],
            notes: [PinnedNote(id: "note", x: 0, y: 32, text: "Check the source.")],
            memos: [VoiceMemo(id: "memo", x: 0, y: 32, durationMs: 90_000, transcript: "Follow up on this.", status: "uploaded", createdAt: 0)]
        )
        let layouts = [0: CGRect(x: 0, y: 0, width: 200, height: 20), 1: CGRect(x: 0, y: 60, width: 200, height: 20)]
        let result = MarkdownExporter.build(article: article, annotations: annotations, layouts: layouts, layoutWidth: 200)
        XCTAssertTrue(result.contains("First passage.\n\nSecond passage."))
        XCTAssertTrue(result.contains("## Key sections (boxed by me)\n\n> Second passage."))
        XCTAssertTrue(result.contains("“Check the source.” — near: “Second passage.”"))
        XCTAssertTrue(result.contains("1970-01-01T00:00:00Z · 1:30 — “Follow up on this.” — near: “Second passage.”"))
    }

    func testMissingGeometryDoesNotInventAnnotationContext() throws {
        let blocks = [ContentBlock(type: "paragraph", spans: [TextSpan(text: "A passage.")])]
        let article = Article(id: "test", url: "https://example.com", title: "Article", blocksJson: String(decoding: try JSONEncoder().encode(blocks), as: UTF8.self))
        let annotations = AnnotationSet(contentWidth: 100, notes: [PinnedNote(id: "note", x: 10, y: 20, text: "A note.")])
        let result = MarkdownExporter.build(article: article, annotations: annotations, layouts: [:], layoutWidth: 100)
        XCTAssertTrue(result.contains("A passage."))
        XCTAssertTrue(result.contains("“A note.”"))
        XCTAssertFalse(result.contains("— near:"))
    }

    func testVoiceMemoWithoutTranscriptRetainsDurationAndDate() {
        let article = Article(id: "test", url: "https://example.com", title: "Article", savedAt: 0)
        let annotations = AnnotationSet(contentWidth: 100, memos: [VoiceMemo(id: "memo", x: 0, y: 0, durationMs: 5_000, transcript: "", status: "local", createdAt: 0)])
        let result = MarkdownExporter.build(article: article, annotations: annotations, layouts: [:], layoutWidth: 100)
        XCTAssertTrue(result.contains("1970-01-01T00:00:00Z · 0:05 — No transcript available."))
    }
}
