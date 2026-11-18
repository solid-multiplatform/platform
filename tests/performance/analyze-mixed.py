"""Correlate a mixed TV probe's app-layer frames, action markers and codec counters."""

import argparse
import bisect
import collections
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess


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
    frames = query(f"""SELECT a.ts, a.dur, a.surface_frame_token, a.display_frame_token,
                            a.present_type, a.jank_type, d.ts + d.dur AS display_present_ns
                        FROM actual_frame_timeline_slice a
                        LEFT JOIN actual_frame_timeline_slice d
                          ON d.display_frame_token=a.display_frame_token AND d.layer_name IS NULL
                          AND (d.surface_frame_token IS NULL OR d.surface_frame_token=0) AND d.dur>=0
                        WHERE instr(a.layer_name,'{meta["package"]}/')>0 ORDER BY a.ts""")
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

    per_phase = {}
    gallery_gaps = 0
    missing_display = 0
    last = {}
    for row in frames:
        segment = bisect.bisect_right(edges, int(row["ts"]))
        mode = phases[segment]
        counts = per_phase.setdefault(mode, collections.Counter())
        counts["frames"] += 1
        counts["lateOrDropped"] += int(
            row["present_type"] in ("Late Present", "Dropped Frame")
            or "Deadline Missed" in row["jank_type"]
        )
        row["phase"] = mode
        if not row["display_present_ns"].isdigit():
            missing_display += 1
            continue
        when = int(row["display_present_ns"])
        if (
            mode == "gallery"
            and segment in last
            and 25_000_000 <= when - last[segment] < 100_000_000
        ):
            gallery_gaps += 1
        last[segment] = when
    if not frames or not per_phase.get("gallery") or not per_phase.get("player"):
        raise ValueError("Missing gallery or playback window frames")
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=frames[0].keys())
    writer.writeheader()
    writer.writerows(frames)
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
        "windowFrames": len(frames),
        "windowLateOrDropped": sum(x["lateOrDropped"] for x in per_phase.values()),
        "windowFramesWithoutDisplayMatch": missing_display,
        "windowFramesByPhase": per_phase,
        "galleryIntervals25To100ms": gallery_gaps,
        "videoRendered": sum(x["rendered"] for x in counts),
        "videoDropped": sum(x["dropped"] for x in counts),
        "videoSkipped": sum(x["skipped"] for x in counts),
    }, {
        prefix + "-window.csv.gz": gzip.compress(output.getvalue().encode(), mtime=0),
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
