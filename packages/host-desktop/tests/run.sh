#!/usr/bin/env bash
# Every automated check of the desktop host, in order: the runtime's own
# tests, then the real scene. Exits non-zero on the first failure.
#
#   bash tests/run.sh
#
# Windows open on a virtual display with software GL (set
# SOLID_DESKTOP_VIRTUAL=0 to use the real one). Needs the runtime built
# (native/README.md) and Playwright's Chromium.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

bash "$here/../native/tests/run.sh"
node "$here/adapter/run.mjs"

if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" || "${SOLID_DESKTOP_VIRTUAL:-1}" == 1 ]]; then
  SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" node "$here/scene/run.mjs"
else
  node "$here/scene/run.mjs"
fi
echo "desktop host tests passed"
