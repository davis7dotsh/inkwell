#!/usr/bin/env bash
set -euo pipefail
ios_root="$(cd "$(dirname "$0")/.." && pwd)"
simulator_id="$(bash "$ios_root/scripts/simulator.sh")"
xcodebuild -project "$ios_root/Inkwell.xcodeproj" -scheme Inkwell \
  -configuration Debug -destination "id=$simulator_id" \
  -derivedDataPath "$ios_root/build" \
  -parallel-testing-enabled NO -collect-test-diagnostics never CODE_SIGN_IDENTITY=- test "$@"
