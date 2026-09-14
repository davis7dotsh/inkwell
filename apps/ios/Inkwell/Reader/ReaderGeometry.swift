import Foundation
import CoreGraphics

/// The wire snapshot intentionally matches packages/content's [index, { y, height }] tuples.
struct ReaderLayoutSnapshot: Equatable {
    var width: Double
    var layouts: [Int: CGRect]

    init(width: Double, layouts: [Int: CGRect]) {
        self.width = width
        self.layouts = layouts
    }

    init?(json: String?) {
        guard let json, let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let width = object["width"] as? Double, width.isFinite, width > 0,
              let entries = object["layouts"] as? [[Any]] else { return nil }
        var layouts: [Int: CGRect] = [:]
        for entry in entries {
            guard entry.count == 2, let index = entry[0] as? Int, index >= 0,
                  let geometry = entry[1] as? [String: Double],
                  let y = geometry["y"], let height = geometry["height"],
                  y.isFinite, height.isFinite, height > 0 else { return nil }
            layouts[index] = CGRect(x: 0, y: y, width: width, height: height)
        }
        guard !layouts.isEmpty else { return nil }
        self.init(width: width, layouts: layouts)
    }

    var json: String? {
        let entries: [[Any]] = layouts.sorted { $0.key < $1.key }.map { index, frame in
            [index, ["y": Double(frame.minY), "height": Double(frame.height)]]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["width": width, "layouts": entries], options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

enum ReaderGeometry {
    /// Map through the original block measurements, not just the column ratio: Swift
    /// and the web wrap text differently. The same mapping handles rotation and Type size.
    static func remap(_ annotations: AnnotationSet, to destination: ReaderLayoutSnapshot) -> AnnotationSet {
        guard annotations.contentWidth > 0, destination.width > 0 else { return annotations }
        let source = ReaderLayoutSnapshot(json: annotations.layoutJson)
        let ratio = destination.width / annotations.contentWidth
        let layoutRatio = (source?.width ?? annotations.contentWidth) / annotations.contentWidth
        let matched = source?.layouts.sorted { $0.key < $1.key }.compactMap { index, old -> (CGRect, CGRect)? in
            guard let new = destination.layouts[index] else { return nil }
            return (old, new)
        } ?? []

        func mapY(_ y: Double) -> Double {
            let yInLayout = y * layoutRatio
            guard let first = matched.first, let last = matched.last else { return y * ratio }
            if yInLayout < first.0.minY {
                return first.0.minY > 0 ? yInLayout / first.0.minY * first.1.minY : y * ratio
            }
            for (offset, pair) in matched.enumerated() {
                let (old, new) = pair
                if yInLayout <= old.maxY {
                    return new.minY + (yInLayout - old.minY) / max(old.height, 1) * new.height
                }
                if offset + 1 < matched.count {
                    let next = matched[offset + 1]
                    if yInLayout < next.0.minY {
                        let progress = (yInLayout - old.maxY) / max(next.0.minY - old.maxY, 1)
                        return new.maxY + progress * (next.1.minY - new.maxY)
                    }
                }
            }
            return last.1.maxY + (yInLayout - last.0.maxY) * destination.width / (source?.width ?? annotations.contentWidth)
        }

        var result = annotations
        result.contentWidth = destination.width
        result.strokes = annotations.strokes.map { stroke in
            var mapped = stroke
            mapped.width *= ratio
            mapped.points = stroke.points.map { InkPoint(x: $0.x * ratio, y: mapY($0.y)) }
            return mapped
        }
        result.boxes = annotations.boxes.map { box in
            var mapped = box
            mapped.x *= ratio
            mapped.y = mapY(box.y)
            mapped.w *= ratio
            mapped.h = max(1, mapY(box.y + box.h) - mapped.y)
            return mapped
        }
        result.notes = annotations.notes.map { note in
            var mapped = note
            mapped.x *= ratio
            mapped.y = mapY(note.y)
            return mapped
        }
        result.memos = annotations.memos.map { memo in
            var mapped = memo
            mapped.x *= ratio
            mapped.y = mapY(memo.y)
            return mapped
        }
        result.layoutJson = destination.json
        return result
    }
}
