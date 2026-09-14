import CoreGraphics
import XCTest
@testable import Inkwell

final class ReaderGeometryTests: XCTestCase {
    func testLegacyAnnotationsKeepTheirBlockAnchorsWhenNativeTextReflows() throws {
        // The annotation width and last measured layout width can differ in
        // existing React Native records. Both ratios matter during migration.
        let legacyLayout = """
        {"width":350,"layouts":[[0,{"y":100,"height":200}],[1,{"y":320,"height":100}]]}
        """
        let original = AnnotationSet(
            contentWidth: 700,
            strokes: [InkStroke(id: "ink", tool: "pen", color: "#1B4F8A", width: 2.5,
                                points: [InkPoint(x: 350, y: 400), InkPoint(x: 420, y: 700)])],
            boxes: [AnnotationBox(id: "box", x: 20, y: 400, w: 600, h: 300)],
            notes: [PinnedNote(id: "note", x: 350, y: 400, text: "Middle of the first paragraph")],
            memos: [VoiceMemo(id: "memo", x: 30, y: 620, durationMs: 5_000,
                              transcript: "Between paragraphs", status: "uploaded", createdAt: 1_700_000_000_000)],
            layoutJson: legacyLayout
        )
        let nativeLayout = ReaderLayoutSnapshot(width: 700, layouts: [
            0: CGRect(x: 0, y: 150, width: 700, height: 300),
            1: CGRect(x: 0, y: 480, width: 700, height: 200)
        ])

        let migrated = ReaderGeometry.remap(original, to: nativeLayout)
        let note = try XCTUnwrap(migrated.notes.first)
        XCTAssertEqual(note.x, 350)
        XCTAssertEqual(note.y, 300, accuracy: 0.0001)
        XCTAssertEqual(note.text, original.notes[0].text)
        XCTAssertEqual(migrated.strokes[0].points, [InkPoint(x: 350, y: 300), InkPoint(x: 420, y: 540)])
        XCTAssertEqual(migrated.strokes[0].width, 2.5)
        XCTAssertEqual(migrated.boxes[0].y, 300, accuracy: 0.0001)
        XCTAssertEqual(migrated.boxes[0].h, 240, accuracy: 0.0001)
        XCTAssertEqual(migrated.memos[0].y, 465, accuracy: 0.0001)
        XCTAssertEqual(migrated.memos[0].status, "uploaded")
        XCTAssertEqual(migrated.memos[0].transcript, "Between paragraphs")
        XCTAssertEqual(ReaderLayoutSnapshot(json: migrated.layoutJson), nativeLayout)
        XCTAssertEqual(ReaderGeometry.remap(migrated, to: nativeLayout), migrated,
                       "Repeated layout passes must not move already migrated annotations.")
    }

    func testLegacyAnnotationsWithoutBlockMeasurementsScaleWithoutLosingPayloads() {
        let original = AnnotationSet(
            contentWidth: 350,
            strokes: [InkStroke(id: "highlight", tool: "highlighter", color: "rgba(143, 184, 222, 0.5)", width: 18,
                                points: [InkPoint(x: 20, y: 60), InkPoint(x: 100, y: 60)])],
            notes: [PinnedNote(id: "old-note", x: 70, y: 300, text: "An older saved note")]
        )
        let destination = ReaderLayoutSnapshot(width: 700, layouts: [0: CGRect(x: 0, y: 100, width: 700, height: 500)])

        let result = ReaderGeometry.remap(original, to: destination)
        XCTAssertEqual(result.contentWidth, 700)
        XCTAssertEqual(result.strokes[0].points, [InkPoint(x: 40, y: 120), InkPoint(x: 200, y: 120)])
        XCTAssertEqual(result.strokes[0].width, 36)
        XCTAssertEqual(result.strokes[0].color, original.strokes[0].color)
        XCTAssertEqual(result.notes[0], PinnedNote(id: "old-note", x: 140, y: 600, text: "An older saved note"))
    }
}
