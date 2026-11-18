#!/usr/bin/env bash
# Every automated check of the desktop host, in order: the runtime's own
# tests, the platform adapter, the web-standard globals, the real scene
# against Chromium, then an app started through the host (input, text
# fields, services, requests, idle, closing), then an app packaged, moved
# and run from its package, then accessibility and the services of the
# session bus, each on a bus of the test's own. Exits non-zero on the first
# failure.
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
node "$here/web/run.mjs"

virtual() {
  if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" || "${SOLID_DESKTOP_VIRTUAL:-1}" == 1 ]]; then
    SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" "$@"
  else
    # On a real display the tests make their input up; nothing moves the
    # user's own pointer or types into their windows.
    SOLID_DESKTOP_XDOTOOL=0 "$@"
  fi
}
virtual node "$here/scene/run.mjs"
virtual node "$here/host/run.mjs"
virtual node "$here/package/run.mjs"
virtual node "$here/a11y/run.mjs"
node "$here/services/run.mjs"
echo "desktop host tests passed"
