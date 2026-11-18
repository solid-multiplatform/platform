#!/usr/bin/env bash
set -euo pipefail
framework=$(pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
node cli/main.mjs init "$scratch/smoke-app" --targets web,desktop,roku
cd "$scratch/smoke-app"
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
corepack pnpm build roku
python3 - <<'PY'
from zipfile import ZipFile
with ZipFile("targets/roku/dist-roku/solid-multiplatform.zip") as app:
    assert b'pkg:/components/greeting/PGreetingTask.brs' in app.read('components/greeting/PGreetingTask.xml')
    assert b'greeting Roku' in app.read('components/greeting/PGreetingTask.brs')
PY
