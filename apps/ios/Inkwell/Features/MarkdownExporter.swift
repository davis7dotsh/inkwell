import Foundation
import SwiftUI
import UIKit

enum MarkdownExporter {
    /// Includes the complete source article and resolves annotations using the
    /// same measured block geometry as the reader, including imported RN ink.
    static func build(article: Article, annotations: AnnotationSet, layouts: [Int: CGRect], layoutWidth: CGFloat) -> String {
        let blocks = article.blocks
        let snapshot = ReaderLayoutSnapshot(json: annotations.layoutJson)
        let measured = layouts.isEmpty ? (snapshot?.layouts ?? [:]) : layouts
        let width = layouts.isEmpty ? (snapshot?.width ?? annotations.contentWidth) : Double(layoutWidth)
        let mapped = ReaderGeometry.remap(annotations, to: ReaderLayoutSnapshot(width: width, layouts: measured))
        var lines = ["# \(escapeText(article.title))", "", "Source: \(article.url)"]
        if let byline = article.byline, !byline.isEmpty { lines.append("By: \(escapeText(byline))") }
        lines.append("Saved: \(timestamp(article.savedAt))")
        lines.append("")
        lines.append(blocks.map(blockMarkdown).filter { !$0.isEmpty }.joined(separator: "\n\n"))

        func indices(top: Double, bottom: Double) -> [Int] {
            measured.filter { index, frame in
                blocks.indices.contains(index) && frame.maxY >= min(top, bottom) && frame.minY <= max(top, bottom)
            }.keys.sorted()
        }
        func nearest(y: Double) -> Int? {
            measured.keys.sorted().filter { blocks.indices.contains($0) }.min { lhs, rhs in
                guard let left = measured[lhs], let right = measured[rhs] else { return lhs < rhs }
                let leftDistance = max(left.minY - y, y - left.maxY, 0)
                let rightDistance = max(right.minY - y, y - right.maxY, 0)
                return leftDistance < rightDistance
            }
        }
        func quoted(_ selection: [Int]) -> String {
            selection.map { blockText(blocks[$0]) }.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                .map { $0.components(separatedBy: "\n").map { "> \(escapeText($0))" }.joined(separator: "\n") }
                .joined(separator: "\n>\n")
        }
        func context(y: Double) -> String {
            guard let index = nearest(y: y) else { return "" }
            let text = truncated(blockText(blocks[index]), limit: 160)
            return text.isEmpty ? "" : " — near: “\(escapeText(text))”"
        }
        func appendSection(_ title: String, _ paragraphs: [String]) {
            let content = paragraphs.filter { !$0.isEmpty }
            guard !content.isEmpty else { return }
            lines.append(contentsOf: ["", "## \(title)", "", content.joined(separator: "\n\n")])
        }

        appendSection("Key sections (boxed by me)", mapped.boxes.sorted { $0.y < $1.y }.map {
            quoted(indices(top: $0.y, bottom: $0.y + $0.h))
        })

        var highlighted = Set<Int>()
        let highlights = mapped.strokes.filter { $0.tool == "highlighter" }.compactMap { stroke -> String? in
            guard let top = stroke.points.map(\.y).min(), let bottom = stroke.points.map(\.y).max() else { return nil }
            let selection = indices(top: top, bottom: bottom).filter { highlighted.insert($0).inserted }
            return quoted(selection)
        }
        appendSection("Highlighted passages", highlights)

        let notes = mapped.notes.sorted { $0.y < $1.y }.compactMap { note -> String? in
            let text = note.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return "- “\(escapeText(text).replacingOccurrences(of: "\n", with: "\n  "))”\(context(y: note.y))"
        }
        appendSection("My notes", notes.isEmpty ? [] : [notes.joined(separator: "\n")])

        let memos = mapped.memos.sorted { $0.y < $1.y }.map { memo in
            let transcript = memo.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            let text = transcript.isEmpty ? "No transcript available." : "“\(escapeText(transcript).replacingOccurrences(of: "\n", with: "\n  "))”"
            return "- \(timestamp(memo.createdAt)) · \(duration(memo.durationMs)) — \(text)\(context(y: memo.y))"
        }
        appendSection("Voice memos", memos.isEmpty ? [] : [memos.joined(separator: "\n")])

        let penStrokes = mapped.strokes.filter { $0.tool == "pen" }
        if !penStrokes.isEmpty {
            let marked = Set(penStrokes.flatMap { stroke -> [Int] in
                guard let top = stroke.points.map(\.y).min(), let bottom = stroke.points.map(\.y).max() else { return [] }
                return indices(top: top, bottom: bottom)
            }).sorted()
            let passages = marked.map { truncated(blockText(blocks[$0]), limit: 160) }.filter { !$0.isEmpty }
            var description = "\(penStrokes.count) pen stroke\(penStrokes.count == 1 ? "" : "s")"
            if !passages.isEmpty {
                description += " over:\n" + passages.map { "- “\(escapeText($0))”" }.joined(separator: "\n")
            } else { description += "." }
            appendSection("Handwritten marks", [description])
        }
        lines.append(contentsOf: ["", "---", "Exported from Inkwell.", ""])
        return lines.joined(separator: "\n")
    }

