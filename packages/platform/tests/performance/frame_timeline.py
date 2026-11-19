"""Read FrameTimeline transactions for the probe without confusing layers with frames."""

import collections
import csv
import io
import re

VSYNC_NS = 16_666_667
# Shorter than this is a frame inside a move; the workload rests between moves.
MOVING_NS = 100_000_000
# The columns layer_query() selects, for a trace where the app has no
# FrameTimeline rows at all (a SurfaceView scene).
LAYER_FIELDS = [
    "ts",
    "dur",
    "surface_frame_token",
    "display_frame_token",
    "layer_name",
    "is_buffer",
    "present_type",
    "jank_type",
    "display_present_ns",
    "display_present_type",
    "display_jank_type",
]


def layer_query(package):
    if not re.fullmatch(r"[A-Za-z0-9_.]+", package):
        raise ValueError("Invalid trace package")
    return f"""
        WITH displays AS (
            SELECT display_frame_token, count(*) AS match_count,
                   max(ts+dur) AS present_ns, max(present_type) AS display_type,
                   max(jank_type) AS display_jank
            FROM actual_frame_timeline_slice
            WHERE layer_name IS NULL AND (surface_frame_token IS NULL OR surface_frame_token=0)
                  AND dur>=0 AND display_frame_token>0
            GROUP BY display_frame_token
        )
        SELECT a.ts, a.dur, a.surface_frame_token, a.display_frame_token, a.layer_name,
               extract_arg(a.arg_set_id, 'Is Buffer?') AS is_buffer,
               a.present_type, a.jank_type,
               CASE WHEN d.match_count=1 THEN d.present_ns END AS display_present_ns,
               CASE WHEN d.match_count=1 THEN d.display_type END AS display_present_type,
               CASE WHEN d.match_count=1 THEN d.display_jank END AS display_jank_type
        FROM actual_frame_timeline_slice a
        LEFT JOIN displays d ON d.display_frame_token=a.display_frame_token
        WHERE instr(' ' || a.layer_name, ' {package}/')>0 OR instr(a.layer_name, '[{package}/')>0
        ORDER BY a.ts, a.id
    """


def is_flagged(row):
    return (
        row["present_type"] in ("Late Present", "Dropped Frame")
        or "Deadline Missed" in row["jank_type"]
    )


def present_unknown(row):
    """Whether Android had no valid present time for this frame's display frame.

    SurfaceFlinger marks such a display frame "Unspecified Present" (jank
    "Display HAL") and stamps it, and the app frames in it, with its own end
    time. Their Early/On-time/Late class then says nothing about when the
    frame reached the screen, so is_flagged() cannot call them on time.
    """
    return row.get("display_present_type") == "Unspecified Present"


def surface_latches_query(package):
    """SQL for the app's SurfaceView buffer latches.

    FrameTimeline records no rows for a SurfaceView: the scene's buffers go
    straight to SurfaceFlinger instead of through the app's window. For each
    buffer transaction SurfaceFlinger pulses a `BufferTX - SurfaceView[
    <package>/...]` counter (1, then 0), so its rising edges are the times the
    layer's frames reached the compositor. Video playback creates a second
    SurfaceView layer in the same app; scene_surface_layer() distinguishes it.
    """
    if not re.fullmatch(r"[A-Za-z0-9_.]+", package):
        raise ValueError("Invalid trace package")
    return f"""
        SELECT t.id AS track_id, t.name AS track_name, c.ts
        FROM counter c JOIN counter_track t ON c.track_id=t.id
        WHERE instr(t.name, 'BufferTX - SurfaceView[') > 0
          AND instr(t.name, '{package}/') > 0
          AND c.value > 0.5
        ORDER BY c.ts
    """


