"""Read FrameTimeline transactions for the probe without confusing layers with frames."""

import csv
import io
import re


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
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()
