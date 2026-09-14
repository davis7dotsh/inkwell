import Foundation

/// Only selected by the explicit --demo launch argument or simulator demo action.
/// Live requests never silently fall back to sample content.
enum DemoLibrary {
    static func make() -> CachedLibrary {
        let tags = [
            ArticleTag(id: "demo-design", name: "Design", color: "#4DABF7"),
            ArticleTag(id: "demo-ideas", name: "Ideas", color: "#A78BFA"),
            ArticleTag(id: "demo-reading", name: "Long reads", color: "#F59E0B")
        ]
        let content = [
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "The most useful tools get out of the way. A notebook, a good pen, an empty margin: each gives an idea enough room to become something more.")]),
            ContentBlock(type: "heading", level: 2, spans: [TextSpan(text: "A little room to think")]),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "Reading is more than collecting information. "), TextSpan(text: "It is a conversation with an idea.", italic: true), TextSpan(text: " We underline a sentence, draw a connection, or write a question in the margin. Those small acts turn someone else's words into our own understanding.")]),
            ContentBlock(type: "quote", spans: [TextSpan(text: "Pay attention. Be astonished. Tell about it.", italic: true), TextSpan(text: " — Mary Oliver")]),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "On a screen, that conversation should feel as natural as paper. The page stays still while the pencil moves. Your notes remain beside the passage that inspired them. The tools are close at hand, but the words come first.")]),
            ContentBlock(type: "heading", level: 2, spans: [TextSpan(text: "Make the margin yours")]),
            ContentBlock(type: "list", ordered: false, items: [
                [TextSpan(text: "Underline ", bold: true), TextSpan(text: "the thought you want to remember.")],
                [TextSpan(text: "Ask ", bold: true), TextSpan(text: "the question the author left unanswered.")],
                [TextSpan(text: "Connect ", bold: true), TextSpan(text: "an idea to something you already know.")],
                [TextSpan(text: "Say it aloud ", bold: true), TextSpan(text: "when a voice memo captures more than a sentence.")]
            ]),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "Try the pencil and highlighter in the toolbar, draw a box around a passage, or pin a note beside it. Your annotations follow the text when you adjust the reading size.")]),
            ContentBlock(type: "heading", level: 2, spans: [TextSpan(text: "Small details, lasting value")]),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "A library becomes valuable when it reflects what matters to you. Organize a few articles with tags. Pin the ones you return to. Mark a piece as read when you finish, or keep it in progress while the ideas settle.")]),
            ContentBlock(type: "rule"),
            ContentBlock(type: "paragraph", spans: [TextSpan(text: "This is a local demonstration of Inkwell's native reader. Sign in to read and annotate your existing library.")])
        ]
        let now = Date.now.timeIntervalSince1970 * 1000
        // Static, compile-time fixtures use the same Codable wire model as real articles.
        let encoded = (try? jsonString(content)) ?? "[]"
        let articles = [
            Article(id: "demo-margins", url: "https://inkwell.davis7.sh", title: "The art of paying attention", byline: "Inkwell", siteName: "The reading room", excerpt: "A little space to read closely, make connections, and think for yourself.", blocksJson: encoded, savedAt: now, readStatus: "in_progress", pinned: true, tags: ["demo-design", "demo-ideas"]),
            Article(id: "demo-tools", url: "https://example.com/tools-for-thought", title: "Good tools leave room for thought", byline: "The Inkwell editors", siteName: "Field notes", excerpt: "Why the best creative tools feel simple, considered, and quietly capable.", blocksJson: encoded, savedAt: now - 86400000, tags: ["demo-design"]),
            Article(id: "demo-slow", url: "https://example.com/reading-slowly", title: "In praise of reading slowly", siteName: "Commonplace", excerpt: "Some ideas deserve more than a quick scroll. A case for making time to read.", blocksJson: encoded, savedAt: now - 172800000, tags: ["demo-reading"]),
            Article(id: "demo-connections", url: "https://example.com/unexpected-connections", title: "Where unexpected connections begin", siteName: "Small observations", excerpt: "Keep a question in the margin. You never know where it might lead.", blocksJson: encoded, savedAt: now - 259200000, readStatus: "read", tags: ["demo-ideas"])
        ]
        return CachedLibrary(articles: articles, tags: tags, details: Dictionary(uniqueKeysWithValues: articles.map { ($0.id, $0) }))
    }
}
