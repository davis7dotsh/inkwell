# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

This project is on SDK 56 (React Native 0.85, React 19.2). Expo Go is NOT
available for SDK 56 on the App Store — development happens through the
expo-dev-client builds instead:

- `pnpm dev` (expo start) runs Metro.
- Simulator: build/install the Debug app, it connects to Metro.
- iPad: `pnpm ipad:dev` installs a Debug dev client with bundle id
  `sh.davis7.inkwell.dev`, so it coexists with the prod app
  (`pnpm ipad`, bundle id `sh.davis7.inkwell`). Rebuild the dev client only
  when native deps change; JS comes from Metro.

- use pnpm for the package manager in this project
- `ios/` is generated (CNG): `npx expo prebuild -p ios --clean` regenerates
  it, including the Clerk plugin's injected Swift (ClerkNativeBridge). Do not
  hand-edit ios/ — change app.json/plugins instead.
- @clerk/expo's config plugin requires `@expo/config-plugins` without
  declaring it; the root `.pnpmfile.cjs` injects it. If Clerk fixes this
  upstream, the hook can go.

## After every `pod install`: delete the hermes marker

`pod install` resets the hermes destroot in Pods to the DEBUG hermes, but the
build-time swap script skips itself when `ios/Pods/.last_build_configuration`
still says `Release` — shipping debug Hermes inside Release builds, which
segfaults at startup (EXC_BAD_ACCESS in initializeRuntime) on every OS.
This footgun is unchanged in RN 0.85 (the framework is now named
`hermesvm.xcframework`). Fix: `rm ios/Pods/.last_build_configuration` after
pod install, then build twice or `touch` the destroot files (tar restores old
mtimes, so the first build's copy phase thinks the embedded framework is
newer). Verify the embedded hermes binary UUID differs between Debug and
Release builds via `dwarfdump --uuid`.
