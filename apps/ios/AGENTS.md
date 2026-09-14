# Native Inkwell

- This is a native SwiftUI/UIKit app targeting iOS and iPadOS 18 or newer. Read the root AGENTS.md and DESIGN.md.
- Use Apple frameworks already available in the SDK. Ask before adding a package or changing the database schema.
- `Inkwell.xcodeproj` is checked in. `project.yml` is its source; after adding/removing source files or changing project settings, run `xcodegen generate --spec apps/ios/project.yml` from the repository root (XcodeGen is already available on Davis's Mac).
- Keep Debug (`sh.davis7.inkwell.dev`) and Release (`sh.davis7.inkwell`) identities and public service configurations separate.
- Keep secrets out of the application. Configuration contains only public URLs and the Clerk publishable key. Session credentials belong in Keychain.
- The shared annotation JSON format and layout snapshot are contracts with the web app and MCP. Preserve them when editing rendering or persistence. Failed decoding must never become an empty writable annotation set.
- Stage completed annotations durably before asynchronous sync. Native layout changes must remap existing marks through block geometry.
- Build with `pnpm build:ios`; test with `pnpm test:ios`; launch with `pnpm mobile`. `INKWELL_SIMULATOR_ID` selects an installed iPad simulator.
- `--demo` is a Debug-only launch option for an isolated, in-memory sample library. It must never substitute for a failed authenticated request.
