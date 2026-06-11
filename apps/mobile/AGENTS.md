# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

(This project is pinned to SDK 54 because that's the newest Expo Go on the
App Store — see README. Do not upgrade the SDK without checking the App
Store's Expo Go "Supported SDK" first.)

- use pnpm for the package manager in this project

## After every `pod install`: delete the hermes marker

`pod install` resets `ios/Pods/hermes-engine/destroot` to the DEBUG hermes,
but the build-time swap script skips itself when `ios/Pods/.last_build_configuration`
still says `Release` — shipping debug Hermes inside Release builds, which
segfaults at startup (EXC_BAD_ACCESS in initializeRuntime) on every OS.
Fix: `rm ios/Pods/.last_build_configuration` after pod install, then build
twice or `touch` the destroot files (tar restores old mtimes, so the first
build's copy phase thinks the embedded framework is newer). Verify with:
`dwarfdump --uuid ios/build/.../Inkwell.app/Frameworks/hermes.framework/hermes`
(release 0.81.5 arm64 = 80D5528F…, debug = 3CB559A9…).
