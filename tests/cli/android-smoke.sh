#!/usr/bin/env bash
# Without an emulator serial this checks the generated APK and its three ABI slices.
set -euo pipefail
serial="${1:-}"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
node cli/main.mjs init "$scratch/plugin-probe" --targets android-tv
cd "$scratch/plugin-probe"
corepack pnpm install
# Users can add native modules to an application that has already been built.
corepack pnpm build android-tv
for kind in kotlin jni service sidecar; do
  corepack pnpm platform plugin new "check-$kind" --android-kind "$kind"
done
cat > src/app.tsx <<'APP'
import { File, knownFolders } from '@nativescript/core';
export function mount(plugins) {
  async function check() {
    const results = {};
    for (const [name, plugin] of Object.entries(plugins)) {
      try { results[name] = await plugin.run(); }
      catch (error) { results[name] = String(error); }
    }
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
adb -s "$serial" shell am start -W -n "$id/com.tns.NativeScriptActivity"
for attempt in {1..60}; do
  if adb -s "$serial" shell run-as "$id" cat files/commands.json >"$scratch/results.json" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$scratch/results.json" <<'PY'
import sys,json,base64
with open(sys.argv[1]) as f: results=json.load(f)
assert results['check-kotlin'].startswith('check-kotlin Android API ')
assert results['check-jni']=='check-jni native library'
assert results['check-service']=='check-service service'
expected = b''.join(bytes([32 if (x + y) % 2 == 0 else 224] * 3 + [255]) for y in range(8) for x in range(8))
assert base64.b64decode(results['check-sidecar'], validate=True)==expected
print("Kotlin, JNI, foreground service and offscreen sidecar returned the expected results")
PY