    static func write(article: Article, annotations: AnnotationSet, layouts: [Int: CGRect], layoutWidth: CGFloat) throws -> URL {
        // A corrupt payload must report an error instead of exporting an apparently empty article.
        _ = try article.decodedBlocks()
        try annotations.validate()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("InkwellExports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeTitle = article.title.components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }.joined(separator: "-")
        let name = safeTitle.isEmpty ? "Inkwell-article" : String(safeTitle.prefix(100))
        let url = directory.appendingPathComponent(name).appendingPathExtension("md")
        try build(article: article, annotations: annotations, layouts: layouts, layoutWidth: layoutWidth)
            .write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    static func blockMarkdown(_ block: ContentBlock) -> String {
        let text = (block.spans ?? []).map(spanMarkdown).joined()
        switch block.type {
        case "heading": return String(repeating: "#", count: min(6, max(1, block.level ?? 1))) + " " + text
        case "paragraph": return text
        case "quote": return text.components(separatedBy: "\n").map { "> \($0)" }.joined(separator: "\n")
        case "list":
            return (block.items ?? []).enumerated().map { index, item in
                let marker = block.ordered == true ? "\(index + 1). " : "- "
                let indent = String(repeating: " ", count: marker.count)
                return marker + item.map(spanMarkdown).joined().replacingOccurrences(of: "\n", with: "\n\(indent)")
            }.joined(separator: "\n")
        case "code":
            let source = block.text ?? ""
            let fence = String(repeating: "`", count: max(3, longestBacktickRun(source) + 1))
            return "\(fence)\n\(source)\n\(fence)"
        case "image":
            let image = "![\(escapeText(block.alt ?? ""))](\(linkDestination(block.src ?? "")))"
            if let caption = block.caption, !caption.isEmpty { return "\(image)\n*\(escapeText(caption))*" }
            return image
        case "rule": return "---"
        default: return escapeText(block.plainText)
        }
    }

    static func spanMarkdown(_ span: TextSpan) -> String {
        guard !span.text.isEmpty else { return "" }
        var text = escapeText(span.text)
        if span.code == true {
            let fence = String(repeating: "`", count: longestBacktickRun(span.text) + 1)
            let pad = span.text.hasPrefix("`") || span.text.hasSuffix("`") ? " " : ""
            text = "\(fence)\(pad)\(span.text)\(pad)\(fence)"
        }
        if span.bold == true { text = "**\(text)**" }
        if span.italic == true { text = "*\(text)*" }
        if let href = span.href { text = "[\(text)](\(linkDestination(href)))" }
        return text
    }

    private static func blockText(_ block: ContentBlock) -> String {
        switch block.type {
        case "list": return (block.items ?? []).enumerated().map { index, spans in
            (block.ordered == true ? "\(index + 1). " : "• ") + spans.map(\.text).joined()
        }.joined(separator: "\n")
        case "image": return "\(block.caption ?? block.alt ?? "Image") (\(block.src ?? ""))"
        default: return block.plainText
        }
    }

    private static func escapeText(_ text: String) -> String {
        text.reduce(into: "") { result, character in
            if "\\`*_[]<>#".contains(character) { result.append("\\") }
            result.append(character)
        }
    }

    private static func linkDestination(_ text: String) -> String {
        text.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "(", with: "\\(")
            .replacingOccurrences(of: ")", with: "\\)")
            .replacingOccurrences(of: " ", with: "%20")
            .replacingOccurrences(of: "\n", with: "%0A")
            .replacingOccurrences(of: "\r", with: "%0D")
    }

    private static func longestBacktickRun(_ text: String) -> Int {
        var longest = 0
        var current = 0
        for character in text {
            current = character == "`" ? current + 1 : 0
            longest = max(longest, current)
        }
        return longest
    }

    private static func truncated(_ text: String, limit: Int) -> String {
        let clean = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return clean.count > limit ? String(clean.prefix(limit - 1)) + "…" : clean
    }

    private static func timestamp(_ milliseconds: Double) -> String {
        ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: (milliseconds.isFinite ? milliseconds : 0) / 1_000))
    }

    private static func duration(_ milliseconds: Double) -> String {
        let total = Int(min(Double(Int32.max), max(0, milliseconds.isFinite ? milliseconds / 1_000 : 0)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

struct MarkdownShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
