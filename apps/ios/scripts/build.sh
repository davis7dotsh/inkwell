#!/usr/bin/env bash
set -euo pipefail
ios_root="$(cd "$(dirname "$0")/.." && pwd)"
configuration=Debug
if [[ "${1:-}" == "--release" ]]; then configuration=Release; fi
xcodebuild -project "$ios_root/Inkwell.xcodeproj" -scheme Inkwell \
  -configuration "$configuration" -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$ios_root/build" CODE_SIGN_IDENTITY=- build
