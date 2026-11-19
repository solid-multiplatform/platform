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

from frame_timeline import (
    LAYER_FIELDS,
    as_csv,
    is_flagged,
    layer_query,
    present_unknown,
    scene_surface_layer,
    split_layers,
    surface_cadence,
    surface_latches_query,
    surface_swaps_query,
)


def pct(values, q):
    if not values:
        return None
    values = sorted(values)
    return round(values[min(len(values) - 1, int(round(q * (len(values) - 1))))], 2)


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

    [span] = query(
        "SELECT start_ts, end_ts, (end_ts-start_ts)/1e9 AS seconds FROM trace_bounds"
    )
    t0, t1 = int(span["start_ts"]), int(span["end_ts"])
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

    # A SurfaceView scene has no FrameTimeline rows: count its buffer latches
    # from SurfaceFlinger and take gaps of two refreshes inside a move as lost
    # frames. The player also uses a SurfaceView, so pick the scene's layer by
    # where it latched, not by its name.
    surface_rows = query(surface_latches_query(meta["package"]))

    def in_gallery(ts):
        return phases[bisect.bisect_right(edges, ts)] == "gallery"

    surface_layer, surface_times = None, []
    try:
        surface_layer, surface_times = scene_surface_layer(surface_rows, in_gallery)
    except ValueError:
        # A texture-view build, or a trace recorded before the gfx source was
        # enabled, has no SurfaceView layer to count. Window frames still do.
        pass
    surface_by_phase = collections.Counter(
        phases[bisect.bisect_right(edges, ts)] for ts in surface_times
    )
    surface_cad = surface_cadence([ts for ts in surface_times if in_gallery(ts)])
    swap_times = [int(r["ts"]) for r in query(surface_swaps_query())]
    swaps_by_phase = collections.Counter(
        phases[bisect.bisect_right(edges, ts)] for ts in swap_times
    )
    # Every rendered buffer should become a SurfaceFlinger latch. Fewer latches
    # than swaps means rendered frames were lost; equal counts with a long
    # latch interval means SurfaceFlinger took a buffer late.
    gallery_swaps = sum(1 for ts in swap_times if in_gallery(ts))
    rendered_lost = max(0, gallery_swaps - surface_cad["frames"])

    # The scene's frame cost with a SurfaceView is not in FrameTimeline:
    # report the GL thread's swap time, which is one per rendered buffer.
    gl_ms = [
        int(r["dur"]) / 1e6
        for r in query(
            """SELECT s.dur FROM slice s JOIN thread_track tt ON s.track_id=tt.id
               WHERE tt.utid = (
                   SELECT t.utid FROM slice s
                   JOIN thread_track tt ON s.track_id=tt.id JOIN thread t USING(utid)
                   WHERE s.name='eglSwapBuffers'
                   GROUP BY t.utid ORDER BY count(*) DESC LIMIT 1)
                 AND s.name='eglSwapBuffers' AND s.dur>=0"""
        )
    ]

    # Phases with nothing to animate. A few frames draw each transition;
    # anything after a 300 ms settle is the idle cost.
    spans = [
        (edges[i - 1] if i else t0, edges[i] if i < len(edges) else t1, name)
        for i, name in enumerate(phases)
    ]
    idle = {}
    for name in ("suspended", "paused", "modal"):
        windows = [
            (a + 300_000_000, b)
            for a, b, phase_name in spans
            if phase_name == name and b > a + 300_000_000
        ]
        idle[name] = {
            "segments": len(windows),
            "secondsAfterSettle": round(sum(b - a for a, b in windows) / 1e9, 2),
            "surfaceFrames": sum(
                any(a <= ts < b for a, b in windows) for ts in surface_times
            ),
        }

    if not per_phase.get("gallery") and not surface_cad["frames"]:
        raise ValueError("Missing gallery frames")
    if not per_phase.get("player") and not surface_by_phase.get("player"):
        raise ValueError("Missing playback frames")
    prefix = "pass-" + str(meta["pass"])
    window_fields = (
        (frames or other_layers or layers)[0].keys()
        if (frames or other_layers or layers)
        else LAYER_FIELDS
    )
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
        # Frames Android could not time on the display. They are not in
        # windowLateOrDropped, and they are not known to be on time either.
        "windowFramesWithUnknownPresent": sum(map(present_unknown, frames)),
        "windowPresentation": dict(
            collections.Counter(
                r["present_type"] + " / " + r["jank_type"] for r in frames
            )
        ),
        "windowFramesByPhase": per_phase,
        "surfaceViewLayer": surface_layer,
        "surfaceFrames": len(surface_times),
        "surfaceFramesByPhase": dict(surface_by_phase),
        "surfaceCadence": surface_cad,
        "surfaceFramesLostDuringMotion": surface_cad["framesLost"],
        "surfaceSwapsByPhase": dict(swaps_by_phase),
        "surfaceRenderedFramesLost": {
            "gallery": rendered_lost,
            "total": max(0, len(swap_times) - len(surface_times)),
        },
        "appGlFrameMs": {
            "meaning": "eglSwapBuffers on the app GL thread: one slice per "
            "rendered buffer, the per-frame render cost with a SurfaceView "
            "(FrameTimeline has no app-frame duration for that layer).",
            "count": len(gl_ms),
            "p50": pct(gl_ms, 0.50),
            "p99": pct(gl_ms, 0.99),
            "max": pct(gl_ms, 1),
        },
        "idlePhasesAfterSettle": idle,
        "galleryIntervals25To100ms": gallery_gaps,
        "videoRendered": sum(x["rendered"] for x in counts),
        "videoDropped": sum(x["dropped"] for x in counts),
        "videoSkipped": sum(x["skipped"] for x in counts),
    }, {
        prefix + "-window.csv.gz": gzip.compress(
            as_csv(frames, window_fields), mtime=0
        ),
        prefix + "-other-layers.csv.gz": gzip.compress(
            as_csv(other_layers, window_fields), mtime=0
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
            r["windowFramesWithUnknownPresent"],
            "of",
            r["windowFrames"],
            "with no display present time,",
            r["videoDropped"],
            "dropped video buffers,",
            r["surfaceFramesLostDuringMotion"],
            "of",
            r["surfaceFrames"],
            "surface frames lost during motion,",
            r["surfaceRenderedFramesLost"]["gallery"],
            "rendered frames never latched",
        )


if __name__ == "__main__":
    main()
