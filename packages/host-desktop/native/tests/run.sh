#!/usr/bin/env bash
# Runs the runtime's script tests. The windowed test needs a display; on a
# machine without one it runs in a virtual framebuffer with software GL.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bin="${1:-$here/../target/release/solid-desktop}"
"$bin" --headless "$here/timers.js"
if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" || "${SOLID_DESKTOP_VIRTUAL:-1}" == 1 ]]; then
  SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" "$bin" "$here/first-frame.js"
else
  "$bin" "$here/first-frame.js"
fi
echo "desktop runtime tests passed"
