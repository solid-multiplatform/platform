"""Check displayed poster pixels against the private source assets before measuring timing."""
import argparse
import functools
import io
import json
import pathlib
import re
import shlex
import subprocess
import time
import uuid

from PIL import Image, ImageChops, ImageStat


def check_frame(frame, checkpoint, scene, reference):
    """Compare unobscured poster interiors in the physical compositor output."""
    if frame.width * 9 != frame.height * 16:
        raise ValueError(f"Unexpected gallery aspect ratio {frame.size}")
    errors = []
    header = scene["selected"][checkpoint["step"]] == 0
    for node in scene["nodes"]:
        src = node.get("src")
        if node.get("row", -1) < 0 or not src or not src.lower().endswith((".jpg", ".jpeg")):
            continue
        x, y = node["x"], node["y"] + checkpoint["position"]
        w, h = node["w"], node["h"]
        left, right = x + w * .2, x + w * .8
        top, bottom = y + h * .2, y + h * .8
        # Exclude chrome, the hero overlay, clipped tiles and the on-screen benchmark legend.
        if left < 110 or right > 1915 or top < (500 if header else 165) or bottom > 1075:
            continue
        box = (left * frame.width / 1920, top * frame.height / 1080,
               right * frame.width / 1920, bottom * frame.height / 1080)
        actual = frame.resize((12, 12), Image.Resampling.BOX, box=box)
        delta = ImageChops.difference(actual, reference(pathlib.Path(src).name))
        errors.append(sum(ImageStat.Stat(delta).mean) / 3)
    if not errors:
        raise ValueError("No unobscured reference posters in this checkpoint")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=pathlib.Path, help="Private output of make-tv-app.mjs")
    parser.add_argument("--package", required=True, help="Installed isolated gallery probe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.]+", args.package):
        parser.error("Invalid application ID")
    scenes = json.loads((args.project / "src/scenes.json").read_text())
    artwork = args.project / "targets/android-tv/gallery"
    args.out.mkdir(parents=True, exist_ok=True)
    if (args.out / "pixels.json").exists():
        parser.error("A report already exists in the output directory")

    @functools.lru_cache(maxsize=None)
    def reference(name):
        with Image.open(artwork / name) as image:
            box = (image.width * .2, image.height * .2, image.width * .8, image.height * .8)
            return image.convert("RGB").resize((12, 12), Image.Resampling.BOX, box=box)

    def adb(*command, check=True):
        return subprocess.run(["adb", "-s", args.serial, *command], check=check,
                              capture_output=True, timeout=30)

    def private(*command, check=True):
        return adb("shell", "run-as", args.package, *command, check=check)

    def write(name, value):
        private("sh", "-c", shlex.quote(f"printf %s {shlex.quote(value)} > {name}"))

    audit_id = uuid.uuid4().hex
    control = "files/gallery-audit"
    ready = "files/gallery-checkpoint-" + audit_id
    ack = "files/gallery-ack-" + audit_id
    if private("test", "-e", control, check=False).returncode == 0:
        raise RuntimeError("Another gallery pixel audit is active")
    reports = []
    try:
        adb("shell", "am", "force-stop", args.package)
        private("mkdir", "-p", "files")
        write(control, audit_id)
        adb("shell", "am", "start", "-W", "-n", args.package + "/com.tns.NativeScriptActivity")
        for index in range(64):
            deadline = time.monotonic() + (45 if index == 0 else 8)
            while time.monotonic() < deadline:
                try:
                    checkpoint = json.loads(private("cat", ready, check=False).stdout)
                    if (checkpoint["mode"], checkpoint["step"]) == divmod(index, 32):
                        break
                except (ValueError, KeyError):
                    pass
                time.sleep(.08)
            else:
                raise RuntimeError(f"Timed out waiting for gallery checkpoint {index}")
            pixels = adb("exec-out", "screencap", "-p").stdout
            with Image.open(io.BytesIO(pixels)) as image:
                errors = check_frame(image.convert("RGB"), checkpoint, scenes[checkpoint["mode"]], reference)
            maximum = max(errors)
            reports.append({"checkpoint": index, "posters": len(errors), "maxRgbError": round(maximum, 2)})
            # Mean absolute error in 8-bit RGB, sampled on a 12-by-12 grid per poster.
            if maximum > 12 or not checkpoint["foreground"] or checkpoint["loaded"] != checkpoint["visible"]:
                (args.out / "failed-frame.png").write_bytes(pixels)
                raise RuntimeError(f"Displayed artwork mismatch at checkpoint {index}: {reports[-1]}")
            write(ack, str(index))
    finally:
        adb("shell", "am", "force-stop", args.package, check=False)
        private("rm", "-f", control, ready, ack, "files/workload-ready", check=False)
        (args.out / "pixels.json").write_text(json.dumps(reports, indent=2) + "\n")
    print(f"Verified {sum(r['posters'] for r in reports)} poster interiors over {len(reports)} checkpoints")


if __name__ == "__main__":
    main()
