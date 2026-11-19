#!/usr/bin/env bash
set -euo pipefail
framework=$(pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
corepack pnpm pack --pack-destination "$scratch"
tar -xzf "$scratch"/solid-multiplatform-platform-*.tgz -C "$scratch"
node "$scratch/package/cli/main.mjs" init "$scratch/smoke-app" --targets web,desktop,roku,tizen,webos,vizio
cd "$scratch/smoke-app"
test -f solid-platform.config.json
# A command a target does not implement is refused with exit code 2.
code=0; node "$scratch/package/cli/main.mjs" logs web 2>"$scratch/refused.log" || code=$?
[[ $code -eq 2 ]] && grep -Fq 'web does not implement logs' "$scratch/refused.log"
node "$scratch/package/cli/main.mjs" doctor web tizen webos vizio
node --input-type=module -e '
  import assert from "node:assert/strict";
  import {readFileSync} from "node:fs";
  const manifest = path => JSON.parse(readFileSync(path));
  const expected = manifest("targets/roku/package.json").packageManager;
  assert.match(expected, /^pnpm@[\d.]+$/);
  for (const file of ["package.json", "targets/web/package.json", "targets/desktop/package.json"])
    assert.equal(manifest(file).packageManager, expected);
'
corepack pnpm install
corepack pnpm platform plugin new greeting
if corepack pnpm platform plugin new greeting; then exit 1; fi
corepack pnpm check
corepack pnpm platform plugins run desktop | tee "$scratch/desktop.log"
grep -Fx 'greeting greeting desktop' "$scratch/desktop.log"
# Observe a command called by the real starter via keyboard input in Chromium.
cat > plugins/greeting/web/index.mjs <<'JS'
export async function run() { document.documentElement.dataset.pluginResult = 'greeting'; return 'greeting'; }
JS
corepack pnpm build web
node "$framework/tests/cli/browser-smoke.mjs" targets/web/dist
cp plugins/greeting/web/index.mjs plugins/greeting/tizen/index.mjs
corepack pnpm build tizen
node "$framework/tests/cli/browser-smoke.mjs" targets/tizen/dist --tv
corepack pnpm build tizen --legacy
node "$framework/tests/cli/browser-smoke.mjs" targets/tizen/dist-legacy --tv
for tv in webos vizio; do
  cp plugins/greeting/web/index.mjs "plugins/greeting/$tv/index.mjs"
  corepack pnpm build "$tv"
  node "$framework/tests/cli/browser-smoke.mjs" "targets/$tv/dist" --tv
done
# The webOS build ends in an .ipk named by the id and version in the config.
test -f targets/webos/dist-package/dev.solidapp.asmokeapp_0.1.0_all.ipk
corepack pnpm build roku
python3 - <<'PY'
from zipfile import ZipFile
with ZipFile("targets/roku/dist-roku/solid-multiplatform.zip") as app:
    assert b'pkg:/components/greeting/PGreetingTask.brs' in app.read('components/greeting/PGreetingTask.xml')
    assert b'greeting Roku' in app.read('components/greeting/PGreetingTask.brs')
PY
# An app created before solid-platform.config.json has only solid-platform.json
# (name and targets) and must keep building.
node --input-type=module -e '
  import {readFileSync, rmSync, writeFileSync} from "node:fs";
  const {name, targets} = JSON.parse(readFileSync("solid-platform.config.json"));
  writeFileSync("solid-platform.json", JSON.stringify({name, targets}));
  rmSync("solid-platform.config.json");
'
corepack pnpm build web
node "$framework/tests/cli/browser-smoke.mjs" targets/web/dist
corepack pnpm build tizen
grep -Fq 'version="0.2.0"' targets/tizen/dist/config.xml
