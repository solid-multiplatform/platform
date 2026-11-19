#!/usr/bin/env bash
# A generated app on the native desktop runtime, end to end: pack the platform
# and the desktop host, init an app with --targets desktop, add the host
# release, install, build Hermes bytecode, then run it on a virtual display
# until the first frame is presented. No Node runs the app; Node only packs
# and bundles it.
#
#   bash tests/cli/desktop-smoke.sh [working-directory]
#
# Skips with one line when xvfb-run or a built runtime is absent.
set -euo pipefail
framework=$(pwd)
command -v xvfb-run >/dev/null || {
  echo 'desktop smoke skipped: xvfb-run is not installed'
  exit 0
}
runtime=${SOLID_DESKTOP_RUNTIME:-$framework/../host-desktop/native/target/release/solid-desktop}
if [[ ! -x "$runtime" ]]; then
  echo "desktop smoke skipped: no runtime at $runtime (set SOLID_DESKTOP_RUNTIME, or build packages/host-desktop/native)"
  exit 0
fi
runtime=$(cd "$(dirname "$runtime")" && pwd)/$(basename "$runtime")

scratch=${1:-}
if [[ -z "$scratch" ]]; then
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/smp-desktop-smoke.XXXXXX")
fi
mkdir -p "$scratch"
trap '[[ -n "${keep:-}" ]] || rm -rf "$scratch"' EXIT

# The platform release the app installs.
corepack pnpm pack --pack-destination "$scratch" >/dev/null
tar -xzf "$scratch"/solid-multiplatform-platform-*.tgz -C "$scratch"

# The desktop host's own build tool, as a release archive.
host_pack=$scratch/host
mkdir -p "$host_pack"
(cd "$framework/../host-desktop" && corepack pnpm pack --pack-destination "$host_pack" >/dev/null)

app=$scratch/app
rm -rf "$app"
node "$scratch/package/cli/main.mjs" init "$app" --targets desktop
cd "$app"
node "$scratch/package/cli/main.mjs" add desktop "$host_pack"/solid-multiplatform-host-desktop-*.tgz
corepack pnpm install
SOLID_DESKTOP_RUNTIME=$runtime corepack pnpm build desktop
test -f targets/desktop/work/bundle/app.hbc
test -f targets/desktop/work/bundle/fonts/Lato-Regular.msdf.json

# The window opens on Xvfb with software GL; the runtime ends itself as soon
# as a frame reaches the screen, so nothing is left open.
output=$(
  SOLID_DESKTOP_RUNTIME=$runtime SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 \
    timeout 60 xvfb-run -a -s "-screen 0 1280x720x24" \
    "$runtime" --first-frame-exit targets/desktop/work/bundle/app.hbc 2>&1
) || {
  status=$?
  echo "$output"
  echo "desktop smoke failed: the runtime exited with $status" >&2
  exit 1
}
echo "$output"
grep -Fx 'first frame presented' <<<"$output" >/dev/null
echo 'desktop smoke passed: the generated app presented its first frame'
