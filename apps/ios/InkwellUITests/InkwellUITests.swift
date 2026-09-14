import XCTest

/// Exercises the real native views and store without touching a signed-in library.
/// Demo fixtures are recreated on every process launch; reopening an article in
/// the same process still reads the saved annotation snapshot.
@MainActor
final class InkwellUITests: XCTestCase {
    private var app: XCUIApplication!
    private let attention = "The art of paying attention"
    private let tools = "Good tools leave room for thought"
    private let slow = "In praise of reading slowly"
    private let connections = "Where unexpected connections begin"

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        app.launchArguments = ["--demo", "--reset-demo", "-reader.fingerDrawing", "YES"]
        app.launch()
        XCTAssertTrue(app.staticTexts["demoBanner"].waitForExistence(timeout: 10))
        XCTAssertTrue(articleActions(attention).waitForExistence(timeout: 5))
    }

    override func tearDownWithError() throws {
        if let run = testRun, run.failureCount > 0 {
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        app.terminate()
        app = nil
    }

    func testSearchAndTagFilters() {
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("quietly capable")
        XCTAssertTrue(articleActions(tools).waitForExistence(timeout: 3))
        XCTAssertFalse(articleActions(attention).exists)
        XCTAssertFalse(articleActions(slow).exists)

        replaceText(in: search, with: "no matching fixture")
        XCTAssertTrue(app.staticTexts["No matching articles"].waitForExistence(timeout: 3))
        // Submit the query so the first tap is not consumed dismissing the
        // search keyboard on older iPadOS versions.
        search.typeText("\n")
        let clearFilters = app.buttons["clearLibraryFilters"]
        XCTAssertTrue(waitUntil { clearFilters.isHittable })
        clearFilters.tap()
        XCTAssertTrue(waitUntil { (search.value as? String) != "no matching fixture" })
        XCTAssertTrue(articleActions(attention).waitForExistence(timeout: 3))
        if app.buttons["Cancel"].exists {
            app.buttons["Cancel"].tap()
        } else {
            // iPadOS 26 keeps search active without exposing a Cancel button.
            // Leave it before tapping a toolbar menu, which otherwise only
            // dismisses the search presentation on the first tap.
            app.staticTexts["demoBanner"].tap()
        }

        selectFilter("Long reads")
        XCTAssertTrue(articleActions(slow).waitForExistence(timeout: 3))
        XCTAssertFalse(articleActions(attention).exists)
        XCTAssertFalse(articleActions(tools).exists)

        // Multiple tags must include either matching tag, not require both.
        selectFilter("Design")
        XCTAssertTrue(articleActions(attention).waitForExistence(timeout: 3))
        XCTAssertTrue(articleActions(tools).exists)
        XCTAssertTrue(articleActions(slow).exists)
        XCTAssertFalse(articleActions(connections).exists)
    }

    func testRenameAndPinRemainConsistentAcrossSortChanges() {
        articleActions(attention).tap()
        app.buttons["Unpin"].tap()
        articleActions(tools).tap()
        app.buttons["Pin to top"].tap()
        XCTAssertTrue(waitUntil { self.articleActions(self.tools).frame.minY < self.articleActions(self.attention).frame.minY })

        articleActions(tools).tap()
        app.buttons["Rename"].tap()
        let alert = app.alerts["Rename article"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        replaceText(in: alert.textFields.firstMatch, with: "A renamed article")
        alert.buttons["Save"].tap()
        XCTAssertTrue(articleActions("A renamed article").waitForExistence(timeout: 3))
        XCTAssertFalse(articleActions(tools).exists)

        selectFilter("Oldest first")
        XCTAssertTrue(waitUntil { self.articleActions("A renamed article").frame.minY < self.articleActions(self.connections).frame.minY })
        articleActions("A renamed article").tap()
        XCTAssertTrue(app.buttons["Unpin"].waitForExistence(timeout: 3))
        app.buttons["Delete"].tap()
        let deletion = app.alerts["Delete article?"]
        XCTAssertTrue(deletion.waitForExistence(timeout: 3))
        deletion.buttons["Delete"].tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["articleRow-demo-tools"].exists })
        XCTAssertTrue(articleActions(attention).exists)
    }

    func testCreateAttachAndFilterByTag() {
        articleActions(tools).tap()
        app.buttons["Tags"].tap()
        let field = app.textFields["newTagName"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.tap()
        field.typeText("Native reading")
        app.buttons["createTag"].tap()
        XCTAssertTrue(app.buttons["Remove tag Native reading"].waitForExistence(timeout: 3))
        app.buttons["Done"].tap()

        selectFilter("Native reading")
        XCTAssertTrue(articleActions(tools).waitForExistence(timeout: 3))
        XCTAssertFalse(articleActions(attention).exists)
        XCTAssertFalse(articleActions(slow).exists)
        XCTAssertFalse(articleActions(connections).exists)

        articleActions(tools).tap()
        app.buttons["Tags"].tap()
        app.buttons["Edit tag Native reading"].tap()
        app.buttons["Delete"].tap()
        let deletion = app.alerts["Delete tag?"]
        XCTAssertTrue(deletion.waitForExistence(timeout: 3))
        deletion.buttons["Delete"].tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["Remove tag Native reading"].exists })
        app.buttons["Done"].tap()
        // Deleting an actively selected tag must also release its filter.
        XCTAssertTrue(articleActions(attention).waitForExistence(timeout: 3))
        XCTAssertTrue(articleActions(slow).exists)
    }

    func testOutlineNoteSaveAndReopen() {
        openArticle(attention)
        let contents = app.buttons["reader-outline"]
        XCTAssertTrue(contents.waitForExistence(timeout: 5))
        contents.tap()
        XCTAssertTrue(app.buttons["Make the margin yours"].waitForExistence(timeout: 3))
        app.buttons["Make the margin yours"].tap()
        XCTAssertTrue(app.staticTexts["Make the margin yours"].waitForExistence(timeout: 3))
        contents.tap()
        app.buttons["Beginning"].tap()

        app.buttons["reader-tool-note"].tap()
        let reader = app.scrollViews["article-reader"]
        // Tap a visible point in the content column, away from the tool rail.
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.35)).tap()
        let editor = app.textViews["note-editor-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("A note saved by the native reader.")
        app.buttons["note-editor-save"].tap()
        let savedNote = app.buttons["Note: A note saved by the native reader."]
        XCTAssertTrue(savedNote.waitForExistence(timeout: 3))
        app.buttons["reader-tool-read"].tap()
        goBackToLibrary()

        openArticle(attention)
        XCTAssertTrue(savedNote.waitForExistence(timeout: 5))
        savedNote.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 3))
        XCTAssertEqual(editor.value as? String, "A note saved by the native reader.")
    }

    func testFinishedStatusReturnsToLibrary() {
        openArticle(slow)
        let actions = app.buttons["Article actions"]
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        tapToolbarMenu(actions)
        app.buttons["reader-mark-finished"].tap()
        XCTAssertFalse(app.alerts["Couldn't complete the action"].exists)
        goBackToLibrary()
        articleActions(slow).tap()
        XCTAssertTrue(app.buttons["Mark unread"].waitForExistence(timeout: 3))
    }

    func testDrawingCanBeUndoneAndRedone() throws {
        openArticle(attention)
        let pen = app.buttons["reader-tool-pen"]
        guard pen.exists else { throw XCTSkip("Ink tools require the iPad reader layout.") }
        let undo = app.buttons["Undo annotation"]
        let redo = app.buttons["Redo annotation"]
        XCTAssertFalse(undo.isEnabled)
        pen.tap()
        let reader = app.scrollViews["article-reader"]
        let start = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.35))
        let end = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.4))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(waitUntil { undo.isEnabled })
        undo.tap()
        XCTAssertTrue(waitUntil { !undo.isEnabled && redo.isEnabled })
        redo.tap()
        XCTAssertTrue(waitUntil { undo.isEnabled && !redo.isEnabled })
    }

    private func articleActions(_ title: String) -> XCUIElement {
        app.buttons["Actions for \(title)"]
    }

    private func selectFilter(_ label: String) {
        tapToolbarMenu(app.buttons["Filter and sort"])
        let choice = app.buttons[label]
        XCTAssertTrue(choice.waitForExistence(timeout: 3))
        choice.tap()
    }

    private func tapToolbarMenu(_ menu: XCUIElement) {
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil {
            menu.isEnabled && !menu.frame.isEmpty && self.app.frame.contains(menu.frame)
        })
        // XCTest on iPadOS 18 tries an unsupported AX scroll action for SwiftUI
        // toolbar menus. Tap the verified on-screen control directly; callers
        // still assert that the menu opens and its action changes app state.
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func openArticle(_ title: String) {
        let ids = [attention: "demo-margins", tools: "demo-tools", slow: "demo-slow", connections: "demo-connections"]
        guard let id = ids[title] else { XCTFail("Unknown demo article: \(title)"); return }
        let row = app.buttons["articleRow-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.buttons["reader-tool-note"].waitForExistence(timeout: 8))
    }

    private func goBackToLibrary() {
        let back = app.navigationBars.buttons["Inkwell"]
        XCTAssertTrue(back.waitForExistence(timeout: 3))
        back.tap()
        XCTAssertTrue(articleActions(attention).waitForExistence(timeout: 5))
    }

    private func replaceText(in field: XCUIElement, with text: String) {
        field.tap()
        if field.elementType == .searchField {
            // UISearchBar exposes its own clear action and does not consistently
            // honor Command-A in an iPad navigation bar.
            field.buttons["Clear text"].tap()
            field.tap()
        } else {
            // A populated alert field can put the caret in its middle.
            // Use the native edit menu; Command-A depends on the simulator's
            // hardware-keyboard state and may silently leave the caret alone.
            field.press(forDuration: 1)
            let selectAll = app.menuItems["Select All"]
            XCTAssertTrue(selectAll.waitForExistence(timeout: 3))
            let selectionFrame = selectAll.frame
            XCTAssertFalse(selectionFrame.isEmpty)
            XCTAssertTrue(app.frame.contains(selectionFrame))
            // Anchor the touch inside the alert's hierarchy. XCTest otherwise
            // treats the alert as an interruption to its detached edit menu
            // and automatically dismisses it with Cancel.
            field.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
                dx: selectionFrame.midX - field.frame.minX,
                dy: selectionFrame.midY - field.frame.minY
            )).tap()
        }
        field.typeText(text)
        XCTAssertEqual(field.value as? String, text, "The test must finish editing before submitting the form.")
    }

    private func waitUntil(_ check: @escaping () -> Bool, timeout: TimeInterval = 3) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
}
