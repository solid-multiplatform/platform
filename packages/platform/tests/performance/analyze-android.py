"""Export only the fixture layer's presentation timings. This lane can rule out a release."""

import argparse
import csv
import gzip
import hashlib
import io
import itertools
import json
import pathlib
import re
import subprocess

from frame_timeline import (
    as_csv,
    is_flagged,
    layer_query,
    present_unknown,
    scene_surface_layer,
    split_layers,
    surface_cadence,
    surface_latches_query,
)

p = argparse.ArgumentParser()
p.add_argument("trace_directory", type=pathlib.Path)
p.add_argument("--processor", required=True)
p.add_argument("--out", type=pathlib.Path, required=True)
args = p.parse_args()
args.out.mkdir(exist_ok=True, parents=True)
reports = []
for meta in sorted(args.trace_directory.glob("pass-*.json")):
    record = json.loads(meta.read_text())
    trace = meta.with_suffix(".perfetto-trace")
    if hashlib.sha256(trace.read_bytes()).hexdigest() != record["sha256"]:
        raise ValueError("Trace hash mismatch")
    app = record["package"]
    if not re.fullmatch(r"[A-Za-z0-9_.]+", app):
        raise ValueError("Invalid package id")
    output = subprocess.check_output(
        [
            args.processor,
            "query",
            "--no-agent",
            "--format",
            "csv",
            str(trace),
            layer_query(app),
        ],
        text=True,
        stderr=subprocess.DEVNULL,
    )
    reader = csv.DictReader(io.StringIO(output))
    rows, other, reconciliation = split_layers(list(reader), app)
    # The scene's SurfaceView has no FrameTimeline rows; its buffer latches are
    # SurfaceFlinger counter pulses. The gallery lane has no player, so this
    # layer is the only SurfaceView in the trace.
    surface_output = subprocess.check_output(
        [
            args.processor,
            "query",
            "--no-agent",
            "--format",
            "csv",
            str(trace),
            surface_latches_query(app),
        ],
        text=True,
        stderr=subprocess.DEVNULL,
    )
    surface_rows = list(csv.DictReader(io.StringIO(surface_output)))
    surface_layer, surface_times = None, []
    try:
        surface_layer, surface_times = scene_surface_layer(surface_rows)
    except ValueError:
        pass
    surface_cad = surface_cadence(surface_times)
    counts = {}
    for row in rows:
        key = row["present_type"] + " / " + row["jank_type"]
        counts[key] = counts.get(key, 0) + 1
    misses = sum(map(is_flagged, rows))
    span = (int(rows[-1]["ts"]) - int(rows[0]["ts"])) / 1e9 if rows else 0
    # This fixture rests for 200 ms after each 300 ms movement. Isolate short
    # double-refresh intervals from those intentional pauses at 60 Hz.
    presents = sorted(
        {
            int(r["display_present_ns"])
            for r in rows
            if r["display_present_ns"].isdigit()
            and r["present_type"] != "Dropped Frame"
        }
    )
    intervals = [(b - a) / 1e6 for a, b in itertools.pairwise(presents)]
    cadence = {
        "matchedDisplayFrames": len(presents),
        "intervals25To100ms": sum(25 <= v < 100 for v in intervals),
    }
    for suffix, data in [("frames", rows), ("other-layers", other)]:
        with gzip.GzipFile(
            str(args.out / (meta.stem + "-" + suffix + ".csv.gz")), "wb", mtime=0
        ) as f:
            f.write(as_csv(data, reader.fieldnames))
    reports.append(
        {
            **record,
            "frameAccountingVersion": 2,
            "layerReconciliation": reconciliation,
            "appFrames": len(rows),
            "sampleSpanSeconds": round(span, 2),
            "misses": misses,
            # Not in misses, and not known to be on time: Android had no
            # display present time for these frames.
            "framesWithUnknownPresent": sum(map(present_unknown, rows)),
            "presentation": counts,
            "cadence60Hz": cadence,
            "surfaceViewLayer": surface_layer,
            "surfaceFrames": len(surface_times),
            "surfaceCadence": surface_cad,
        }
    )
reason = "Full scenario coverage and active-frame expectation evidence required"
if not reports or any(
    not (r["appFrames"] or r["surfaceFrames"])
    or not (
        r["cadence60Hz"]["matchedDisplayFrames"] or r["surfaceCadence"]["frames"]
    )
    for r in reports
):
    reason = "Missing application or display frame timing"
elif any(r["misses"] for r in reports):
    reason = "Missed presentation deadlines"
elif any(r["surfaceCadence"]["framesLost"] for r in reports):
    reason = "Frames lost between the SurfaceView and the display during motion"
elif any(r["framesWithUnknownPresent"] for r in reports):
    reason = "Frames without a display present time cannot be called on time"
elif any(r["cadence60Hz"]["intervals25To100ms"] for r in reports):
    reason = "Short multi-refresh gaps in the 60 Hz gallery workload"
summary = {"status": "preview", "reason": reason, "passes": reports}
(args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps([(r["pass"], r["appFrames"], r["misses"]) for r in reports]))
