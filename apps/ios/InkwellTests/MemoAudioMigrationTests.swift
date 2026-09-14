import XCTest
@testable import Inkwell

final class MemoAudioMigrationTests: XCTestCase {
    func testLegacyReactNativeRecordingIsMovedWithoutLosingAudio() throws {
        let memoID = "migration-test-\(UUID().uuidString)"
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let legacyDirectory = documents.appendingPathComponent("memos", isDirectory: true)
        try FileManager.default.createDirectory(at: legacyDirectory, withIntermediateDirectories: true)
        let legacy = legacyDirectory.appendingPathComponent(memoID).appendingPathExtension("m4a")
        let audio = Data([0, 1, 2, 3, 4])
        try audio.write(to: legacy)
        defer {
            try? MemoAudioStore.deleteLocal(memoID: memoID)
            try? FileManager.default.removeItem(at: legacy)
        }
        let migrated = try XCTUnwrap(MemoAudioStore.existingFile(memoID: memoID))
        XCTAssertEqual(migrated, try MemoAudioStore.fileURL(memoID: memoID))
        XCTAssertEqual(try Data(contentsOf: migrated), audio)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        try MemoAudioStore.deleteLocal(memoID: memoID)
        XCTAssertNil(try MemoAudioStore.existingFile(memoID: memoID))
    }
}
