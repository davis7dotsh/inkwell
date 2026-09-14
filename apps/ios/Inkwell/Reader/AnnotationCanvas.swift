import SwiftUI
import UIKit

/// Coordinates are in the article's current layout. The reader owns persistence and undo.
struct AnnotationCanvas: UIViewRepresentable {
    var annotations: AnnotationSet?
    var tool: ReaderTool
    var inkColor: String
    var fingerDrawing: Bool
    var onChange: (AnnotationSet) -> Void
    var onNote: (PinnedNote?, CGPoint) -> Void
    var onMemo: (VoiceMemo?, CGPoint) -> Void
    var onToolChange: ((ReaderTool) -> Void)? = nil

    func makeUIView(context: Context) -> AnnotationCanvasView { AnnotationCanvasView() }

    func updateUIView(_ view: AnnotationCanvasView, context: Context) {
        view.configure(self)
    }

    static func dismantleUIView(_ view: AnnotationCanvasView, coordinator: Void) {
        view.restoreScrollInteraction()
    }
}

/// Shape layers avoid allocating an article-sized bitmap for long documents.
final class AnnotationCanvasView: UIView, UIPencilInteractionDelegate {
    private enum Object {
        case stroke(String), box(String), note(String), memo(String)
    }

    private enum Gesture {
        case stroke(String), box(String), erase, move(Object), tap(Object?), createNote, createMemo
    }

    private var configuration: AnnotationCanvas?
    private var working: AnnotationSet?
    private var gesture: Gesture?
    private var startPoint = CGPoint.zero
    private var previousPoint = CGPoint.zero
    private var moved = false
    private var changed = false
    private var pencilTool: ReaderTool?
    private var previousPencilTool: ReaderTool = .pen
    private weak var scrollView: UIScrollView?
    private var originalScrollTouchTypes: [NSNumber]?
    private let inkContainer = CALayer()
    private let boxContainer = CALayer()
    private let eraserCursor = CAShapeLayer()
    private var strokeLayers: [String: CAShapeLayer] = [:]
    private var boxLayers: [String: CAShapeLayer] = [:]
    private var noteLabels: [String: CanvasChip] = [:]
    private var memoLabels: [String: CanvasChip] = [:]
    private var renderedStrokes: [String: InkStroke] = [:]
    private lazy var inkGesture = CanvasTouchRecognizer(canvas: self)

    private var currentAnnotations: AnnotationSet {
        working ?? configuration?.annotations ?? AnnotationSet(contentWidth: max(1, Double(bounds.width)))
    }

