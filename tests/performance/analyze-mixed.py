"""Correlate a mixed TV probe's app-layer frames, action markers and codec counters."""

import argparse
import bisect
import collections
import csv
import gzip
import hashlib
import io
import itertools
import json
import pathlib
import re
import subprocess

from frame_timeline import as_csv, is_flagged, layer_query, split_layers


def analyze(directory, processor):
    [meta_path] = directory.glob("pass-*.json")
    meta = json.loads(meta_path.read_text())
    run = json.loads((directory / "interaction.json").read_text())
    trace = meta_path.with_suffix(".perfetto-trace")
    if (
        not run.get("completed")
        or run["visual"]
        or not re.fullmatch(r"[A-Za-z0-9_.]+", meta["package"])
    ):
        raise ValueError(f"Incomplete timed interaction pass: {directory}")
    with trace.open("rb") as data:
        if hashlib.file_digest(data, "sha256").hexdigest() != meta["sha256"]:
            raise ValueError("Trace digest mismatch")

    def query(sql):
        result = subprocess.run(
            [processor, "query", "--no-agent", "--format", "csv", str(trace), sql],
            capture_output=True,
            check=True,
            text=True,
        )
        return list(csv.DictReader(io.StringIO(result.stdout)))

    [span] = query("SELECT (end_ts-start_ts)/1e9 AS seconds FROM trace_bounds")
    if abs(float(span["seconds"]) - meta["seconds"]) > 2:
        raise ValueError("Trace duration differs from the declared duration")
    marks = query(
        "SELECT ts, substr(name,12) AS event FROM slice WHERE name GLOB 'SolidMixed.*' ORDER BY ts"
    )
    sequence = [r["event"] for r in marks]
    expected = [
        "detail-focus",
        "modal",
        "player-focus",
        "play",
        "pause",
        "seek",
        "play",
        "suspend",
        "pause",
        "resume",
        "play",
        "player-exit",
        "modal-return",
        "gallery-return",
        "gallery-focus",
    ]
    if sequence != expected * len(run["cycles"]) or not run["cycles"]:
        raise ValueError(f"Missing or unexpected interaction markers: {sequence}")
    layers = query(layer_query(meta["package"]))
    frames, other_layers, reconciliation = split_layers(layers, meta["package"])
    # Assign by app-frame start. Never count an intentional transition or a media frame at
    # its source cadence as a 60 Hz scrolling gap.
    mode = "gallery"
    edges = []
    phases = ["gallery"]
    for row in marks:
        event = row["event"]
        next_mode = {
            "modal": "modal",
            "player-focus": "player",
            "play": "player",
            "suspend": "suspended",
            "resume": "resuming",
            "modal-return": "modal",
            "gallery-return": "gallery",
        }.get(event, mode)
        if event == "pause" and mode != "suspended":
            next_mode = "paused"
        if next_mode != mode:
            edges.append(int(row["ts"]))
            phases.append(next_mode)
            mode = next_mode

    # The first app buffer after an Activity is made visible again is produced
    # by Android's own relayoutWindow(vis=true) traversal. It is a window-system
    # transition, like the intentional gallery gaps excluded below, not a frame
    # the application can schedule. Report it separately with a bounded
    # presentation latency instead of silently dropping it.
    resume_edges = [int(row["ts"]) for row in marks if row["event"] == "resume"]
    transition_frames = []
    claimed = set()
    for resume_ts in resume_edges:
        first = next(
            (r for r in frames if int(r["ts"]) >= resume_ts and id(r) not in claimed),
            None,
        )
        if first is not None:
            claimed.add(id(first))
            transition_frames.append(first)
    transition_ids = {id(r) for r in transition_frames}

    per_phase = {}
    gallery_gaps = 0
    missing_display = 0
    gallery_presents = collections.defaultdict(set)
    for row in layers:
        segment = bisect.bisect_right(edges, int(row["ts"]))
        row["phase"] = phases[segment]
    for row in frames:
        mode = row["phase"]
        counts = per_phase.setdefault(mode, collections.Counter())
        counts["frames"] += 1
        counts["lateOrDropped"] += int(is_flagged(row))
        if not row["display_present_ns"].isdigit():
            missing_display += 1
        elif mode == "gallery" and row["present_type"] != "Dropped Frame":
            segment = bisect.bisect_right(edges, int(row["ts"]))
            gallery_presents[segment].add(int(row["display_present_ns"]))
    for presents in gallery_presents.values():
        times = sorted(presents)
        gallery_gaps += sum(
            25_000_000 <= b - a < 100_000_000 for a, b in itertools.pairwise(times)
        )
    if not frames or not per_phase.get("gallery") or not per_phase.get("player"):
        raise ValueError("Missing gallery or playback window frames")
    prefix = "pass-" + str(meta["pass"])
    counts = [c["exit"] for c in run["cycles"]]
    return {
        "pass": meta["pass"],
        "device": run["model"],
        "firmware": run["firmware"],
        "emulator": run.get("emulator"),
        "apkSha256": run.get("apkSha256"),
        "traceSha256": meta["sha256"],
        "controllerRecovery": run.get("controllerRecovery"),
        "seconds": round(float(span["seconds"]), 3),
        "displayPeriodNs": run.get("displayPeriodNs"),
        "cycles": len(counts),
        "frameAccountingVersion": 2,
        "layerReconciliation": reconciliation,
        "windowFrames": len(frames),
        "windowLateOrDropped": sum(x["lateOrDropped"] for x in per_phase.values()),
        "windowLateOrDroppedExcludingResumeTransition": sum(
            int(is_flagged(row))
            for row in frames
            if id(row) not in transition_ids
        ),
        "resumeTransition": {
            "policy": "first app window buffer at/after each resume marker; "
            "reported separately, not counted in the zero-miss gate",
            "frames": len(transition_frames),
            "flagged": sum(int(is_flagged(r)) for r in transition_frames),
            "presentLatencyMs": [
                round((int(r["display_present_ns"]) - int(r["ts"])) / 1e6, 1)
                for r in transition_frames
                if r["display_present_ns"].isdigit()
            ],
        },
        "windowFramesWithoutDisplayMatch": missing_display,
        "windowFramesByPhase": per_phase,
        "galleryIntervals25To100ms": gallery_gaps,
        "videoRendered": sum(x["rendered"] for x in counts),
        "videoDropped": sum(x["dropped"] for x in counts),
        "videoSkipped": sum(x["skipped"] for x in counts),
    }, {
        prefix + "-window.csv.gz": gzip.compress(
            as_csv(frames, frames[0].keys()), mtime=0
        ),
        prefix + "-other-layers.csv.gz": gzip.compress(
            as_csv(other_layers, frames[0].keys()), mtime=0
        ),
        prefix + "-events.json": (json.dumps(run["events"], indent=2) + "\n").encode(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=pathlib.Path, nargs="+")
    parser.add_argument("--processor", required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    results = []
    files = {}
    for directory in args.runs:
        report, samples = analyze(directory, args.processor)
        if files.keys() & samples.keys():
            raise ValueError("Duplicate pass number")
        if results and (report["apkSha256"], report["device"], report["firmware"]) != (
            results[0]["apkSha256"],
            results[0]["device"],
            results[0]["firmware"],
        ):
            raise ValueError("Device, firmware or APK changed between passes")
        results.append(report)
        files.update(samples)
    args.out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (args.out / name).write_bytes(data)
    (args.out / "summary.json").write_text(
        json.dumps(sorted(results, key=lambda r: r["pass"]), indent=2) + "\n"
    )
    for r in results:
        print(
            r["pass"],
            r["seconds"],
            r["cycles"],
            "cycles,",
            r["windowLateOrDropped"],
            "late/dropped window frames,",
            r["videoDropped"],
            "dropped video buffers",
        )


if __name__ == "__main__":
    main()
