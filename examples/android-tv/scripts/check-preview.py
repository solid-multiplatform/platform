"""Check the native frame returned through Kotlin to the running Solid app."""
import base64
import subprocess
import sys
import time

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/check-preview.py ADB_SERIAL")
adb = ["adb", "-s", sys.argv[1]]
marker = "Native preview RGBA (8x8): "
expected = bytearray()
for y in range(8):
    for x in range(8):
        shade = 32 if (x + y) % 2 == 0 else 224
        expected.extend((shade, shade, shade, 255))
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    pid = subprocess.run(adb + ["shell", "pidof", "dev.solidmultiplatform.fixture"],
                         capture_output=True, text=True, check=False).stdout.strip()
    if pid:
        logs = subprocess.check_output(adb + ["logcat", "-d", "--pid=" + pid], text=True)
        for line in reversed(logs.splitlines()):
            if marker in line:
                frame = base64.b64decode(line.split(marker, 1)[1].strip(), validate=True)
                if frame != expected:
                    raise SystemExit("Native preview returned different pixels")
                print("Verified all 256 native RGBA bytes through Kotlin and TypeScript")
                sys.exit(0)
    time.sleep(0.25)
raise SystemExit("No native preview result from the running fixture")
