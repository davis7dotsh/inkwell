#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${INKWELL_SIMULATOR_ID:-}" ]]; then
  printf '%s\n' "$INKWELL_SIMULATOR_ID"
else
  xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = [d for group in json.load(sys.stdin)["devices"].values() for d in group if "iPad" in d["name"]]
if not devices: sys.exit("No iPad simulator is installed. Install an iOS runtime in Xcode Settings > Components.")
devices.sort(key=lambda d: (d["state"] != "Booted", "Pro 13" not in d["name"]))
print(devices[0]["udid"])
'
fi
