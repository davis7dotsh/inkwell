import SwiftUI

struct TagManagerView: View {
    @Bindable var store: InkwellStore
    var article: Article?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var error: String?
    @State private var busy = false
    @State private var renaming: ArticleTag?
    @State private var deleting: ArticleTag?
    @State private var renamed = ""

    private var attachedIDs: [String] {
        guard let article else { return [] }
        return store.articles.first(where: { $0.id == article.id })?.tags ?? article.tags
    }

    var body: some View {
        NavigationStack {
            List {
                HStack {
                    TextField("New tag", text: $name).onSubmit(create)
                        .accessibilityIdentifier("newTagName")
                    Button("Add", action: create)
                        .disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("createTag")
                }.listRowBackground(InkwellTheme.leaf)
                if let error { Text(error).foregroundStyle(.red).font(.callout) }
                ForEach(store.tags) { tag in
                    HStack {
                        if let article {
                            Button {
                                perform {
                                    try await store.setTag(articleID: article.id, tagID: tag.id, attached: !attachedIDs.contains(tag.id))
                                }
                            } label: {
                                HStack {
                                    Image(systemName: attachedIDs.contains(tag.id) ? "checkmark.circle.fill" : "circle")
                                    Text(tag.name).foregroundStyle(InkwellTheme.ink)
                                    Spacer()
                                }.contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            .accessibilityLabel("\(attachedIDs.contains(tag.id) ? "Remove" : "Add") tag \(tag.name)")
                        } else {
                            Label(tag.name, systemImage: "tag").foregroundStyle(InkwellTheme.ink)
                            Spacer()
                        }
                        Menu {
                            Button("Rename", systemImage: "pencil") { renaming = tag; renamed = tag.name }
                            Menu("Color", systemImage: "paintpalette") {
                                ForEach(tagColors, id: \.name) { color in
                                    Button(color.name) { perform { try await store.setTagColor(id: tag.id, color: color.hex) } }
                                }
                                Button("Default") { perform { try await store.setTagColor(id: tag.id, color: nil) } }
                            }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = tag }
                        } label: { Image(systemName: "ellipsis").frame(width: 44, height: 36) }
                        .accessibilityLabel("Edit tag \(tag.name)")
                    }.listRowBackground(InkwellTheme.leaf)
                }
            }
            .scrollContentBackground(.hidden).background(InkwellTheme.paper)
            .navigationTitle(article == nil ? "Tags" : "Article tags")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Rename tag", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { tag in
                TextField("Name", text: $renamed)
                Button("Cancel", role: .cancel) { renaming = nil }
                Button("Save") {
                    let value = renamed
                    perform { try await store.renameTag(id: tag.id, name: value) }
                    renaming = nil
                }.disabled(renamed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .alert("Delete tag?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { tag in
                Button("Cancel", role: .cancel) { deleting = nil }
                Button("Delete", role: .destructive) {
                    perform { try await store.deleteTag(id: tag.id) }
                    deleting = nil
                }
            } message: { tag in Text("This removes “\(tag.name)” from your articles.") }
        }.presentationDetents([.medium, .large])
    }

    private var tagColors: [(name: String, hex: String)] {
        [("Blue", "#1F5B8B"), ("Red", "#B0413E"), ("Green", "#50785C"), ("Purple", "#766492"), ("Gray", "#526576")]
    }

    private func create() {
        let value = name
        perform {
            let id = try await store.createTag(name: value)
            if let article { try await store.setTag(articleID: article.id, tagID: id, attached: true) }
            name = ""
        }
    }

    private func perform(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do { try await operation(); error = nil }
            catch { self.error = error.localizedDescription }
        }
    }
}
