import SwiftUI

struct ReaderView: View {
    let article: Article
    let store: InkwellStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("reader.fingerDrawing") private var fingerDrawing = false
    @State private var document: Article?
    @State private var blocks: [ContentBlock] = []
    @State private var annotations: AnnotationSet?
    @State private var layouts: [Int: CGRect] = [:]
    @State private var columnWidth: CGFloat = 700
    @State private var loading = true
    @State private var contentError: String?
    @State private var annotationError: String?
    @State private var actionError: String?
    @State private var tool: ReaderTool = .read
    @State private var inkColor = "#1B4F8A"
    @State private var toolsHidden = false
    @State private var undoStack: [AnnotationSet] = []
    @State private var redoStack: [AnnotationSet] = []
    @State private var outlineOpen = false
    @State private var activeHeading = -1
    @State private var sheet: ReaderSheet?
    @State private var dirty = false
    @State private var progress = 0.0

    private var current: Article { document ?? article }
    private var compact: Bool { sizeClass == .compact }
    private var headings: [(index: Int, title: String, level: Int)] {
        blocks.enumerated().compactMap { index, block in
            guard block.type == "heading", !block.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return (index, block.plainText, block.level ?? 1)
        }
    }

    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { scroll in
                HStack(spacing: 0) {
                    if viewport.size.width >= 1250, !headings.isEmpty {
                        outline { index in navigate(to: index, using: scroll) }
                            .frame(width: 230)
                            .padding(.leading, 12)
                        Rectangle().fill(InkwellTheme.hairline).frame(width: 0.5)
                    }
                    ZStack(alignment: compact ? .bottom : .trailing) {
                        readingSurface(viewport: viewport.size, hasRail: viewport.size.width >= 1250 && !headings.isEmpty)
                        if annotations != nil, !loading, contentError == nil {
                            ReaderToolbar(tool: $tool, inkColor: $inkColor, hidden: $toolsHidden,
                                          fingerDrawing: $fingerDrawing, isCompact: compact,
                                          canUndo: !undoStack.isEmpty, canRedo: !redoStack.isEmpty,
                                          onUndo: undo, onRedo: redo)
                                .padding(compact ? .bottom : .trailing, compact ? 12 : 18)
                        }
                    }
                }
                .sheet(isPresented: $outlineOpen) {
                    NavigationStack {
                        outline { index in navigate(to: index, using: scroll); outlineOpen = false }
                            .navigationTitle("Contents")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { outlineOpen = false } } }
                    }.presentationDetents([.medium, .large])
                }
            }
        }
        .background(InkwellTheme.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(current.sourceName).font(.subheadline).foregroundStyle(InkwellTheme.secondary).lineLimit(1)
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !headings.isEmpty {
                    Button { outlineOpen = true } label: { Image(systemName: "list.bullet.indent") }
                        .accessibilityLabel("Document contents").accessibilityIdentifier("reader-outline")
                }
                Menu {
                    Button("Export Markdown", systemImage: "square.and.arrow.up", action: export)
                        .disabled(annotations == nil || loading)
                    if let url = URL(string: current.url), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                        Button("Open original", systemImage: "safari") { openURL(url) }
                    }
                    Section {
                        Button("Mark as unread", systemImage: "circle") { setReadStatus("unread") }
                        Button("Mark in progress", systemImage: "circle.lefthalf.filled") { setReadStatus("in_progress") }
                        Button("Mark as finished", systemImage: "checkmark.circle") { setReadStatus("read") }
                            .accessibilityIdentifier("reader-mark-finished")
                    }
                    if compact {
                        Button("Redo annotation", systemImage: "arrow.uturn.forward", action: redo).disabled(redoStack.isEmpty)
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("Article actions")
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                GeometryReader { geometry in
                    Rectangle().fill(InkwellTheme.accent.opacity(0.55))
                        .frame(width: geometry.size.width * progress, height: 2)
                }.frame(height: 2).accessibilityHidden(true)
                if let error = annotationError {
                    statusBanner(error, symbol: "exclamationmark.triangle", retry: { Task { await loadAnnotations() } })
                } else if let error = store.annotationSyncError {
                    statusBanner(error, symbol: "icloud.slash", retry: { Task { await store.syncAnnotations() } })
                } else if store.pendingAnnotationCount > 0 {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Saving annotations…").font(.caption) }
                        .padding(8).frame(maxWidth: .infinity).background(InkwellTheme.leaf)
                }
            }
        }
        .sheet(item: $sheet) { value in readerSheet(value) }
        .alert("Couldn't complete the action", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
        .task(id: article.id) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { persistCurrent() }
        }
        .onDisappear { persistCurrent() }
    }

    private func readingSurface(viewport: CGSize, hasRail: Bool) -> some View {
        let availableWidth = viewport.width - (hasRail ? 243 : 0)
        let width = min(700, max(100, availableWidth - (compact ? 40 : 132)))
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                articleHeader.padding(.bottom, 32).id(-1)
                if loading {
                    ProgressView("Opening article…").frame(maxWidth: .infinity).padding(.vertical, 60)
                } else if let error = contentError {
                    ContentUnavailableView {
                        Label("Couldn't open this article", systemImage: "doc.text.magnifyingglass")
                    } description: { Text(error) } actions: {
                        Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
                    }
                } else if blocks.isEmpty {
                    ContentUnavailableView("No readable content", systemImage: "doc.text", description: Text(current.error ?? "The article is still being prepared. Try opening it again shortly."))
                } else {
                    ArticleBlocksView(blocks: blocks, columnWidth: width)
                    readingFooter.padding(.top, 30).padding(.bottom, compact ? 120 : 90)
                }
            }
            .frame(width: width)
            .padding(.top, 30)
            .coordinateSpace(name: "article-content")
            .overlay(alignment: .topLeading) {
                AnnotationCanvas(annotations: annotations, tool: tool, inkColor: inkColor,
                                 fingerDrawing: fingerDrawing || (compact && tool == .eraser),
                                 onChange: commit,
                                 onNote: { note, point in sheet = .note(note, point) },
                                 onMemo: { memo, point in sheet = memo.map(ReaderSheet.player) ?? .record(point) },
                                 onToolChange: { tool = $0 })
            }
            .frame(maxWidth: .infinity)
            .onPreferenceChange(ReaderBlockFrames.self) { frames in applyLayout(frames, width: width) }
        }
        .onScrollGeometryChange(for: ReaderScrollPosition.self) { geometry in
            let scrollable = geometry.contentSize.height - geometry.containerSize.height
            return ReaderScrollPosition(offset: geometry.contentOffset.y + geometry.contentInsets.top,
                                        progress: scrollable > 0 ? max(0, min(1, (geometry.contentOffset.y + geometry.contentInsets.top) / scrollable)) : 0)
        } action: { _, position in
            progress = position.progress
            activeHeading = headings.last(where: { (layouts[$0.index]?.minY ?? .infinity) <= position.offset + 88 })?.index ?? -1
        }
        .onAppear { columnWidth = width }
        .onChange(of: width) { _, next in columnWidth = next }
        .accessibilityIdentifier("article-reader")
    }

    private var articleHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(current.title)
                .font(InkwellTheme.serif(compact ? 30 : 36, weight: .bold))
                .foregroundStyle(InkwellTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                if let byline = current.byline, !byline.isEmpty { Text(byline); Text("·").accessibilityHidden(true) }
                Text(current.savedDate, style: .date)
            }.font(.subheadline).foregroundStyle(InkwellTheme.secondary)
            if let excerpt = current.excerpt, !excerpt.isEmpty {
                Text(excerpt).font(InkwellTheme.serif(18)).foregroundStyle(InkwellTheme.secondary)
                    .lineSpacing(7).textSelection(.enabled)
            }
        }
    }

    private var readingFooter: some View {
        VStack(spacing: 20) {
            Divider().overlay(InkwellTheme.hairline)
            Button {
                setReadStatus(current.readStatus == "read" ? "unread" : "read")
            } label: {
                Label(current.readStatus == "read" ? "Finished · Mark unread" : "Mark as finished",
                      systemImage: current.readStatus == "read" ? "checkmark.circle.fill" : "checkmark.circle")
            }.buttonStyle(.bordered).tint(InkwellTheme.accent)
        }.frame(maxWidth: .infinity)
    }

    private func outline(onSelect: @escaping (Int) -> Void) -> some View {
        let rootLevel = headings.map(\.level).min() ?? 1
        return ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                outlineButton("Beginning", index: -1, depth: 0, onSelect: onSelect)
                ForEach(headings, id: \.index) { heading in
                    outlineButton(heading.title, index: heading.index, depth: heading.level - rootLevel, onSelect: onSelect)
                }
            }.padding(16)
        }.background(InkwellTheme.paper)
    }

    private func outlineButton(_ title: String, index: Int, depth: Int, onSelect: @escaping (Int) -> Void) -> some View {
        Button { onSelect(index) } label: {
            Text(title).font(.subheadline).multilineTextAlignment(.leading)
                .foregroundStyle(activeHeading == index ? InkwellTheme.accent : InkwellTheme.secondary)
                .padding(.vertical, 10).padding(.leading, CGFloat(min(depth, 4)) * 12 + 10).padding(.trailing, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(activeHeading == index ? InkwellTheme.mist : .clear, in: RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain)
    }

    private func navigate(to index: Int, using proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(index, anchor: .top) }
    }

    private func statusBanner(_ message: String, symbol: String, retry: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
            Text(message).font(.caption).lineLimit(3)
            Spacer(minLength: 0)
            Button("Retry", action: retry).font(.caption.weight(.semibold))
        }.padding(12).foregroundStyle(InkwellTheme.secondary).background(InkwellTheme.leaf)
    }

    @ViewBuilder private func readerSheet(_ value: ReaderSheet) -> some View {
        switch value {
        case .note(let note, let point):
            NoteEditorSheet(note: note, onSave: { text in
                guard var next = annotations else { return }
                if let note, let index = next.notes.firstIndex(where: { $0.id == note.id }) {
                    next.notes[index].text = text
                } else {
                    next.notes.append(PinnedNote(id: UUID().uuidString, x: point.x, y: point.y, text: text))
                }
                commit(next)
            }, onDelete: {
                guard var next = annotations, let note else { return }
                next.notes.removeAll { $0.id == note.id }; commit(next)
            })
        case .record(let point):
            MemoRecorderSheet(articleID: current.id, anchor: point, store: store) { memo in
                guard var next = annotations else { return }
                next.memos.append(memo); commit(next)
                Task { await uploadMemo(memo) }
            }
        case .player(let memo):
            MemoPlayerSheet(memo: annotations?.memos.first(where: { $0.id == memo.id }) ?? memo,
                            articleID: current.id, store: store,
                            onUpdated: updateMemo, onDelete: {
                guard var next = annotations else { return }
                next.memos.removeAll { $0.id == memo.id }
                // Audio deletion is permanent; earlier undo entries must not resurrect a broken memo.
                undoStack = undoStack.map { value in var value = value; value.memos.removeAll { $0.id == memo.id }; return value }
                redoStack = redoStack.map { value in var value = value; value.memos.removeAll { $0.id == memo.id }; return value }
                annotations = next; dirty = true; persistCurrent()
            })
        case .share(let url): MarkdownShareSheet(url: url)
        }
    }

    private func load() async {
        loading = true; contentError = nil; annotationError = nil
        if document?.id != article.id {
            document = article; annotations = nil; layouts = [:]; blocks = []
            undoStack = []; redoStack = []; dirty = false; tool = .read
        }
        do {
            let fetched = try await store.article(id: article.id)
            document = fetched
            blocks = ReaderDocument.inferHeadings(try fetched.decodedBlocks())
            if fetched.status == "ready", fetched.readStatus == "unread" {
                do {
                    try await store.setReadStatus(id: fetched.id, status: "in_progress")
                    document?.readStatus = "in_progress"
                } catch { actionError = error.localizedDescription }
            }
        } catch { contentError = error.localizedDescription }
        loading = false
        if annotations == nil { await loadAnnotations() }
    }

    private func loadAnnotations() async {
        do {
            let loaded = try await store.annotations(articleID: article.id, contentWidth: Double(columnWidth))
            // A retry cannot overwrite any local edit made while its request was in flight.
            guard annotations == nil else { return }
            annotations = loaded
            annotationError = nil
            applyLayout(layouts, width: columnWidth)
            for memo in loaded.memos where memo.status == "local" { await uploadMemo(memo) }
        } catch { annotationError = "Annotations couldn't load: \(error.localizedDescription)" }
    }

    private func applyLayout(_ frames: [Int: CGRect], width: CGFloat) {
        layouts = frames
        columnWidth = width
        guard frames.count == blocks.count, !frames.isEmpty, let saved = annotations else { return }
        let snapshot = ReaderLayoutSnapshot(width: width, layouts: frames)
        if ReaderLayoutSnapshot(json: saved.layoutJson) == snapshot, saved.contentWidth == width { return }
        annotations = ReaderGeometry.remap(saved, to: snapshot)
        undoStack = undoStack.map { ReaderGeometry.remap($0, to: snapshot) }
        redoStack = redoStack.map { ReaderGeometry.remap($0, to: snapshot) }
    }

    private func commit(_ proposed: AnnotationSet) {
        guard let previous = annotations else { return }
        var next = proposed
        // A completed gesture must not roll back an upload/transcription that finished during it.
        next.memos = next.memos.map { memo in
            guard let latest = previous.memos.first(where: { $0.id == memo.id }) else { return memo }
            var merged = latest
            merged.x = memo.x; merged.y = memo.y
            return merged
        }
        guard previous != next else { return }
        undoStack.append(previous)
        if undoStack.count > 60 { undoStack.removeFirst() }
        redoStack = []
        annotations = next
        dirty = true
        persistCurrent()
    }

    private func undo() {
        guard let current = annotations, let previous = undoStack.popLast() else { return }
        redoStack.append(current); annotations = previous; dirty = true; persistCurrent()
    }

    private func redo() {
        guard let current = annotations, let next = redoStack.popLast() else { return }
        undoStack.append(current); annotations = next; dirty = true; persistCurrent()
    }

    private func persistCurrent() {
        guard dirty, let value = annotations else { return }
        store.stageAnnotations(value, articleID: article.id)
    }

    private func setReadStatus(_ status: String) {
        Task {
            do {
                try await store.setReadStatus(id: current.id, status: status)
                document?.readStatus = status
            } catch { actionError = error.localizedDescription }
        }
    }

    private func updateMemo(_ memo: VoiceMemo) {
        guard var next = annotations, let index = next.memos.firstIndex(where: { $0.id == memo.id }) else { return }
        let old = next.memos[index]
        var updated = memo
        updated.x = old.x; updated.y = old.y
        next.memos[index] = updated
        annotations = next
        func refreshMetadata(_ value: AnnotationSet) -> AnnotationSet {
            var result = value
            if let index = result.memos.firstIndex(where: { $0.id == memo.id }) {
                var entry = memo
                entry.x = result.memos[index].x; entry.y = result.memos[index].y
                result.memos[index] = entry
            }
            return result
        }
        undoStack = undoStack.map(refreshMetadata)
        redoStack = redoStack.map(refreshMetadata)
        dirty = true; persistCurrent()
    }

    private func uploadMemo(_ memo: VoiceMemo) async {
        do {
            let uploaded = try await MemoAudioStore.upload(memo: memo, articleID: article.id, store: store)
            updateMemo(uploaded)
        } catch {
            // The recording remains local and its chip exposes the upload state and retry.
        }
    }

    private func export() {
        guard let annotations else { return }
        do {
            let url = try MarkdownExporter.write(article: current, annotations: annotations, layouts: layouts, layoutWidth: columnWidth)
            sheet = .share(url)
        } catch { actionError = error.localizedDescription }
    }
}

private struct ReaderScrollPosition: Equatable { var offset: CGFloat; var progress: Double }

private enum ReaderSheet: Identifiable {
    case note(PinnedNote?, CGPoint)
    case record(CGPoint)
    case player(VoiceMemo)
    case share(URL)
    var id: String {
        switch self {
        case .note(let note, _): "note-\(note?.id ?? "new")"
        case .record: "record"
        case .player(let memo): "player-\(memo.id)"
        case .share(let url): url.absoluteString
        }
    }
}
