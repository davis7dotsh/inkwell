import SwiftUI

struct ReaderBlockFrames: PreferenceKey {
    static let defaultValue: [Int: CGRect] = [:]
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

struct ArticleBlocksView: View {
    let blocks: [ContentBlock]
    let columnWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                ArticleBlockView(block: block, columnWidth: columnWidth)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background {
                        GeometryReader { proxy in
                            Color.clear.preference(key: ReaderBlockFrames.self,
                                value: [index: proxy.frame(in: .named("article-content"))])
                        }
                    }
                    .id(index)
            }
        }
    }
}

private struct ArticleBlockView: View {
    let block: ContentBlock
    let columnWidth: CGFloat
    @ScaledMetric(relativeTo: .body) private var bodySize = 18.0

    var body: some View {
        switch block.type {
        case "heading":
            richText(block.spans ?? [], size: headingSize, bold: true)
                .lineSpacing(5)
                .padding(.top, 16)
                .padding(.bottom, 12)
                .accessibilityAddTraits(.isHeader)
        case "paragraph":
            richText(block.spans ?? [], size: bodySize)
                .lineSpacing(bodySize * 0.43)
                .padding(.bottom, 20)
        case "quote":
            richText(block.spans ?? [], size: bodySize, italic: true)
                .lineSpacing(bodySize * 0.38)
                .foregroundStyle(InkwellTheme.secondary)
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(InkwellTheme.leaf, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(InkwellTheme.hairline, lineWidth: 0.5))
                .padding(.bottom, 20)
        case "list":
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array((block.items ?? []).enumerated()), id: \.offset) { index, spans in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(block.ordered == true ? "\(index + 1)." : "•")
                            .font(.custom("Georgia", fixedSize: bodySize))
                            .frame(minWidth: 20, alignment: .trailing)
                            .accessibilityHidden(true)
                        richText(spans, size: bodySize).lineSpacing(bodySize * 0.38)
                    }
                }
            }.padding(.bottom, 20)
        case "image":
            figure.padding(.bottom, 22)
        case "code":
            ScrollView(.horizontal) {
                Text(block.text ?? "")
                    .font(.system(size: bodySize * 0.78, design: .monospaced))
                    .lineSpacing(5)
                    .textSelection(.enabled)
                    .padding(16)
            }
            .background(InkwellTheme.leaf, in: RoundedRectangle(cornerRadius: 8))
            .padding(.bottom, 20)
        case "rule":
            Rectangle().fill(InkwellTheme.hairline).frame(height: 0.5)
                .padding(.vertical, 24)
        default:
            EmptyView()
        }
    }

    private var headingSize: CGFloat {
        let sizes: [CGFloat] = [30, 26, 23, 21, 19, 18]
        return sizes[min(max((block.level ?? 2) - 1, 0), 5)] * bodySize / 18
    }

    private func richText(_ spans: [TextSpan], size: CGFloat, bold: Bool = false, italic: Bool = false) -> some View {
        var attributed = AttributedString()
        for span in spans {
            var part = AttributedString(span.text)
            var font = span.code == true
                ? Font.system(size: size * 0.84, design: .monospaced)
                : Font.custom("Georgia", fixedSize: size)
            if bold || span.bold == true { font = font.bold() }
            if italic || span.italic == true { font = font.italic() }
            part.font = font
            if span.code == true { part.backgroundColor = InkwellTheme.mist }
            if let href = span.href, let url = URL(string: href), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                part.link = url
                part.foregroundColor = InkwellTheme.accent
                part.underlineStyle = .single
            }
            attributed.append(part)
        }
        return Text(attributed)
            .foregroundStyle(InkwellTheme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private var figure: some View {
        let naturalWidth = CGFloat(block.width ?? Double(columnWidth))
        let width = min(columnWidth, max(1, naturalWidth))
        let aspect = (block.width ?? 0) > 0 && (block.height ?? 0) > 0
            ? CGFloat((block.width ?? 1) / (block.height ?? 1)) : 16.0 / 9.0
        return VStack(spacing: 9) {
            AsyncImage(url: URL(string: block.src ?? "")) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit()
                case .failure:
                    VStack(spacing: 8) {
                        Image(systemName: "photo")
                        Text(block.alt ?? "Image unavailable").font(.caption)
                    }.foregroundStyle(InkwellTheme.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                default:
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(width: width, height: width / max(aspect, 0.05))
            .background(InkwellTheme.leaf)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(block.alt ?? block.caption ?? "Article image")
            if let caption = block.caption, !caption.isEmpty {
                Text(caption).font(.caption).foregroundStyle(InkwellTheme.secondary)
                    .multilineTextAlignment(.center).textSelection(.enabled)
            }
        }.frame(maxWidth: .infinity)
    }
}

enum ReaderDocument {
    /// PDF section detection matches the shared parser without changing block indices.
    static func inferHeadings(_ blocks: [ContentBlock]) -> [ContentBlock] {
        guard !blocks.contains(where: { $0.type == "heading" }) else { return blocks }
        struct Candidate { var label: String; var parts: [Int]; var title: String }
        func text(_ block: ContentBlock) -> String {
            (block.spans ?? []).map(\.text).joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
        func candidate(_ block: ContentBlock) -> Candidate? {
            guard block.type == "paragraph" else { return nil }
            let value = text(block)
            guard let range = value.range(of: #"^(\d+(?:\.\d+){0,5})\s+"#, options: .regularExpression) else { return nil }
            let label = String(value[range]).trimmingCharacters(in: .whitespaces)
            let title = String(value[range.upperBound...])
            let parts = label.split(separator: ".").compactMap { Int($0) }
            guard !parts.isEmpty, title.count <= (parts.count == 1 ? 80 : 180),
                  title.range(of: #"\s\d+(?:\.\d+)+\s+\S"#, options: .regularExpression) == nil else { return nil }
            return Candidate(label: label, parts: parts, title: title)
        }
        let candidates = blocks.map(candidate)
        guard let start = candidates.indices.first(where: { index in
            guard candidates[index]?.parts == [1] else { return false }
            let following = candidates[(index + 1)..<min(candidates.count, index + 400)].compactMap { $0 }
            return following.contains { $0.parts.count > 1 && $0.parts.first == 1 }
                && following.contains { $0.parts == [2] }
        }) else { return blocks }
        var seen: Set<String> = []
        var chapter = 0
        return blocks.enumerated().map { index, block in
            var next = block
            if index < start {
                if block.type == "paragraph", ["Abstract", "Executive Summary", "Introduction", "Summary"].contains(text(block)) {
                    next.type = "heading"
                    next.level = 1
                }
            } else if let candidate = candidates[index], !seen.contains(candidate.label) {
                if candidate.parts.count == 1 {
                    guard candidate.parts[0] == chapter + 1 else { return block }
                    chapter = candidate.parts[0]
                } else if candidate.parts[0] != chapter { return block }
                seen.insert(candidate.label)
                next.type = "heading"
                next.level = min(candidate.parts.count, 6)
            }
            return next
        }
    }
}
