import SwiftUI

enum ReaderTool: String, CaseIterable, Identifiable {
    case read, pen, highlighter, box, note, memo, eraser
    var id: String { rawValue }
    var title: String {
        switch self {
        case .read: "Read"
        case .pen: "Pen"
        case .highlighter: "Highlighter"
        case .box: "Box"
        case .note: "Note"
        case .memo: "Voice memo"
        case .eraser: "Eraser"
        }
    }
    var symbol: String {
        switch self {
        case .read: "book"
        case .pen: "pencil.tip"
        case .highlighter: "highlighter"
        case .box: "rectangle.dashed"
        case .note: "note.text.badge.plus"
        case .memo: "mic"
        case .eraser: "eraser"
        }
    }
}

struct ReaderToolbar: View {
    @Binding var tool: ReaderTool
    @Binding var inkColor: String
    @Binding var hidden: Bool
    @Binding var fingerDrawing: Bool
    let isCompact: Bool
    let canUndo: Bool
    let canRedo: Bool
    let onUndo: () -> Void
    let onRedo: () -> Void
    private let inks = [("#0E2E52", "Deep ink"), ("#1B4F8A", "Brush blue"), ("#3D7BC0", "Stroke blue"), ("#B0413E", "Seal red")]

    var body: some View {
        if hidden {
            Button { hidden = false } label: {
                Capsule().fill(InkwellTheme.muted.opacity(0.45)).frame(width: 4, height: isCompact ? 4 : 44)
                    .frame(width: 44, height: 64)
            }.accessibilityLabel("Show annotation tools")
        } else {
            let layout = isCompact ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 1))
            layout {
                ForEach(visibleTools) { candidate in
                    Button { tool = candidate } label: {
                        Image(systemName: candidate.symbol)
                            .font(.system(size: 20))
                            .frame(width: 44, height: 44)
                            .foregroundStyle(tool == candidate ? InkwellTheme.accent : InkwellTheme.secondary)
                            .background(tool == candidate ? InkwellTheme.mist : .clear, in: Circle())
                    }
                    .accessibilityLabel(candidate.title)
                    .accessibilityAddTraits(tool == candidate ? .isSelected : [])
                    .accessibilityIdentifier("reader-tool-\(candidate.rawValue)")
                    .help(candidate.title)
                }
                if !isCompact {
                    Menu {
                        Picker("Ink", selection: $inkColor) {
                            ForEach(inks, id: \.0) { hex, title in
                                Text(title).tag(hex)
                            }
                        }
                        Toggle("Draw with finger", isOn: $fingerDrawing)
                    } label: {
                        Image(systemName: "slider.horizontal.3").frame(width: 44, height: 44)
                    }.accessibilityLabel("Drawing options")
                }
                Button(action: onUndo) { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }
                    .disabled(!canUndo).accessibilityLabel("Undo annotation").keyboardShortcut("z", modifiers: .command)
                if !isCompact {
                    Button(action: onRedo) { Image(systemName: "arrow.uturn.forward").frame(width: 44, height: 44) }
                        .disabled(!canRedo).accessibilityLabel("Redo annotation").keyboardShortcut("z", modifiers: [.command, .shift])
                }
                Button { tool = .read; hidden = true } label: {
                    Image(systemName: isCompact ? "chevron.down" : "chevron.right").frame(width: 44, height: 44)
                }.accessibilityLabel("Hide annotation tools")
            }
            .padding(isCompact ? 5 : 6)
            .foregroundStyle(InkwellTheme.secondary)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().stroke(InkwellTheme.hairline.opacity(0.7), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.1), radius: 12, y: 5)
            .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                if (!isCompact && value.translation.width > 35) || (isCompact && value.translation.height > 35) {
                    tool = .read; hidden = true
                }
            })
        }
    }

    private var visibleTools: [ReaderTool] {
        isCompact ? [.read, .note, .memo, .eraser] : ReaderTool.allCases
    }
}

struct NoteEditorSheet: View {
    let note: PinnedNote?
    let onSave: (String) -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(16)
                .background(InkwellTheme.paper)
                .focused($focused)
                .accessibilityLabel("Note text").accessibilityIdentifier("note-editor-text")
                .navigationTitle(note == nil ? "New note" : "Edit note")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { onSave(text.trimmingCharacters(in: .whitespacesAndNewlines)); dismiss() }
                            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("note-editor-save")
                    }
                    if note != nil {
                        ToolbarItem(placement: .bottomBar) {
                            Button("Delete note", role: .destructive) { onDelete(); dismiss() }
                        }
                    }
                }
                .onAppear { text = note?.text ?? ""; focused = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(text != (note?.text ?? "") && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}