def surface_swaps_query():
    """SQL for the app GL thread's buffer swaps.

    `eglSwapBuffers` runs once per rendered buffer on the thread with the most
    swaps in the trace (the scene's GL thread; system compositors do not call
    it per frame). Comparing this count with the SurfaceView latches says
    whether a rendered frame failed to reach SurfaceFlinger at all, or whether
    SurfaceFlinger merely latched a buffer late.
    """
    return """
        SELECT s.ts
        FROM slice s JOIN thread_track tt ON s.track_id=tt.id
        WHERE tt.utid = (
            SELECT t.utid FROM slice s JOIN thread_track tt ON s.track_id=tt.id
            JOIN thread t USING(utid)
            WHERE s.name='eglSwapBuffers'
            GROUP BY t.utid ORDER BY count(*) DESC LIMIT 1
        ) AND s.name='eglSwapBuffers' AND s.dur>=0
        ORDER BY s.ts
    """


def scene_surface_layer(rows, is_gallery=None):
    """The app's scene SurfaceView, as (track_name, latch timestamps).

    A player's SurfaceView is in the same app, so layer names cannot tell the
    scene from the video. The scene layer is the one that latched most while
    the gallery was on screen; the player's layer only latches in its own
    phase. `is_gallery(ts)` restricts that choice when the trace has phases.
    """
    by_track = collections.defaultdict(list)
    names = {}
    for row in rows:
        by_track[row["track_id"]].append(int(row["ts"]))
        names[row["track_id"]] = row["track_name"]
    if not by_track:
        raise ValueError("No app SurfaceView buffer latches in the trace")

    def score(track_id):
        times = by_track[track_id]
        return (
            sum(bool(is_gallery(int(ts))) for ts in times) if is_gallery else len(times),
            len(times),
        )

    track_id = max(by_track, key=score)
    return names[track_id], sorted(by_track[track_id])


def surface_cadence(times):
    """Frame intervals on a SurfaceView layer, counted in display refreshes.

    Only intervals shorter than 100 ms are inside a move: the workload rests
    between moves and a rest is not a lost frame. A move frame that arrives two
    refreshes after the previous one means one rendered frame never reached the
    display, which is what the gate calls a lost frame.
    """
    times = sorted(times)
    intervals = [b - a for a, b in zip(times, times[1:]) if b - a < MOVING_NS]
    refreshes = [max(1, round(gap / VSYNC_NS)) for gap in intervals]
    histogram = collections.Counter(min(5, n) for n in refreshes)
    return {
        "frames": len(times),
        "motionIntervals": len(intervals),
        "oneRefresh": histogram.get(1, 0),
        "twoRefreshes": histogram.get(2, 0),
        "threeOrMore": sum(v for k, v in histogram.items() if k >= 3),
        "framesLost": sum(n - 1 for n in refreshes if n > 1),
        "longestIntervalMs": round(max(intervals) / 1e6, 2) if intervals else None,
    }


def split_layers(rows, package):
    window = re.compile(
        r"(?:TX - )?"
        + re.escape(package)
        + r"/com\.tns\.NativeScriptActivity(?:#[0-9]+)?"
    )
    buffers, other = [], []
    displays = {}
    for row in rows:
        if row["is_buffer"] not in ("Yes", "No"):
            raise ValueError("Missing FrameTimeline buffer classification")
        is_window = window.fullmatch(row["layer_name"]) is not None
        (buffers if is_window and row["is_buffer"] == "Yes" else other).append(row)
        if row["display_present_ns"].isdigit():
            token = int(row["display_frame_token"])
            displays[token] = displays.get(token, False) or is_flagged(row)
    return (
        buffers,
        other,
        {
            "matchedAppLayerRows": len(rows),
            "flaggedAppLayerRows": sum(map(is_flagged, rows)),
            "nonBufferTransactions": sum(row["is_buffer"] == "No" for row in other),
            "otherLayerBuffers": sum(row["is_buffer"] == "Yes" for row in other),
            "associatedDisplayFrames": len(displays),
            "displayFramesWithFlaggedAppLayers": sum(displays.values()),
        },
    )


def as_csv(rows, fields):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()
