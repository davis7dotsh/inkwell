# Inkwell for iPad and iPhone

Native SwiftUI navigation, library, and reader with UIKit Pencil input, AVFoundation voice memos, on-device Speech transcription, system PDF import, and native Markdown sharing. No JavaScript runtime, Metro server, CocoaPods, or third-party Swift packages are required.

## Run

Open `Inkwell.xcodeproj` in Xcode 16 or newer, choose the Inkwell scheme and an iPad simulator, and run. The minimum OS is iOS 18.

From the repository root:

```sh
pnpm mobile             # Build and launch the Debug app in an iPad simulator
pnpm mobile --demo      # Isolated sample library; no account required
pnpm build:ios          # Simulator build
pnpm test:ios           # Native model, cache, geometry, export, and UI tests
pnpm dev                # Local API and web services
```

Use `INKWELL_SIMULATOR_ID` to select a simulator, or `INKWELL_DEVICE_ID` with `pnpm ipad:dev` to select a connected physical device. Physical builds use the configured development team and require its signing access.

## Configuration

Debug uses the existing staging Clerk, Convex, and API services. Release uses production. The Debug app has its own orange icon, bundle identifier, and `inkwell-dev://` sign-in callback, so it coexists with the production app, which keeps `inkwell://`.

To connect the simulator to `pnpm api`, copy `apps/ios/Configuration/Local.xcconfig.example` to `apps/ios/Configuration/Local.xcconfig` from the repository root and rebuild. This ignored override points only simulator builds at `http://localhost:8787`. A physical iPad uses the deployed staging API unless you provide a reachable development address.

GitHub and Google sign-in open the system authentication browser. The app follows Clerk's native frontend API protocol; device and session credentials stay in Keychain. Existing users may need to sign in once after replacing the React Native app.

## Data compatibility

The app uses the existing Convex queries/mutations and worker endpoints. Articles, tags, read status, pins, strokes, boxes, notes, and voice memo metadata keep their current wire formats. No server schema migration is required.

Saved annotation block geometry maps existing marks to native text wrapping and future layout changes. Completed edits enter an atomic local queue before upload. Cached articles can be reopened offline, and pending annotations retry when the app reconnects. The library refreshes when the app becomes active and every 30 seconds while active, backing off to five minutes after failures. Pull to refresh is also available. Concurrent edits to the same article from multiple devices retain the backend's existing last-save-wins behavior.

Release preserves the production bundle identifier. Existing local recordings in `Documents/memos` migrate on access to the native audio store, and synced recordings remain accessible through the existing authenticated API. Imported PDFs continue to use extracted content blocks, matching the previous app.

## Validation

The test suite covers wire compatibility, corrupt annotation protection, account/environment cache isolation, durable pending edits, layout remapping, audio-file migration, Markdown export, and native library/reader flows using sample data. Completing OAuth with your account and testing Apple Pencil handling, palm rejection, and microphone quality requires interactive sign-in or a physical device.

`project.yml` describes the checked-in project. When adding files, regenerate it with:

```sh
xcodegen generate --spec apps/ios/project.yml
```
