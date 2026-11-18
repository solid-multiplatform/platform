"""Verify the SDK output before emitting a sideloadable channel ZIP."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

output = Path("dist-roku")
channel = output / "pkg-dir"
bundle = output / "bundle"
metadata = json.loads((bundle / "metafile.json").read_text())
modules = {
    name for artifact in metadata["outputs"].values()
    for name, details in artifact["inputs"].items() if details["bytesInOutput"]
}
runtimes = [name for name in modules if name.endswith("/solid-js/dist/solid.js")]
if len(runtimes) != 1:
    raise SystemExit(f"Expected one Solid runtime, found {runtimes}")
forbidden = ("/dom-renderer/domRenderer.js", "/webgl/src/Renderer.js",
             "/webgl/src/core/RendererCore.js", "/canvas/src/main-api/Renderer.js")
if any(name.endswith(forbidden) for name in modules):
    raise SystemExit("A browser renderer entered the Roku bundle")
if not any(name.endswith("/roku/renderer.js") for name in modules):
    raise SystemExit("Missing SceneGraph renderer")
for name in ("manifest", "source/Main.brs", "source/compiled/index.js", "components/BaseAppScene.xml"):
    if not (channel / name).is_file():
        raise SystemExit(f"Missing channel file {name}")
if b"viptv.syek.tech" in (channel / "source/compiled/index.js").read_bytes():
    raise SystemExit("Application endpoint in shared host")
with ZipFile(output / "solid-multiplatform.zip", "w", ZIP_DEFLATED) as archive:
    for file in sorted(channel.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(channel))
print(output / "solid-multiplatform.zip")
