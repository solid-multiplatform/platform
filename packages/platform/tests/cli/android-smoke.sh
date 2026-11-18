#!/usr/bin/env bash
# Without an emulator serial this checks the generated APK and its three ABI slices.
set -euo pipefail
serial="${1:-}"
framework=$(pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
node cli/main.mjs init "$scratch/plugin-probe" --targets android-tv
cd "$scratch/plugin-probe"
corepack pnpm install
# Users can add native modules to an application that has already been built.
corepack pnpm build android-tv
(cd "$framework/../video" && npm pack --silent --ignore-scripts --pack-destination "$scratch")
corepack pnpm platform add video "$scratch"/solid-multiplatform-video-*.tgz
corepack pnpm install --no-frozen-lockfile
(cd targets/android-tv && corepack pnpm install --no-frozen-lockfile)
cp "$framework/tests/cli/android-media-fixture.ts" src/media.ts
cp "$framework/tests/cli/media/caption.mp4" targets/android-tv/caption.mp4
python3 - <<'PY'
from pathlib import Path
file = Path("targets/android-tv/webpack.config.js")
source = file.read_text()
anchor = "chainSolidTV(config);"
assert source.count(anchor) == 1
file.write_text(source.replace(anchor, anchor + """
    config.plugin('CopyWebpackPlugin').tap(args => {
      args[0].patterns.push({from: path.resolve(__dirname, 'caption.mp4'), to: 'caption.mp4'});
      return args;
    });"""))
PY
for kind in kotlin jni service sidecar; do
  corepack pnpm platform plugin new "check-$kind" --android-kind "$kind"
done
cat > src/app.tsx <<'APP'
import { File, knownFolders } from '@nativescript/core';
import { checkAndroidMedia } from './media';
export function mount(plugins, _fonts, _input, host) {
  async function check() {
    const results = {};
    for (const [name, plugin] of Object.entries(plugins)) {
      try { results[name] = await plugin.run(); }
      catch (error) { results[name] = String(error); }
    }
    try { results.media = await checkAndroidMedia(host); }
    catch (error) { results.media = String(error); }
    await File.fromPath(knownFolders.documents().path + '/commands.json').writeText(JSON.stringify(results));
  }
  void check();
  return () => {};
}
APP
corepack pnpm build android-tv
apk=targets/android-tv/platforms/android/app/build/outputs/apk/debug/app-debug.apk
python3 - "$apk" <<'PY'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    names = apk.read('assets/metadata/treeStringsStream.dat')
    assert b'pcheck_kotlin' in names and b'pcheck_jni' in names
    assert b'AndroidPlayerFactory' in names
    assert 'res/layout/solid_multiplatform_video_player.xml' in apk.namelist()
    for cpu in ('armeabi-v7a','arm64-v8a','x86_64'):
        for lib in ('libsolidcheck_sidecar.so','libsolidcheck_jni.so'):
            assert apk.read(f'lib/{cpu}/{lib}')[:4] == b'\x7fELF'
print("Packaged JNI and executable plugins for all three Android ABIs")
PY
python3 - <<'PY'
from pathlib import Path
module = Path('plugins/check-kotlin/android-tv')
command = next(module.glob('src/main/java/**/Commands.kt'))
command.write_text(command.read_text().replace('fun run()', 'fun editedPluginCommand()'))
binding = module / 'index.mjs'
binding.write_text(binding.read_text().replace('Commands.run()', 'Commands.editedPluginCommand()'))
PY
corepack pnpm build android-tv
python3 - "$apk" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    assert b'editedPluginCommand' in apk.read('assets/metadata/treeStringsStream.dat')
PY
if [[ -z "$serial" ]]; then exit; fi
if [[ "$serial" != emulator-* ]]; then echo 'Expected a test emulator serial' >&2; exit 2; fi
id=dev.solidapp.apluginprobe
adb -s "$serial" install -r "$apk"
adb -s "$serial" shell am force-stop "$id"
adb -s "$serial" shell run-as "$id" rm -f files/commands.json
adb -s "$serial" shell input keyevent KEYCODE_WAKEUP
adb -s "$serial" shell wm dismiss-keyguard
adb -s "$serial" shell am start -W -n "$id/com.tns.NativeScriptActivity"
for attempt in {1..60}; do
  if adb -s "$serial" shell run-as "$id" cat files/commands.json >"$scratch/results.json" 2>/dev/null && [[ -s "$scratch/results.json" ]]; then break; fi
  sleep 1
done
if [[ ! -s "$scratch/results.json" ]]; then
  echo 'Timed out waiting for native plugin and media results' >&2
  exit 1
fi
python3 - "$scratch/results.json" <<'PY'
import sys,json,base64
with open(sys.argv[1]) as f: results=json.load(f)
assert results['check-kotlin'].startswith('check-kotlin Android API ')
assert results['check-jni']=='check-jni native library'
assert results['check-service']=='check-service service'
expected = b''.join(bytes([32 if (x + y) % 2 == 0 else 224] * 3 + [255]) for y in range(8) for x in range(8))
assert base64.b64decode(results['check-sidecar'], validate=True)==expected
print("Kotlin, JNI, foreground service and offscreen sidecar returned the expected results")
assert results['media']=='Native captions and playback verified', results['media']
print(results['media'])
PY
