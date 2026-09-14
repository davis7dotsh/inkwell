#!/usr/bin/env bash
set -euo pipefail
ios_root="$(cd "$(dirname "$0")/.." && pwd)"
configuration=Debug
device=false
iphone=false
launch_args=()
for argument in "$@"; do
  case "$argument" in
    --release) configuration=Release ;;
    --device) device=true ;;
    --iphone) iphone=true ;;
    --demo) launch_args+=(--demo) ;;
    *) printf 'Unknown argument: %s\n' "$argument" >&2; exit 1 ;;
  esac
done
if $iphone && ! $device; then
  printf '%s\n' '--iphone requires --device. For an iPhone simulator, set INKWELL_SIMULATOR_ID.' >&2
  exit 1
fi
bundle=sh.davis7.inkwell.dev
if [[ "$configuration" == Release ]]; then bundle=sh.davis7.inkwell; fi
if $device; then
  device_id="${INKWELL_DEVICE_ID:-00008142-001839490C22401C}"
  if $iphone; then device_id="${INKWELL_DEVICE_ID:-00008150-000E4DC41E61401C}"; fi
  xcodebuild -project "$ios_root/Inkwell.xcodeproj" -scheme Inkwell \
    -configuration "$configuration" -destination "id=$device_id" \
    -derivedDataPath "$ios_root/build" -allowProvisioningUpdates build
  xcrun devicectl device install app --device "$device_id" "$ios_root/build/Build/Products/$configuration-iphoneos/Inkwell.app"
  xcrun devicectl device process launch --device "$device_id" "$bundle" ${launch_args[@]+"${launch_args[@]}"}
else
  simulator_id="$(bash "$ios_root/scripts/simulator.sh")"
  if ! xcrun simctl list devices booted | /usr/bin/grep -q "$simulator_id"; then
    xcrun simctl boot "$simulator_id"
  fi
  open -a Simulator --args -CurrentDeviceUDID "$simulator_id"
  xcrun simctl bootstatus "$simulator_id" -b
  xcodebuild -project "$ios_root/Inkwell.xcodeproj" -scheme Inkwell \
    -configuration "$configuration" -destination "id=$simulator_id" \
    -derivedDataPath "$ios_root/build" CODE_SIGN_IDENTITY=- build
  xcrun simctl install "$simulator_id" "$ios_root/build/Build/Products/$configuration-iphonesimulator/Inkwell.app"
  xcrun simctl launch --terminate-running-process "$simulator_id" "$bundle" ${launch_args[@]+"${launch_args[@]}"}
fi