    private var effectiveTool: ReaderTool { pencilTool ?? configuration?.tool ?? .read }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isMultipleTouchEnabled = true
        layer.addSublayer(inkContainer)
        layer.addSublayer(boxContainer)
        eraserCursor.fillColor = UIColor.systemBackground.withAlphaComponent(0.4).cgColor
        eraserCursor.strokeColor = UIColor.secondaryLabel.cgColor
        eraserCursor.lineWidth = 1
        eraserCursor.isHidden = true
        layer.addSublayer(eraserCursor)
        addGestureRecognizer(inkGesture)
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
        isAccessibilityElement = false
        accessibilityIdentifier = "annotationCanvas"
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: AnnotationCanvasView, _: UITraitCollection) in
            view.renderedStrokes.removeAll()
            view.render()
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ configuration: AnnotationCanvas) {
        if self.configuration?.tool != configuration.tool {
            pencilTool = nil
            if configuration.tool != .eraser { previousPencilTool = configuration.tool }
        }
        self.configuration = configuration
        render()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        restoreScrollInteraction()
        guard window != nil else { return }
        var ancestor = superview
        while let view = ancestor {
            if let scroll = view as? UIScrollView {
                scrollView = scroll
                originalScrollTouchTypes = scroll.panGestureRecognizer.allowedTouchTypes
                // A resting hand can scroll; Pencil input never starts the article's pan.
                scroll.panGestureRecognizer.allowedTouchTypes = [UITouch.TouchType.direct, .indirect, .indirectPointer].map { NSNumber(value: $0.rawValue) }
                break
            }
            ancestor = view.superview
        }
    }

    func restoreScrollInteraction() {
        if let originalScrollTouchTypes { scrollView?.panGestureRecognizer.allowedTouchTypes = originalScrollTouchTypes }
        originalScrollTouchTypes = nil
        scrollView = nil
    }

    fileprivate func isArticleScrollPan(_ recognizer: UIGestureRecognizer) -> Bool {
        recognizer === scrollView?.panGestureRecognizer
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        inkContainer.frame = bounds
        boxContainer.frame = bounds
        render()
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard bounds.contains(point), configuration?.annotations != nil else { return false }
        if event?.allTouches?.contains(where: { $0.type == .pencil }) == true { return true }
        if chip(at: point) != nil { return true }
        switch effectiveTool {
        case .note, .memo: return true
        case .read: return configuration?.fingerDrawing == true && object(at: point) != nil
        default: return configuration?.fingerDrawing == true
        }
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        guard gesture == nil else { return }
        if effectiveTool == .eraser {
            pencilTool = previousPencilTool
        } else {
            previousPencilTool = effectiveTool
            pencilTool = .eraser
        }
        configuration?.onToolChange?(effectiveTool)
        UIAccessibility.post(notification: .announcement, argument: effectiveTool == .eraser ? "Eraser" : "Drawing tool")
        UISelectionFeedbackGenerator().selectionChanged()
    }

    fileprivate func begin(at point: CGPoint, pencil: Bool) -> Bool {
        guard configuration?.annotations != nil else { return false }
        let drawingInput = pencil || configuration?.fingerDrawing == true
        startPoint = point
        previousPoint = point
        moved = false
        changed = false
        working = currentAnnotations
        if case .eraser = effectiveTool, drawingInput {
            gesture = .erase
            erase(from: point, to: point)
            showEraser(at: point)
            return true
        }
        if let target = chip(at: point) {
            gesture = drawingInput ? .move(target) : .tap(target)
            return drawingInput
        }
        switch effectiveTool {
        case .read:
            if drawingInput, let target = object(at: point) {
                gesture = .move(target)
                return true
            }
            gesture = .tap(nil)
            return false
        case .note:
            gesture = .createNote
            return pencil
        case .memo:
            gesture = .createMemo
            return pencil
        case .pen, .highlighter:
            guard drawingInput else { return false }
            let highlight = effectiveTool == .highlighter
            let ink = highlight ? "rgba(143, 184, 222, 0.5)" : configuration?.inkColor ?? "#0E2E52"
            let stroke = InkStroke(id: UUID().uuidString, tool: highlight ? "highlighter" : "pen", color: ink, width: highlight ? 18 : 2.5, points: [InkPoint(x: point.x, y: point.y)])
            working?.strokes.append(stroke)
            gesture = .stroke(stroke.id)
            changed = true
            render()
            return true
        case .box:
            guard drawingInput else { return false }
            let box = AnnotationBox(id: UUID().uuidString, x: point.x, y: point.y, w: 0, h: 0)
            working?.boxes.append(box)
            gesture = .box(box.id)
            return true
        case .eraser:
            return false
        }
    }

    fileprivate func move(to rawPoint: CGPoint, redraw: Bool = true) {
        guard let gesture else { return }
        let point = CGPoint(x: max(0, min(bounds.width, rawPoint.x)), y: max(0, min(bounds.height, rawPoint.y)))
        if hypot(point.x - startPoint.x, point.y - startPoint.y) > 4 { moved = true }
        switch gesture {
        case .stroke(let id):
            if let index = working?.strokes.firstIndex(where: { $0.id == id }), hypot(point.x - previousPoint.x, point.y - previousPoint.y) > 0.15 {
                working?.strokes[index].points.append(InkPoint(x: point.x, y: point.y))
            }
        case .box(let id):
            if let index = working?.boxes.firstIndex(where: { $0.id == id }) {
                working?.boxes[index].x = min(startPoint.x, point.x)
                working?.boxes[index].y = min(startPoint.y, point.y)
                working?.boxes[index].w = abs(point.x - startPoint.x)
                working?.boxes[index].h = abs(point.y - startPoint.y)
                changed = moved
            }
        case .erase:
            erase(from: previousPoint, to: point)
            showEraser(at: point)
        case .move(let object):
            if moved {
                let origin = changed ? previousPoint : startPoint
                translate(object, dx: point.x - origin.x, dy: point.y - origin.y)
                changed = true
            }
        case .tap, .createNote, .createMemo: break
        }
        previousPoint = point
        if redraw { render() }
    }

    fileprivate func move(through samples: [CGPoint]) {
        for point in samples { move(to: point, redraw: false) }
        render()
    }

    fileprivate func end(at point: CGPoint, cancelled: Bool) {
        let completedGesture = gesture
        let finalAnnotations = working
        gesture = nil
        working = nil
        eraserCursor.isHidden = true
        guard !cancelled else { render(); return }
        if changed, var finalAnnotations {
            if case .box(let id) = completedGesture {
                finalAnnotations.boxes.removeAll { $0.id == id && ($0.w < 3 || $0.h < 3) }
            }
            configuration?.annotations = finalAnnotations
            configuration?.onChange(finalAnnotations)
        } else if !moved {
            switch completedGesture {
            case .tap(let object): activate(object, at: point)
            case .move(let object): activate(object, at: point)
            case .createNote: configuration?.onNote(nil, point)
            case .createMemo: configuration?.onMemo(nil, point)
            default: break
            }
        }
        render()
    }

    private func activate(_ object: Object?, at point: CGPoint) {
        switch object {
        case .note(let id): configuration?.onNote(currentAnnotations.notes.first { $0.id == id }, point)
        case .memo(let id): configuration?.onMemo(currentAnnotations.memos.first { $0.id == id }, point)
        default: break
        }
    }

    private func translate(_ object: Object, dx: Double, dy: Double) {
        switch object {
        case .stroke(let id):
            guard let index = working?.strokes.firstIndex(where: { $0.id == id }), let points = working?.strokes[index].points else { return }
            let minX = points.map(\.x).min() ?? 0
            let minY = points.map(\.y).min() ?? 0
            let maxX = points.map(\.x).max() ?? 0
            let maxY = points.map(\.y).max() ?? 0
            let translationX = max(-minX, min(dx, bounds.width - maxX))
            let translationY = max(-minY, min(dy, bounds.height - maxY))
            working?.strokes[index].points = points.map { InkPoint(x: $0.x + translationX, y: $0.y + translationY) }
        case .box(let id):
            guard let index = working?.boxes.firstIndex(where: { $0.id == id }), let box = working?.boxes[index] else { return }
            working?.boxes[index].x = max(0, min(max(0, bounds.width - box.w), box.x + dx))
            working?.boxes[index].y = max(0, min(max(0, bounds.height - box.h), box.y + dy))
        case .note(let id):
            guard let index = working?.notes.firstIndex(where: { $0.id == id }), let note = working?.notes[index] else { return }
            let rect = noteRect(note)
            working?.notes[index].x = max(0, min(max(0, bounds.width - rect.width), note.x + dx))
            working?.notes[index].y = max(0, min(max(0, bounds.height - rect.height), note.y + dy))
        case .memo(let id):
            guard let index = working?.memos.firstIndex(where: { $0.id == id }), let memo = working?.memos[index] else { return }
            working?.memos[index].x = max(0, min(max(0, bounds.width - 185), memo.x + dx))
            working?.memos[index].y = max(0, min(max(0, bounds.height - 36), memo.y + dy))
        }
    }

    private func chip(at point: CGPoint) -> Object? {
        let annotations = currentAnnotations
        if let memo = annotations.memos.reversed().first(where: { memoRect($0).insetBy(dx: -5, dy: -5).contains(point) }) { return .memo(memo.id) }
        if let note = annotations.notes.reversed().first(where: { noteRect($0).insetBy(dx: -5, dy: -5).contains(point) }) { return .note(note.id) }
        return nil
    }

    private func object(at point: CGPoint) -> Object? {
        if let chip = chip(at: point) { return chip }
        let annotations = currentAnnotations
        if let stroke = annotations.strokes.reversed().first(where: { intersects($0, from: point, to: point, radius: 9) }) { return .stroke(stroke.id) }
        if let box = annotations.boxes.reversed().first(where: { boxRect($0).insetBy(dx: -9, dy: -9).contains(point) }) { return .box(box.id) }
        return nil
    }

    private func erase(from start: CGPoint, to end: CGPoint) {
        guard var annotations = working else { return }
        let count = annotations.strokes.count + annotations.boxes.count + annotations.notes.count + annotations.memos.count
        annotations.strokes.removeAll { intersects($0, from: start, to: end, radius: 12) }
        annotations.boxes.removeAll { intersects(boxRect($0), from: start, to: end, radius: 12) }
        annotations.notes.removeAll { intersects(noteRect($0), from: start, to: end, radius: 12) }
        annotations.memos.removeAll { intersects(memoRect($0), from: start, to: end, radius: 12) }
        changed = changed || count != annotations.strokes.count + annotations.boxes.count + annotations.notes.count + annotations.memos.count
        working = annotations
    }

    private func showEraser(at point: CGPoint) {
        eraserCursor.path = CGPath(ellipseIn: CGRect(x: point.x - 12, y: point.y - 12, width: 24, height: 24), transform: nil)
        eraserCursor.isHidden = false
    }

    private func render() {
        let annotations = currentAnnotations
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let strokeIDs = Set(annotations.strokes.map(\.id))
        for id in Array(strokeLayers.keys) where !strokeIDs.contains(id) {
            strokeLayers.removeValue(forKey: id)?.removeFromSuperlayer()
            renderedStrokes.removeValue(forKey: id)
        }
        for stroke in annotations.strokes where renderedStrokes[stroke.id] != stroke {
            let shape = strokeLayers[stroke.id] ?? CAShapeLayer()
            if shape.superlayer == nil { inkContainer.addSublayer(shape) }
            shape.contentsScale = contentScaleFactor
            strokeLayers[stroke.id] = shape
            renderedStrokes[stroke.id] = stroke
            configureStroke(shape, stroke: stroke)
        }
        let boxIDs = Set(annotations.boxes.map(\.id))
        for id in Array(boxLayers.keys) where !boxIDs.contains(id) { boxLayers.removeValue(forKey: id)?.removeFromSuperlayer() }
        for box in annotations.boxes {
            let shape = boxLayers[box.id] ?? CAShapeLayer()
            if shape.superlayer == nil { boxContainer.addSublayer(shape) }
            shape.contentsScale = contentScaleFactor
            boxLayers[box.id] = shape
            shape.frame = boxRect(box).insetBy(dx: -2, dy: -2)
            shape.path = CGPath(roundedRect: shape.bounds.insetBy(dx: 2, dy: 2), cornerWidth: 5, cornerHeight: 5, transform: nil)
            shape.strokeColor = color("#1B4F8A").cgColor
            shape.fillColor = UIColor.clear.cgColor
            shape.lineWidth = 2
        }
        let noteIDs = Set(annotations.notes.map(\.id))
        for id in Array(noteLabels.keys) where !noteIDs.contains(id) { noteLabels.removeValue(forKey: id)?.removeFromSuperview() }
        for note in annotations.notes {
            let label = noteLabels[note.id] ?? CanvasChip()
            if label.superview == nil { addSubview(label) }
            noteLabels[note.id] = label
            label.frame = noteRect(note)
            label.text = note.text.isEmpty ? "Note" : note.text
            label.font = .systemFont(ofSize: 13.5)
            label.numberOfLines = 6
            label.backgroundColor = color(traitCollection.userInterfaceStyle == .dark ? "#1E2C3D" : "#E8EFF3")
            label.layer.borderColor = color(traitCollection.userInterfaceStyle == .dark ? "#31506F" : "#A7C5D8").cgColor
            configureAccessibility(label, object: .note(note.id), description: "Note: \(note.text)")
        }
        let memoIDs = Set(annotations.memos.map(\.id))
        for id in Array(memoLabels.keys) where !memoIDs.contains(id) { memoLabels.removeValue(forKey: id)?.removeFromSuperview() }
        for memo in annotations.memos {
            let label = memoLabels[memo.id] ?? CanvasChip()
            if label.superview == nil { addSubview(label) }
            memoLabels[memo.id] = label
            label.frame = memoRect(memo)
            label.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            label.numberOfLines = 1
            let seconds = max(0, Int(memo.durationMs / 1000))
            let title = memo.status == "local" ? "On device" : "Voice memo"
            label.text = "▶  \(title)  \(seconds / 60):\(String(format: "%02d", seconds % 60))"
            label.backgroundColor = color(traitCollection.userInterfaceStyle == .dark ? "#1E2C3D" : "#E8EFF3")
            label.layer.borderColor = color(traitCollection.userInterfaceStyle == .dark ? "#31506F" : "#A7C5D8").cgColor
            let localStatus = memo.status == "local" ? "Saved only on this device. " : ""
            configureAccessibility(label, object: .memo(memo.id), description: "Voice memo, \(seconds) seconds. \(localStatus)\(memo.transcript)")
        }
        CATransaction.commit()
    }

    private func configureStroke(_ shape: CAShapeLayer, stroke: InkStroke) {
        guard let first = stroke.points.first else { shape.path = nil; return }
        let path = CGMutablePath()
        let width = max(0.5, stroke.width)
        if stroke.points.count == 1 {
            path.addEllipse(in: CGRect(x: first.x - width / 2, y: first.y - width / 2, width: width, height: width))
        } else {
            path.move(to: CGPoint(x: first.x, y: first.y))
            for point in stroke.points.dropFirst() { path.addLine(to: CGPoint(x: point.x, y: point.y)) }
        }
        shape.frame = path.boundingBoxOfPath.insetBy(dx: -width, dy: -width)
        var transform = CGAffineTransform(translationX: -shape.frame.minX, y: -shape.frame.minY)
        shape.path = path.copy(using: &transform)
        var ink = color(stroke.color)
        if stroke.tool == "highlighter", ink.cgColor.alpha >= 1 { ink = ink.withAlphaComponent(0.32) }
        shape.fillColor = stroke.points.count == 1 ? ink.cgColor : UIColor.clear.cgColor
        shape.strokeColor = stroke.points.count == 1 ? nil : ink.cgColor
        shape.lineWidth = width
        shape.lineCap = .round
        shape.lineJoin = .round
    }

    private func configureAccessibility(_ label: CanvasChip, object: Object, description: String) {
        label.isAccessibilityElement = true
        label.accessibilityLabel = description
        label.accessibilityTraits = .button
        label.accessibilityHint = "Opens the annotation. Drag with Apple Pencil to move it."
        label.activate = { [weak self, weak label] in self?.activate(object, at: label?.frame.origin ?? .zero) }
        label.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Delete annotation") { [weak self] _ in
            guard let self else { return false }
            var annotations = self.currentAnnotations
            switch object {
            case .note(let id): annotations.notes.removeAll { $0.id == id }
            case .memo(let id): annotations.memos.removeAll { $0.id == id }
            default: return false
            }
            self.configuration?.annotations = annotations
            self.configuration?.onChange(annotations)
            self.render()
            return true
        }]
    }

    private func noteRect(_ note: PinnedNote) -> CGRect {
        let width = min(230, max(100, bounds.width - note.x))
        let text = note.text.isEmpty ? "Note" : note.text
        let size = (text as NSString).boundingRect(with: CGSize(width: width - 20, height: 120), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: UIFont.systemFont(ofSize: 13.5)], context: nil)
        return CGRect(x: note.x, y: note.y, width: min(width, max(60, ceil(size.width) + 20)), height: min(120, max(34, ceil(size.height) + 16)))
    }

    private func memoRect(_ memo: VoiceMemo) -> CGRect { CGRect(x: memo.x, y: memo.y, width: 185, height: 36) }
    private func boxRect(_ box: AnnotationBox) -> CGRect { CGRect(x: box.x, y: box.y, width: max(0, box.w), height: max(0, box.h)) }

    private func color(_ value: String) -> UIColor {
        let night = ["#0E2E52": "#D9E6F4", "#1B4F8A": "#7FAEDF", "#3D7BC0": "#8FBCE9", "#B0413E": "#E08A85", "#000000": "#ECEAE5", "RGBA(143, 184, 222, 0.5)": "rgba(111, 163, 220, 0.40)"]
        let source = traitCollection.userInterfaceStyle == .dark ? night[value.uppercased()] ?? value : value
        if source.hasPrefix("rgba(") || source.hasPrefix("rgb(") {
            let parts = source.drop(while: { $0 != "(" }).dropFirst().dropLast().split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count >= 3 { return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts.count > 3 ? parts[3] : 1) }
        }
        var hex = source.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, let number = UInt64(hex, radix: 16) else { return .label }
        return UIColor(red: Double((number >> 16) & 255) / 255, green: Double((number >> 8) & 255) / 255, blue: Double(number & 255) / 255, alpha: 1)
    }

    private func intersects(_ stroke: InkStroke, from start: CGPoint, to end: CGPoint, radius: Double) -> Bool {
        let points = stroke.points.map { CGPoint(x: $0.x, y: $0.y) }
        guard let first = points.first else { return false }
        let threshold = radius + max(0, stroke.width) / 2
        if points.count == 1 { return distance(first, toSegmentFrom: start, to: end) <= threshold }
        return zip(points, points.dropFirst()).contains { segmentDistance(start, end, $0.0, $0.1) <= threshold }
    }

    private func intersects(_ rect: CGRect, from start: CGPoint, to end: CGPoint, radius: Double) -> Bool {
        let expanded = rect.insetBy(dx: -radius, dy: -radius)
        if expanded.contains(start) || expanded.contains(end) { return true }
        let a = CGPoint(x: expanded.minX, y: expanded.minY)
        let b = CGPoint(x: expanded.maxX, y: expanded.minY)
        let c = CGPoint(x: expanded.maxX, y: expanded.maxY)
        let d = CGPoint(x: expanded.minX, y: expanded.maxY)
        return [(a, b), (b, c), (c, d), (d, a)].contains { segmentDistance(start, end, $0.0, $0.1) < 0.001 }
    }

    private func distance(_ point: CGPoint, toSegmentFrom start: CGPoint, to end: CGPoint) -> Double {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let length = dx * dx + dy * dy
        let amount = length == 0 ? 0 : max(0, min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
        return hypot(point.x - start.x - amount * dx, point.y - start.y - amount * dy)
    }

    private func segmentDistance(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint, _ d: CGPoint) -> Double {
        let ab = CGPoint(x: b.x - a.x, y: b.y - a.y)
        let cd = CGPoint(x: d.x - c.x, y: d.y - c.y)
        let cross = ab.x * cd.y - ab.y * cd.x
        if abs(cross) > 0.00001 {
            let ac = CGPoint(x: c.x - a.x, y: c.y - a.y)
            let t = (ac.x * cd.y - ac.y * cd.x) / cross
            let u = (ac.x * ab.y - ac.y * ab.x) / cross
            if (0...1).contains(t), (0...1).contains(u) { return 0 }
        }
        return min(distance(a, toSegmentFrom: c, to: d), distance(b, toSegmentFrom: c, to: d), distance(c, toSegmentFrom: a, to: b), distance(d, toSegmentFrom: a, to: b))
    }
}

