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
probe="$(pwd)/tests/native-device/apple-probe"
if [[ "$phase" == all ]]; then scratch=$(mktemp -d)
else scratch="${RUNNER_TEMP:?}/solid-swift-$target"; mkdir -p "$scratch"; fi
if [[ "$phase" != launch ]]; then
framework=$(pwd)
node cli/main.mjs init "$scratch/swift-probe" --targets "$target"
cd "$scratch/swift-probe"
corepack pnpm install
corepack pnpm platform plugin new greeting
archive=$(cd "$framework/../video" && npm pack --silent --pack-destination "$scratch")
corepack pnpm platform add video "$scratch/$archive"
# One build, two launches: the Swift and playback check, then the services probe.
cp "$framework/tests/cli/apple-media-fixture.ts" src/media-fixture.ts
cp "$probe/app.ts" src/app.tsx
cp "$probe/services-probe.ts" src/services-probe.ts
cp "$framework/tests/cli/media/clip.mp4" "targets/$target/clip.mp4"
node --input-type=module - "$target" <<'JS'
import fs from 'node:fs';
const file='targets/'+process.argv[2]+'/webpack.config.js';
fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('chainSolidTV(config);',`chainSolidTV(config);
config.plugin('CopyWebpackPlugin').tap(args=>{args[0].patterns.push({from:path.resolve(__dirname,'clip.mp4'),to:'clip.mp4'});return args;});`));
JS
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
  if test -s "$container/Documents/plugin-result.txt"; then
    result=$(cat "$container/Documents/plugin-result.txt")
    echo "Swift bridge returned: $result"
    test "$result" = "greeting Swift"
    # Second launch of the same build: every device service, through the registry.
    xcrun simctl terminate "$udid" "$bundle" || true
    report="$container/Documents/services-probe.json"
    rm -f "$report"
    SIMCTL_CHILD_SOLID_SERVICES_PROBE=1 xcrun simctl launch "$udid" "$bundle"
    for tick in {1..90}; do
      if grep -q '"done":true' "$report" 2>/dev/null; then
        node "$probe/check.mjs" "$target" "$report"
        exit
      fi
      sleep 1
    done
    echo "Services probe did not finish. Results so far:"
    cat "$report" || true
    break
  fi
  sleep 1
done
cat "$container/Documents/media-progress.txt" || true
xcrun simctl spawn "$udid" log show --last 3m --predicate 'process == "SolidMultiplatform"' > "$scratch/app.log" || true
# JavaScript console output first: a startup error is otherwise buried under UIKit lifecycle lines.
grep -iE 'startup failed|error|exception|CONSOLE' "$scratch/app.log" | grep -v 'Event Timing Profile' | tail -40 || true
tail -40 "$scratch/app.log"
exit 1
