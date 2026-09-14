import SwiftUI

@main
struct InkwellApp: App {
    @State private var authentication: Authentication
    @State private var store: InkwellStore
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let authentication = Authentication(configuration: .current)
        _authentication = State(initialValue: authentication)
        _store = State(initialValue: InkwellStore(authentication: authentication))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if authentication.isSignedIn || store.isDemo {
                    LibraryView(store: store, authentication: authentication) {
                        store = InkwellStore(authentication: authentication, demo: false)
                    }
                } else {
                    SignInView(auth: authentication) {
                        store = InkwellStore(authentication: authentication, demo: true)
                    }
                }
            }
            .tint(InkwellTheme.accent)
            .background(InkwellTheme.paper)
            .task(id: store.isDemo) { if !store.isDemo { await authentication.restoreSession() } }
            .onChange(of: authentication.userID) { _, _ in
                store = InkwellStore(authentication: authentication, demo: false)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active && (authentication.isSignedIn || store.isDemo) {
                    Task { await store.refresh() }
                }
            }
        }
    }
}
