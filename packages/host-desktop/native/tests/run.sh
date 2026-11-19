#!/usr/bin/env bash
# Runs the runtime's own tests: scripts it executes and judges itself, plus
# checks here of what it prints and how it exits. Tests with a window need a
# display; on Linux they run in a virtual framebuffer with software GL unless
# SOLID_DESKTOP_VIRTUAL=0 asks for the real one. SOLID_DESKTOP_HEADLESS_ONLY=1
# skips them (macOS and Windows CI, where a window needs a GL ES driver).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# Git Bash and MSYS on Windows report MINGW*/MSYS*; the executable ends .exe.
system=$(uname -s)
case "$system" in
  MINGW*|MSYS*|CYGWIN*) exe=solid-desktop.exe ;;
  *) exe=solid-desktop ;;
esac
bin="${1:-$here/../target/release/$exe}"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

windowed() {
  case "$system" in
    Linux*)
      if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" || "${SOLID_DESKTOP_VIRTUAL:-1}" == 1 ]]; then
        SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" "$@"
      else
        "$@"
      fi
      ;;
    # macOS and Windows runners have a window server of their own and no
    # xvfb. CI runs the headless subset there; a window needs a GL ES driver.
    *) "$@" ;;
  esac
}
fail() {
  echo "FAILED: $1" >&2
  exit 1
}
expect() {
  grep -qE -- "$2" "$1" || { cat "$1" >&2; fail "expected /$2/ in the output above"; }
}

"$bin" --headless "$here/timers.js"
"$bin" --headless "$here/images.js"

# Errors a running script makes are reported with their stacks and do not
# end it; output goes to the stream it belongs on.
"$bin" --headless "$here/errors.js" >"$scratch/out" 2>"$scratch/err"
expect "$scratch/out" '^to standard output \{"answer":42\}$'
expect "$scratch/err" '^to standard error$'
expect "$scratch/err" '^Uncaught Error: thrown in a timer$'
expect "$scratch/err" 'at inATimer \(.*errors\.js:[0-9]+'
expect "$scratch/err" '^Uncaught TypeError: .*null'
expect "$scratch/err" 'at inAFrame \(.*errors\.js:[0-9]+'
expect "$scratch/err" '^Unhandled promise rejection: TypeError: rejected and never handled$'
expect "$scratch/err" 'at rejecting \(.*errors\.js:[0-9]+'
if grep -q 'handled late' "$scratch/err"; then fail "a handled rejection was reported"; fi

# A script that cannot start is fatal.
status=0
"$bin" --headless "$here/fatal.js" 2>"$scratch/err" || status=$?
[[ $status == 1 ]] || fail "a script that throws at start exited with $status, not 1"
expect "$scratch/err" '^Uncaught RangeError: cannot start$'
expect "$scratch/err" 'at start \(.*fatal\.js:[0-9]+'

# Bytecode: the same script compiled runs the same; bytes that are neither
# source nor bytecode this engine reads fail loudly.
"$bin" --compile "$here/timers.js" "$scratch/timers.hbc"
"$bin" --headless "$scratch/timers.hbc"
head -c 64 "$scratch/timers.hbc" >"$scratch/truncated.hbc"
status=0
"$bin" --headless "$scratch/truncated.hbc" 2>"$scratch/err" || status=$?
[[ $status == 1 ]] || fail "truncated bytecode exited with $status, not 1"
status=0
"$bin" --compile "$here/run.sh" "$scratch/never.hbc" 2>"$scratch/err" || status=$?
[[ $status == 1 && ! -e "$scratch/never.hbc" ]] || fail "compiling a file that is not JavaScript did not fail"

if [[ "${SOLID_DESKTOP_HEADLESS_ONLY:-0}" != 1 ]]; then
  windowed "$bin" "$here/first-frame.js"
  windowed "$bin" "$here/gl-binding.js"
fi
echo "desktop runtime tests passed"