private final class CanvasChip: UILabel {
    var activate: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        textColor = .label
        layer.cornerRadius = 8
        layer.borderWidth = 1
        clipsToBounds = false
        layer.shadowColor = UIColor(red: 27 / 255, green: 79 / 255, blue: 138 / 255, alpha: 1).cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 2)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        layer.shadowPath = CGPath(roundedRect: bounds, cornerWidth: 8, cornerHeight: 8, transform: nil)
    }
    override func drawText(in rect: CGRect) { super.drawText(in: rect.insetBy(dx: 10, dy: 7)) }
    override func accessibilityActivate() -> Bool { activate?(); return activate != nil }
}

/// Claims drawing immediately while leaving finger taps undecided until scrolling can win.
private final class CanvasTouchRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private weak var canvas: AnnotationCanvasView?
    private var activeTouch: UITouch?
    private var origin = CGPoint.zero
    private var drawing = false

    init(canvas: AnnotationCanvasView) {
        self.canvas = canvas
        super.init(target: nil, action: nil)
        delegate = self
        allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        // Keep scrolling fingers out of the active Pencil gesture's touch stream.
        requiresExclusiveTouchType = true
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard activeTouch == nil, let touch = touches.first(where: { $0.type == .pencil }) ?? touches.first, let canvas else { return }
        activeTouch = touch
        origin = touch.preciseLocation(in: canvas)
        drawing = canvas.begin(at: origin, pencil: touch.type == .pencil)
        if drawing { state = .began }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = activeTouch, touches.contains(touch), let canvas else { return }
        let point = touch.preciseLocation(in: canvas)
        if !drawing, hypot(point.x - origin.x, point.y - origin.y) > 8 {
            canvas.end(at: point, cancelled: true)
            state = .failed
            return
        }
        canvas.move(through: (event.coalescedTouches(for: touch) ?? [touch]).map { $0.preciseLocation(in: canvas) })
        if drawing { state = .changed }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = activeTouch, touches.contains(touch), let canvas else { return }
        let point = touch.preciseLocation(in: canvas)
        if drawing { canvas.move(to: point) }
        canvas.end(at: point, cancelled: false)
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        canvas?.end(at: .zero, cancelled: true)
        state = .cancelled
    }

    override func reset() {
        canvas?.end(at: .zero, cancelled: true)
        activeTouch = nil
        drawing = false
        super.reset()
    }

    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
        drawing ? false : super.canBePrevented(by: preventingGestureRecognizer)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        activeTouch?.type == .pencil && canvas?.isArticleScrollPan(otherGestureRecognizer) == true
    }
}
