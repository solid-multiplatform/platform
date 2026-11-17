#!/usr/bin/env bash
# Exercise the generated Swift command through NativeScript on a real simulator runtime.
set -euo pipefail
target="${1:?expected ios or apple-tv}"
case "$target" in
  ios) runtime=iOS; device=iPhone ;;
  apple-tv) runtime=tvOS; device='Apple TV' ;;
  *) exit 2 ;;
esac
phase="${2:-all}"
if [[ "$phase" == all ]]; then scratch=$(mktemp -d)
else scratch="${RUNNER_TEMP:?}/solid-swift-$target"; mkdir -p "$scratch"; fi
if [[ "$phase" != launch ]]; then
node cli/main.mjs init "$scratch/swift-probe" --targets "$target"
cd "$scratch/swift-probe"
corepack pnpm install
corepack pnpm platform plugin new greeting
# Replace only the test application's mount function to observe the bridge result.
cat > src/app.tsx <<'APP'
import { File, knownFolders } from '@nativescript/core';
export function mount(plugins) {
  const output = File.fromPath(knownFolders.documents().path + '/plugin-result.txt');
  Promise.resolve().then(() => plugins.greeting.run())
    .then(result => output.writeText(result), error => output.writeText(String(error)));
  return () => {};
}
APP
corepack pnpm build "$target"
if [[ "$phase" == build ]]; then exit; fi
fi
cd "$scratch/swift-probe"
app=$(find "targets/$target/platforms" -path '*/Debug-*simulator/*.app' -type d | head -1)
test -d "$app"
bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
udid=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
data=json.load(sys.stdin)["devices"]
for runtime in reversed(sorted(data)):
    if ("."+sys.argv[1]+"-") not in runtime: continue
    for device in data[runtime]:
        if device["name"].startswith(sys.argv[2]):
            print(device["udid"])
            sys.exit(0)
raise SystemExit("Simulator unavailable")
' "$runtime" "$device")
xcrun simctl boot "$udid" || xcrun simctl bootstatus "$udid" -b
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"
xcrun simctl launch "$udid" "$bundle"
container=$(xcrun simctl get_app_container "$udid" "$bundle" data)
for attempt in {1..90}; do
  if test -f "$container/Documents/plugin-result.txt"; then
    result=$(cat "$container/Documents/plugin-result.txt")
    echo "Swift bridge returned: $result"
    test "$result" = "greeting Swift"
    exit
  fi
  sleep 1
done
xcrun simctl spawn "$udid" log show --last 2m --predicate 'process == "SolidMultiplatform"' | tail -80
exit 1
