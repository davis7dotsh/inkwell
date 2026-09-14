import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @Bindable var store: InkwellStore
    let authentication: Authentication
    let onLeaveDemo: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var search = ""
    @State private var selectedTags: Set<String> = []
    @State private var oldestFirst = false
    @State private var showCapture = false
    @State private var showImporter = false
    @State private var showTags = false
    @State private var captureURL = ""
    @State private var busy = false
    @State private var error: String?
    @State private var renaming: Article?
    @State private var newTitle = ""
    @State private var deleting: Article?
    @State private var tagging: Article?

    private var filteredArticles: [Article] {
        let activeTags = selectedTags.intersection(store.tags.map(\.id))
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.articles.filter { article in
            (activeTags.isEmpty || !activeTags.isDisjoint(with: article.tags)) &&
            (query.isEmpty || [article.title, article.siteName ?? "", article.excerpt ?? ""]
                .contains { $0.localizedCaseInsensitiveContains(query) })
        }.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            if a.savedAt == b.savedAt { return a.id < b.id }
            return oldestFirst ? a.savedAt < b.savedAt : a.savedAt > b.savedAt
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if store.isDemo {
                    HStack {
                        Label("Sample library", systemImage: "book.closed")
                        Spacer()
                        Button("Sign in", action: onLeaveDemo)
                    }
                    .font(.footnote).padding(.horizontal, 24).padding(.vertical, 9)
                    .background(InkwellTheme.mist)
                    .accessibilityIdentifier("demoBanner")
                }
                if showCapture { capture }
                if let message = error ?? store.error {
                    HStack(alignment: .top) {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(.callout).foregroundStyle(.red)
                        Spacer()
                        Button("Retry") { Task { await store.refresh() } }
                        Button { error = nil; store.error = nil } label: {
                            Image(systemName: "xmark")
                        }.accessibilityLabel("Dismiss error")
                    }.padding()
                }
                if store.pendingAnnotationCount > 0 {
                    HStack {
                        Label("Annotations waiting to sync", systemImage: "icloud.and.arrow.up")
                        Spacer()
                        Button("Retry") { Task { await store.syncAnnotations() } }
                    }.font(.footnote).padding(.horizontal, 24).padding(.vertical, 8)
                }
                library
            }
            .background(InkwellTheme.paper)
            .navigationTitle("Inkwell")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $search, prompt: "Search your library")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        if store.isDemo {
                            Button("Leave sample library", action: onLeaveDemo)
                        } else {
                            Button("Sign out", role: .destructive) {
                                Task { await authentication.signOut() }
                            }
                        }
                    } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu {
                        Button(oldestFirst ? "Newest first" : "Oldest first") { oldestFirst.toggle() }
                        Divider()
                        ForEach(store.tags) { tag in
                            Button {
                                if selectedTags.contains(tag.id) { selectedTags.remove(tag.id) }
                                else { selectedTags.insert(tag.id) }
                            } label: {
                                Label(tag.name, systemImage: selectedTags.contains(tag.id) ? "checkmark.circle.fill" : "circle")
                            }
                        }
                        if !selectedTags.isEmpty { Button("Clear filters") { selectedTags.removeAll() } }
                        Divider()
                        Button("Manage tags", systemImage: "tag") { showTags = true }
                    } label: { Image(systemName: selectedTags.isEmpty ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill") }
                    .accessibilityLabel("Filter and sort")
                    Button {
                        showCapture.toggle()
                    } label: { Label(showCapture ? "Close" : "Add", systemImage: showCapture ? "xmark" : "plus") }
                    .accessibilityIdentifier("addArticle")
                    .keyboardShortcut("n", modifiers: .command)
                }
            }
            .navigationDestination(for: String.self) { id in
                ArticleDestination(articleID: id, store: store)
            }
            .sheet(isPresented: $showTags) { TagManagerView(store: store) }
            .sheet(item: $tagging) { article in TagManagerView(store: store, article: article) }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf]) { result in
                switch result {
                case .success(let url):
                    perform {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        _ = try await store.importPDF(url)
                        showCapture = false
                    }
                case .failure(let failure): error = failure.localizedDescription
                }
            }
            .alert("Rename article", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { article in
                TextField("Title", text: $newTitle)
                Button("Cancel", role: .cancel) { renaming = nil }
                Button("Save") {
                    let title = newTitle
                    perform { try await store.rename(id: article.id, title: title) }
                    renaming = nil
                }.disabled(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .alert("Delete article?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { article in
                Button("Cancel", role: .cancel) { deleting = nil }
                Button("Delete", role: .destructive) {
                    perform { try await store.delete(id: article.id) }
                    deleting = nil
                }
            } message: { article in Text(article.title) }
            .task {
                await store.refresh()
            }
            .task(id: scenePhase) {
                guard scenePhase == .active, !store.isDemo else { return }
                var delay = 30
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(delay)) } catch { break }
                    guard !Task.isCancelled, scenePhase == .active else { break }
                    guard !store.isLoading else { continue }
                    let refreshed = await store.refresh()
                    delay = refreshed ? 30 : min(delay * 2, 300)
                }
            }
        }
    }

    private var library: some View {
        List {
            if !selectedTags.isEmpty {
                HStack {
                    Text(store.tags.filter { selectedTags.contains($0.id) }.map(\.name).joined(separator: ", "))
                        .font(.footnote).foregroundStyle(InkwellTheme.secondary)
                    Spacer()
                    Button("Clear") { selectedTags.removeAll() }.font(.footnote)
                }.listRowBackground(InkwellTheme.paper)
            }
            ForEach(filteredArticles) { article in
                Group {
                    if article.status == "ready" {
                        NavigationLink(value: article.id) { articleRow(article) }
                    } else {
                        articleRow(article)
                    }
                }
                .accessibilityIdentifier("articleRow-\(article.id)")
                .listRowBackground(InkwellTheme.paper)
                .listRowSeparatorTint(InkwellTheme.hairline)
                .listRowInsets(EdgeInsets(top: 18, leading: 24, bottom: 18, trailing: 24))
                .contextMenu { actions(article) }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", role: .destructive) { deleting = article }
                    Button("Rename") { renaming = article; newTitle = article.title }.tint(InkwellTheme.accent)
                }
                .swipeActions(edge: .leading) {
                    Button(article.pinned ? "Unpin" : "Pin", systemImage: "pin") {
                        perform { try await store.setPinned(id: article.id, pinned: !article.pinned) }
                    }.tint(InkwellTheme.accent)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await store.refresh() }
        .accessibilityIdentifier("libraryList")
        .overlay {
            if filteredArticles.isEmpty {
                if store.isLoading && store.articles.isEmpty {
                    ProgressView("Loading your library")
                } else {
                    ContentUnavailableView {
                        Label(search.isEmpty && selectedTags.isEmpty ? "Your library is ready" : "No matching articles", systemImage: "books.vertical")
                    } description: {
                        Text(search.isEmpty && selectedTags.isEmpty ? "Save an article or import a PDF to begin." : "Try another search or clear your filters.")
                    } actions: {
                        if search.isEmpty && selectedTags.isEmpty { Button("Add article") { showCapture = true } }
                        else {
                            Button("Clear filters") { search = ""; selectedTags.removeAll() }
                                .accessibilityIdentifier("clearLibraryFilters")
                        }
                    }
                }
            }
        }
    }

    private func articleRow(_ article: Article) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if article.pinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(InkwellTheme.accent).accessibilityLabel("Pinned") }
                    if article.readStatus == "unread" && article.status == "ready" {
                        Circle().fill(InkwellTheme.accent).frame(width: 6, height: 6).accessibilityLabel("Unread")
                    }
                    Text(article.title).font(InkwellTheme.serif(21, weight: .bold))
                        .foregroundStyle(InkwellTheme.ink).lineLimit(2)
                }
                HStack(spacing: 8) {
                    if article.kind == "pdf" { Image(systemName: "doc.richtext").accessibilityLabel("PDF") }
                    if let site = article.siteName { Text(site).lineLimit(1) }
                    Text(Date(timeIntervalSince1970: article.savedAt / 1000), format: .dateTime.month(.abbreviated).day())
                    if article.readStatus == "read" { Image(systemName: "checkmark").accessibilityLabel("Read") }
                }.font(.caption).foregroundStyle(InkwellTheme.secondary)
                if let excerpt = article.excerpt, !excerpt.isEmpty {
                    Text(excerpt).font(.subheadline).lineLimit(2).foregroundStyle(InkwellTheme.secondary)
                }
                let labels = store.tags.filter { article.tags.contains($0.id) }
                if !labels.isEmpty {
                    Text(labels.map(\.name).joined(separator: " · ")).font(.caption).foregroundStyle(InkwellTheme.accent)
                }
                if article.status == "pending" {
                    HStack { ProgressView().controlSize(.mini); Text("Preparing article…") }.font(.caption)
                } else if article.status == "failed" {
                    Text(article.error ?? "Couldn’t prepare this article.").font(.caption).foregroundStyle(.red)
                    if !article.url.hasPrefix("upload://") {
                        Button("Retry") { perform { try await store.retryArticle(article) } }.font(.callout)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Menu { actions(article) } label: {
                Image(systemName: "ellipsis").frame(width: 32, height: 36).contentShape(Rectangle())
            }.buttonStyle(.borderless).accessibilityLabel("Actions for \(article.title)")
                .accessibilityIdentifier("articleActions-\(article.id)")
        }.padding(.vertical, 2)
    }

    @ViewBuilder private func actions(_ article: Article) -> some View {
        Button(article.pinned ? "Unpin" : "Pin to top", systemImage: "pin") {
            perform { try await store.setPinned(id: article.id, pinned: !article.pinned) }
        }
        Button("Tags", systemImage: "tag") { tagging = article }
        Button("Rename", systemImage: "pencil") { renaming = article; newTitle = article.title }
        Button(article.readStatus == "read" ? "Mark unread" : "Mark read", systemImage: "checkmark") {
            perform { try await store.setReadStatus(id: article.id, status: article.readStatus == "read" ? "unread" : "read") }
        }
        Button("Delete", systemImage: "trash", role: .destructive) { deleting = article }
    }

    private var capture: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                TextField("Article URL", text: $captureURL).textContentType(.URL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("captureURL").onSubmit(saveURL)
                PasteButton(payloadType: String.self) { values in captureURL = values.first ?? "" }
                    .labelStyle(.iconOnly)
            }.padding(12).background(InkwellTheme.leaf, in: RoundedRectangle(cornerRadius: 12))
            HStack {
                Button("Import PDF", systemImage: "doc.badge.plus") { showImporter = true }
                Spacer()
                if busy { ProgressView() }
                Button("Save", action: saveURL).buttonStyle(.borderedProminent)
                    .disabled(busy || captureURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("saveArticle")
            }
        }.padding(.horizontal, 24).padding(.vertical, 16)
    }

    private func saveURL() {
        perform {
            _ = try await store.addURL(captureURL)
            captureURL = ""
            showCapture = false
        }
    }

    private func perform(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do { try await operation() } catch { self.error = error.localizedDescription }
        }
    }
}

private struct ArticleDestination: View {
    let articleID: String
    let store: InkwellStore
    @State private var article: Article?
    @State private var error: String?
    var body: some View {
        Group {
            if let article { ReaderView(article: article, store: store) }
            else if let error {
                ContentUnavailableView {
                    Label("Couldn’t open article", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: { Button("Retry") { Task { await load() } } }
            } else { ProgressView("Opening article") }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(InkwellTheme.paper)
            .task(id: articleID) { await load() }
    }
    private func load() async {
        error = nil
        do { article = try await store.article(id: articleID) }
        catch { self.error = error.localizedDescription }
    }
}
