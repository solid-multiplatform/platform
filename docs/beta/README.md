# Recorded Android TV measurements

This directory holds raw results from one physical Android TV streaming device at 60 Hz. They were recorded with the scripts in `packages/platform/tests/performance`. Nothing here runs in CI, so the [feature matrix](../features.md) does not count it as a test.

No recording in this directory has three ten-minute passes with zero late frames. Every `summary.json` written by `analyze-android.py` reports `"status": "preview"`.

## Gallery workload

The gallery scrolls rows of artwork (`scope: "artwork-and-scroll"`). Each directory is one build of the probe app; the builds themselves are not in the repository.

| Directory             | Seconds per pass | App frames per pass    | Missed deadlines per pass |
| --------------------- | ---------------- | ---------------------- | ------------------------- |
| `diagnostic-stock`    | 96               | 442                    | 442                       |
| `diagnostic-baseline` | 96               | 451                    | 451                       |
| `diagnostic-patched`  | 96               | 2,280                  | 2,004                     |
| `diagnostic-sized`    | 96               | 2,853                  | 7                         |
| `onn-stock`           | 600              | 3,003, 2,983, 2,957    | 3,003, 2,983, 2,957       |
| `onn-corrected`       | 600              | 17,334, 17,902, 18,109 | 59, 52, 47                |
| `onn-visible`         | 600              | 18,016, 17,547, 17,854 | 0, 0, 3                   |

Files:

- `summary.json`: per pass, the device model and firmware build, the duration, the number of app frames, the missed deadlines (`misses`) and the presentation classes Android reported.
- `pass-N-frames.csv.gz`: one row per frame of the probe's own layer, from Android's FrameTimeline. No other process is in the file.
- `geometry.json` (two diagnostic directories): the drawing buffer and view size the probe reported.

## Mixed workload

`onn-mixed/summary.json` has three 600-second passes written by `analyze-mixed.py`. Each pass runs ten cycles of gallery, dialog, Media3 playback, suspend and resume.

| Pass | Window frames | Late or dropped window frames | Dropped video buffers |
| ---- | ------------- | ----------------------------- | --------------------- |
| 1    | 16,221        | 53                            | 6                     |
| 2    | 15,583        | 50                            | 5                     |
| 3    | 15,486        | 56                            | 5                     |

## Artwork checks

- `paint-order/visible-artwork.json`: the 64-step inventory the gallery workload (`tests/performance/tv-workload.tsx`) writes before a timed run. At every step the number of loaded posters equals the number of visible posters.
- `tv-validation/onn-poster-pixels.json`: the result of `check-gallery-pixels.py`, which compares screenshots of the device with the reference artwork. It covers 64 checkpoints and 958 posters; the largest mean absolute RGB error for a poster is 5.03 on a 0 to 255 scale.

## Record your own

Run these from `packages/platform`. The Python scripts print their arguments with `--help`.

1. Build a probe app with `node tests/performance/make-tv-app.mjs DEST REFERENCE_CHECKOUT` and install its APK on the device. `REFERENCE_CHECKOUT` is a checkout that holds the scene descriptions and artwork; they are not in this repository. Add `--mixed VIDEO_ARCHIVE` for the mixed workload.
2. Record with `python tests/performance/capture-android.py --serial <serial> --package <app id> --out <directory>`. The defaults are three passes of 600 seconds.
3. Summarise with `python tests/performance/analyze-android.py <directory> --processor <trace processor> --out <directory>`.
4. For the mixed workload use `mixed-android.py` and `analyze-mixed.py` in the same way.

Keep the device serial, its address and full system traces out of the repository.
