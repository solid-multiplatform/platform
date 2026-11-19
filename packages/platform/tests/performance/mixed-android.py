"""Exercise one isolated gallery app through remote input, media and suspension on a physical TV."""

import argparse
import functools
import hashlib
import io
import json
import pathlib
import re
import shlex
import subprocess
import time
import uuid

from PIL import Image, ImageChops, ImageStat


@functools.cache
def clip_samples():
    # The bundled qualification clip is 192x108 H.264 at 24 fps. The lower
    # portion of the picture stays clear of both transport and native caption.
    clip = pathlib.Path(__file__).resolve().parents[1] / "cli/media/clip.mp4"
    raw = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(clip),
            "-map",
            "0:v:0",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout
    width, height = 192, 108
    size = width * height * 3
    if len(raw) != 192 * size:
        raise ValueError("Unexpected qualification clip frame count or dimensions")
    frames = []
    for offset in range(0, len(raw), size):
        frame = Image.frombytes("RGB", (width, height), raw[offset : offset + size])
        frames.append(
            frame.resize(
                (36, 12),
                Image.Resampling.BOX,
                box=(width * 0.04, height * 0.56, width * 0.96, height * 0.95),
            )
        )
    return frames


def compare_video(image, position):
    width, height = image.size
    box = (
        width * (0.35 + 0.6 * 0.04),
        height * (0.18 + 0.6 * 0.56),
        width * (0.35 + 0.6 * 0.96),
        height * (0.18 + 0.6 * 0.95),
    )
    picture = image.resize((36, 12), Image.Resampling.BOX, box=box)
    # The adapter publishes position once per second. Limit a paused still
    # to that observation window so a stale first frame cannot pass on resume.
    return min(
        (
            sum(ImageStat.Stat(ImageChops.difference(picture, frame)).mean) / 3,
            index / 24,
        )
        for index, frame in enumerate(clip_samples())
        if position is None or abs(index / 24 - position) <= 1.05
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--seconds", type=int, default=600)
    parser.add_argument("--pass-number", type=int, default=1)
    parser.add_argument(
        "--visual",
        action="store_true",
        help="Use screenshots in a separate, untimed pass",
    )
    parser.add_argument(
        "--over-video",
        action="store_true",
        help="Place Solid controls and a native caption over the video",
    )
    args = parser.parse_args()
    if (
        not re.fullmatch(r"[A-Za-z0-9_.]+", args.package)
        or args.seconds < 60
        or args.seconds % 60
        or args.pass_number < 1
    ):
        parser.error("Provide an application ID and a duration in whole minutes")
    args.out.mkdir(parents=True, exist_ok=False)
    app = args.package
    device = ["adb", "-s", args.serial]

    def adb(*command, text=True, check=True, **kwargs):
        return subprocess.run(
            device + list(command),
            text=text,
            check=check,
            capture_output=True,
            timeout=45,
            **kwargs,
        ).stdout

    def shell(*command):
        return adb("shell", *command).strip()

    def private(*command, check=True):
        return adb("shell", "run-as", app, *command, check=check).strip()

    def launch():
        return shell("am", "start", "-W", "-n", app + "/com.tns.NativeScriptActivity")

    def wake():
        # Some TV firmwares drop the first WAKEUP or re-sleep while the panel
        # is still coming up. Keep sending it until PowerManager agrees.
        for _ in range(25):
            shell("input", "keyevent", "224")
            shell("wm", "dismiss-keyguard")
            if "mWakefulness=Awake" in shell("dumpsys", "power"):
                return
            time.sleep(0.2)
        raise RuntimeError("The test display did not wake")

    def input_focused():
        dump = shell("dumpsys", "input")
        windows = re.search(
            r"(?m)^\s*FocusedWindows:\s*\n((?:[ \t]+displayId=[^\n]+\n?)+)", dump
        )
        return bool(
            windows
            and any(
                line.strip().startswith("displayId=0,") and (" " + app + "/") in line
                for line in windows.group(1).splitlines()
            )
        )

    def wait_input_window():
        # Activity resume and InputDispatcher's focused window are distinct events.
        # A remote press belongs to this test only after the app owns the display input.
        start = time.monotonic()
        while time.monotonic() - start < 8:
            if input_focused():
                return round((time.monotonic() - start) * 1000)
            time.sleep(0.08)
        raise RuntimeError("The probe did not regain input focus on the test display")

    def journal():
        try:
            return json.loads(private("cat", "files/mixed-events.json", check=False))
        except ValueError:
            return []

    cursor = 0

    def wait_event(name):
        nonlocal cursor
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            entries = journal()
            while cursor < len(entries):
                entry = entries[cursor]
                cursor += 1
                if entry["name"] == "error":
                    raise RuntimeError(entry)
                if entry["name"] == name:
                    return entry
            time.sleep(0.10)
        raise RuntimeError(f"Missing {name}: {entries[-4:]}")

    def press(code):
        # A press goes to whatever window has focus. A system dialog that opens
        # over the app (a Bluetooth pairing prompt did, on the test TV) would
        # take a Select meant for the app as its own confirmation. Stop the
        # pass instead of pressing; the check narrows that window to the time
        # between it and the press, it cannot close it.
        if not input_focused():
            raise RuntimeError(
                "Another window has input focus; no key was sent. "
                "Dismiss it on the device and run the pass again."
            )
        shell("input", "keyevent", str(code))

    def key(code, event):
        press(code)
        return wait_event(event)

    def visual(name, marker=None, video=False, position=None):
        if not args.visual:
            return
        expected = {
            "gallery": (35, 40, (53, 100, 150)),
            "selected": (250, 40, (53, 100, 150)),
            "modal": (590, 325, (37, 56, 79)),
            "playing": (720 if args.over_video else 70, 300, (37, 56, 79)),
        }
        deadline = time.monotonic() + 4
        while True:
            png = adb("exec-out", "screencap", "-p", text=False)
            with Image.open(io.BytesIO(png)) as image:
                im = image.convert("RGB")
            w, h = im.size
            x, y, rgb = expected[marker or name]
            pixel = im.getpixel((int(x * w / 1920), int(y * h / 1080)))
            good = max(abs(a - b) for a, b in zip(pixel, rgb)) <= 6
            if (marker or name) == "modal":
                body = im.crop(
                    (
                        580 * w // 1920,
                        440 * h // 1080,
                        1340 * w // 1920,
                        543 * h // 1080,
                    )
                )
                colors = body.getcolors(body.width * body.height)
                good = good and all(
                    max(abs(a - b) for a, b in zip(c, rgb)) <= 6 for _, c in colors
                )
            if video:
                if args.over_video:
                    native_caption = im.getpixel((1145 * w // 1920, 350 * h // 1080))
                    good = (
                        good
                        and max(
                            abs(a - b) for a, b in zip(native_caption, (20, 103, 90))
                        )
                        <= 6
                    )
                colors = im.crop(
                    (int(0.37 * w), int(0.22 * h), int(0.93 * w), int(0.73 * h))
                ).resize((80, 45))
                error, frame_seconds = compare_video(im, position)
                good = good and error <= 12
            if good or time.monotonic() >= deadline:
                (args.out / (name + ".png")).write_bytes(png)
                if not good:
                    raise RuntimeError(f"Composited pixels failed for {name}: {pixel}")
                if video:
                    report.setdefault("pictureChecks", []).append(
                        {
                            "checkpoint": name,
                            "meanRgbError": round(error, 2),
                            "matchedClipSeconds": frame_seconds,
                            "sampledPositionSeconds": position,
                        }
                    )
                return
            time.sleep(0.15)

    remote = (
        "/data/misc/perfetto-traces/solid-mixed-" + uuid.uuid4().hex + ".perfetto-trace"
    )
    report = {
        "model": shell("getprop", "ro.product.model"),
        "firmware": shell("getprop", "ro.build.fingerprint"),
        "package": app,
        "visual": args.visual,
        "controlsOverVideo": args.over_video,
        "cycles": [],
    }
    apk = next(
        line.removeprefix("package:")
        for line in shell("pm", "path", app).splitlines()
        if line.endswith("/base.apk")
    )
    report["apkSha256"] = shell("sha256sum", shlex.quote(apk)).split()[0]
    report["emulator"] = shell("getprop", "ro.kernel.qemu") == "1"
    refresh = shell("dumpsys", "SurfaceFlinger", "--latency").splitlines()
    report["displayPeriodNs"] = (
        int(refresh[0]) if refresh and refresh[0].isdigit() else None
    )
    recorder_pid = None
    pulled = False

    def checkpoint():
        data = {
            **report,
            "recorderPid": recorder_pid,
            "deviceTrace": remote if recorder_pid else None,
        }
        temp = args.out / "capture-progress.tmp"
        temp.write_text(json.dumps(data, indent=2) + "\n")
        temp.replace(args.out / "capture-progress.json")

    def recording():
        if recorder_pid is None:
            return False
        cmdline = adb("shell", "cat", f"/proc/{recorder_pid}/cmdline", check=False)
        return remote in cmdline.split("\0")

    try:
        wake()
        shell("am", "force-stop", app)
        private("mkdir", "-p", "files")
        private("touch", "files/mixed-lifecycle-test")
        if args.over_video:
            private("touch", "files/mixed-overlay")
        else:
            private("rm", "-f", "files/mixed-overlay")
        private("rm", "-f", "files/workload-ready", "files/mixed-events.json")
        report["activityLaunch"] = launch()
        pid = shell("pidof", app)
        deadline = time.monotonic() + 100
        while private("cat", "files/workload-ready", check=False) != "gallery":
            if time.monotonic() >= deadline:
                raise RuntimeError("Gallery did not finish its artwork preflight")
            time.sleep(0.4)
        inventory = json.loads(private("cat", "files/inventory.json"))
        if len(inventory) != 64 or not all(
            x["foreground"] and x["visible"] == x["loaded"] and x["loaded"] > 0
            for x in inventory
        ):
            raise RuntimeError("Visible artwork preflight failed")
        visual("gallery")
        report["initialInputWindowWaitMs"] = wait_input_window()
        if not args.visual:
            config = f'''buffers {{ size_kb: 32768 fill_policy: RING_BUFFER }}
data_sources {{ config {{ name: "android.surfaceflinger.frametimeline" }} }}
data_sources {{ config {{ name: "linux.ftrace" ftrace_config {{ atrace_apps: "{app}" atrace_categories: "view" }} }} }}
duration_ms: {args.seconds * 1000}
write_into_file: true
file_write_period_ms: 2000
'''
            recorder_pid = int(
                adb(
                    "shell",
                    "perfetto",
                    "--background-wait",
                    "--txt",
                    "-c",
                    "-",
                    "-o",
                    remote,
                    input=config,
                ).strip()
            )
        started = time.monotonic()
        checkpoint()
        cycles = 1 if args.visual else args.seconds // 60
        for cycle in range(cycles):
            if not args.visual:
                # One complete 32-second gallery loop in both densities before each interaction.
                time.sleep(max(0, started + 60 * cycle + 33 - time.monotonic()))
            key(22, "detail-focus")
            visual("selected")
            key(23, "modal")
            visual("modal")
            opened = key(23, "play")
            if opened["duration"] < 7 or not opened["audio"]:
                raise RuntimeError(
                    f"Media3 did not select the clip and audio track: {opened}"
                )
            time.sleep(1.6)
            visual("playing", video=True)
            paused = key(23, "pause")
            if paused["position"] <= 0 or paused.get("rendered", 0) <= 0:
                raise RuntimeError(f"Video did not advance: {paused}")
            key(22, "seek")
            key(23, "play")
            time.sleep(1.3)
            # Suspend the app's lifecycle without destroying the Activity
            # window or depending on display power policy. This invokes the
            # same handlers as the platform's suspend/resume events; HOME +
            # am start measured an activity restart instead, whose first
            # buffer is created by WindowManager.
            activity = app + "/com.tns.NativeScriptActivity"
            shell(
                "am",
                "start",
                "-n",
                activity,
                "--es",
                "solid-lifecycle",
                "suspend",
            )
            wait_event("suspend")
            suspended = wait_event("pause")
            if suspended["position"] < 2:
                raise RuntimeError(f"Seek or background pause failed: {suspended}")
            time.sleep(0.65)
            shell(
                "am",
                "start",
                "-n",
                activity,
                "--es",
                "solid-lifecycle",
                "resume",
            )
            wait_event("resume")
            window_wait = wait_input_window()
            if shell("pidof", app) != pid:
                raise RuntimeError("Activity process restarted on resume")
            visual(
                "resumed-paused", "playing", video=True, position=suspended["position"]
            )
            key(23, "play")
            time.sleep(0.8)
            press(4)
            exited = wait_event("player-exit")
            wait_event("modal-return")
            visual("returned-modal", "modal")
            key(4, "gallery-return")
            key(21, "gallery-focus")
            visual("returned-gallery", "gallery")
            report["cycles"].append(
                {
                    "number": cycle + 1,
                    "resumeInputWindowWaitMs": window_wait,
                    "opened": opened,
                    "paused": paused,
                    "suspended": suspended,
                    "exit": exited,
                }
            )
            if not args.visual and time.monotonic() - started > (cycle + 1) * 60:
                raise RuntimeError("Interaction overran the scheduled cycle")
            checkpoint()
        if not args.visual:
            time.sleep(max(0, started + args.seconds + 2 - time.monotonic()))
            deadline = time.monotonic() + 15
            while recording() and time.monotonic() < deadline:
                time.sleep(0.25)
            if recording():
                raise RuntimeError(
                    "The device recorder exceeded its configured duration"
                )
            trace = args.out / f"pass-{args.pass_number}.perfetto-trace"
            adb("pull", remote, str(trace))
            pulled = True
            meta = {key: report[key] for key in ("model", "firmware", "package")}
            meta.update(
                {
                    "pass": args.pass_number,
                    "seconds": args.seconds,
                    "scope": "gallery-focus-modal-video-resume",
                    "sha256": hashlib.sha256(trace.read_bytes()).hexdigest(),
                }
            )
            (args.out / f"pass-{args.pass_number}.json").write_text(
                json.dumps(meta, indent=2) + "\n"
            )
        report["events"] = journal()
        report["completed"] = True
    except Exception as error:
        report["failure"] = str(error).replace(args.serial, "<test device>")
        raise
    finally:
        if recorder_pid is not None:
            if recording():
                adb("shell", "kill", "-TERM", str(recorder_pid), check=False)
                deadline = time.monotonic() + 8
                while recording() and time.monotonic() < deadline:
                    time.sleep(0.25)
            if not pulled and not recording():
                try:
                    adb("pull", remote, str(args.out / "interrupted.perfetto-trace"))
                    pulled = True
                except subprocess.CalledProcessError:
                    pass
            if pulled and not recording():
                adb("shell", "rm", remote, check=False)
        report["events"] = journal()
        adb("shell", "am", "force-stop", app, check=False)
        private("rm", "-f", "files/mixed-overlay", check=False)
        (args.out / "interaction.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Completed {len(report['cycles'])} full interaction cycles")


if __name__ == "__main__":
    main()
