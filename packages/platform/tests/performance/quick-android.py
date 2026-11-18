"""Fast FrameTimeline check for one interaction cycle.

Starts a ~16 s Perfetto capture, drives open/pause/seek/play/suspend/resume/
exit with adb key events, then counts flagged activity-window buffers using the
same frame_timeline helpers as the ten-minute gate. This exists to iterate on a
fix in seconds; the three-pass run remains the qualification gate.

Usage:
  python3 quick-android.py --package dev.solidapp.aprobe --serial SERIAL
"""

import argparse
import csv
import io
import json
import pathlib
import re
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from frame_timeline import is_flagged, layer_query, split_layers  # noqa: E402

PROCESSOR = "/tmp/smp-trace-processor"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--out", type=pathlib.Path)
    parser.add_argument("--seconds", type=int, default=16)
    args = parser.parse_args()

    adb = ["adb", "-s", args.serial]

    def shell(*command, check=True):
        return subprocess.run(
            adb + ["shell", *command],
            capture_output=True,
            text=True,
            check=check,
            timeout=40,
        ).stdout

    def key(code):
        shell("input", "keyevent", str(code))

    def device_ms():
        try:
            return int(float(shell("cat", "/proc/uptime").split()[0]) * 1000)
        except Exception:
            return None

    marks = []

    def mark(name):
        marks.append((name, device_ms()))

    remote = "/data/misc/perfetto-traces/quick-" + uuid.uuid4().hex + ".perfetto-trace"
    config = f"""buffers {{ size_kb: 32768 fill_policy: RING_BUFFER }}
data_sources {{ config {{ name: "android.surfaceflinger.frametimeline" }} }}
data_sources {{ config {{ name: "linux.ftrace" ftrace_config {{ atrace_apps: "{args.package}" atrace_categories: "view" }} }} }}
duration_ms: {args.seconds * 1000}
write_into_file: true
file_write_period_ms: 2000
"""
    shell("input", "keyevent", "224", check=False)  # WAKEUP
    shell("wm", "dismiss-keyguard", check=False)
    time.sleep(0.5)
    shell("am", "force-stop", args.package)
    shell("run-as", args.package, "mkdir", "-p", "files", check=False)
    shell("run-as", args.package, "touch", "files/mixed-overlay", check=False)
    shell("run-as", args.package, "touch", "files/mixed-lifecycle-test", check=False)
    shell("run-as", args.package, "rm", "-f", "files/mixed-events.json", check=False)
    shell("run-as", args.package, "rm", "-f", "files/mixed-ready", check=False)

    # Start the recorder before launching the app so its multi-second startup
    # cannot let the TV screensaver take focus, and so the capture covers the
    # keys. Frames before the first mark are ignored below.
    recorder = int(
        subprocess.run(
            adb
            + [
                "shell",
                "perfetto",
                "--background-wait",
                "--txt",
                "-c",
                "-",
                "-o",
                remote,
            ],
            input=config,
            capture_output=True,
            text=True,
            check=True,
            timeout=40,
        ).stdout.strip()
    )
    shell("am", "start", "-W", "-n", args.package + "/com.tns.NativeScriptActivity")
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        dump = shell("dumpsys", "input")
        focused = re.search(
            r"displayId=0,[^\n]*" + re.escape(args.package) + r"/", dump
        )
        ready = shell(
            "run-as",
            args.package,
            "cat",
            "files/mixed-ready",
            check=False,
        ).strip()
        if focused and ready == "ready":
            break
        time.sleep(0.25)
    time.sleep(0.5)
    started = time.monotonic()
    mark("start")
    key(22)
    time.sleep(0.20)
    mark("modal")
    key(23)
    time.sleep(0.20)
    mark("play-open")
    key(23)
    time.sleep(1.20)
    mark("pause")
    key(23)
    time.sleep(0.40)
    mark("seek")
    key(22)
    time.sleep(0.20)
    mark("play")
    key(23)
    time.sleep(0.80)
    activity = args.package + "/com.tns.NativeScriptActivity"
    mark("home")
    shell("am", "start", "-n", activity, "--es", "solid-lifecycle", "suspend")
    time.sleep(1.0)
    mark("relaunch")
    shell("am", "start", "-n", activity, "--es", "solid-lifecycle", "resume")
    time.sleep(1.2)
    mark("play-after-resume")
    key(23)
    time.sleep(0.80)
    mark("back-exit")
    key(4)
    time.sleep(0.45)
    mark("back-gallery")
    key(4)
    time.sleep(0.25)
    mark("focus")
    key(21)
    time.sleep(0.40)
    mark("end")
    elapsed = time.monotonic() - started

    # Stop the recorder now; it flushes the trace on SIGINT.
    shell("kill", "-INT", str(recorder), check=False)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        cmdline = shell("cat", f"/proc/{recorder}/cmdline", check=False)
        if remote not in cmdline:
            break
        time.sleep(0.3)
    time.sleep(0.5)

    local = pathlib.Path("/var/tmp") / pathlib.Path(remote).name
    subprocess.run(adb + ["pull", remote, str(local)], check=True, capture_output=True)
    shell("rm", "-f", remote, check=False)

    query = subprocess.run(
        [PROCESSOR, "query", "--no-agent", "--format", "csv", str(local), layer_query(args.package)],
        capture_output=True,
        text=True,
        check=True,
    )
    rows = list(csv.DictReader(io.StringIO(query.stdout)))
    frames, other, reconciliation = split_layers(rows, args.package)

    def window_at(ts_ns):
        at = ts_ns / 1e6
        return next(
            (name for name, ms in reversed(marks) if ms is not None and ms <= at),
            "before-start",
        )

    start_ts = next((ms for name, ms in marks if name == "start"), 0) or 0
    measured = [row for row in frames if int(row["ts"]) >= start_ts * 1_000_000]

    flagged = []
    for row in measured:
        if not is_flagged(row):
            continue
        flagged.append(
            {
                "window": window_at(int(row["ts"])),
                "durMs": round(int(row["dur"]) / 1e6, 1) if row["dur"].lstrip("-").isdigit() else None,
                "presentType": row["present_type"],
                "jankType": row["jank_type"],
                "displayPresent": row["display_present_type"],
            }
        )

    report = {
        "package": args.package,
        "seconds": round(elapsed, 2),
        "frames": len(measured),
        "flagged": len(flagged),
        "pct": round(100 * len(flagged) / len(measured), 2) if measured else None,
        "reconciliation": reconciliation,
        "marks": marks,
        "flaggedDetail": flagged,
        "trace": str(local),
    }
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    return 0 if frames else 1


if __name__ == "__main__":
    sys.exit(main())
