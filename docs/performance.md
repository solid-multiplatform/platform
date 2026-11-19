# Performance

## The rule

TV performance comes first. Two things follow from it:

- **Zero missed frames.** Work that a key press causes must fit in the frame that shows its result.
- **Nothing scheduled while idle.** An idle scene has no timer, no polling, no listener that fires and no animation-frame callback. Feature code is opt-in: if a feature needs a timer or a listener, the app turns it on and it stops when the app disposes it.

This applies to app code, to primitives, to hosts and to backends.

## What enforces it

- The scene conformance suite has the case "an idle scene schedules nothing". It runs for WebGL, Canvas and the Roku backend in the `browser` CI job, with a counter that wraps `requestAnimationFrame` and `setTimeout` (`packages/platform/tests/webgl/conformance-harness.ts`).
- `packages/renderer/tests/canvas-idle-loop.test.mjs` checks the Canvas frame loop one wake source at a time: asleep before the event, exactly one frame after it.
- The service registry constructs nothing at install time (`packages/platform/tests/contract-registry.test.ts`).
- Review. A change that adds a timer, an observer or a subscription must show that it stops when the scene is idle.

These tests run in Chromium and Node. They do not measure a device.

## Write UI that keeps the rule

- Do not poll. Use signals, node events (`loaded`, `inViewport`) and the renderer's `idle` event.
- Put deferrable work in `scheduleTask`. Tasks run only after the renderer reports idle, and the queue pauses when focus moves. See [Task scheduler](/essentials/taskscheduler.md).
- Use [virtual lists](/primitives/virtual.md) for long rows and columns so the node count stays bounded.
- Animate through `transition` or `animate()`. The backend runs the animation and stops asking for frames when it ends.
- Load a service when you first need it. Installing providers costs nothing; the first use constructs the provider.

## Measure in the browser: the bench

`packages/platform/bench` drives scenarios in headless Chromium under CPU throttling and reports time, allocations, profile self time and counts per operation.

```sh
cd packages/platform
node bench/run.mjs --arms C --modes time,count --runs 3 --out <dir>
node bench/run.mjs --scenarios smoke --runs 1 --quick   # check the harness only
```

Arm `C` is your working tree. Arm `A` is a pinned earlier commit, prepared by `bench/prepare-arms.mjs`, to compare against. The method, every option and the meaning of each number are in [Bench methodology](/perf/README.md).

The bench runs on a desktop CPU. It tells you whether a change costs more or less than before. It does not tell you whether a TV misses frames.

## Measure on an Android TV

The procedure is in `packages/platform/tests/performance`. It needs a physical device and `adb`, and it is not run by CI. It uses Android's FrameTimeline through Perfetto for the app's window layer and SurfaceFlinger's per-buffer `BufferTX` counters for the scene's SurfaceView layer, which FrameTimeline does not record.

- `make-tv-app.mjs DEST REFERENCE_CHECKOUT [--mixed VIDEO_ARCHIVE] [--surface-view | --texture-view]` builds a probe app. The scene draws into a SurfaceView; `--texture-view` builds the old TextureView path for comparison. The reference scenes and artwork are not in this repository.
- `check-gallery-pixels.py` compares what the device displays with the source artwork, before any timing is trusted.
- `capture-android.py --serial <serial> --package <id> --out <dir>` records the passes. The defaults are three passes of 600 seconds.
- `analyze-android.py <dir> --processor <trace processor> --out <dir>` exports the per-frame timings and writes `summary.json`.
- `quick-android.py --package <id> --serial <serial>` is a short capture of one interaction cycle, for iterating on a fix. It does not replace the three-pass run.
- `mixed-android.py` and `analyze-mixed.py` do the same for a workload that mixes the gallery, a dialog, video playback, suspend and resume. Both analysers count the SurfaceView layer's latches and treat a two-refresh interval inside a move as a lost frame.

`test_frame_timeline.py` tests the trace parser and does run in CI (`unit` job).

Results that were recorded with these scripts are in `docs/beta`, with a [README](/beta/README.md) that says what each directory holds and what the numbers are. Read it before quoting any of them.

### Where the Android TV gate stands

Measured on 2026-11-19 on a physical Android TV at 60 Hz with the SurfaceView default: **the lost-frame defect is fixed; the strict zero-interval gate is not met.**

- Three complete 10-minute mixed passes: 20,122, 20,026 and 20,017 SurfaceView frames. In every pass the GL thread swapped exactly as many buffers as SurfaceFlinger latched (0 rendered frames never latched). On 2026-11-18 the TextureView path lost 119 of 1,141 rendered frames in 30 s.
- The analysers now count the SurfaceView layer from SurfaceFlinger's `BufferTX` pulses, because FrameTimeline has no rows for it. Under the rule that a two-refresh interval inside a move is a failure, the passes have 6, 6 and 1 such intervals (14, 11 and 2 refreshes missing from the cadence). Each is a late latch of a buffer the GL thread had rendered: the intervals sit at the trace start or within 30 ms of the gallery-return transition. No rendered frame was lost; some were presented late.
- GL frame time (`eglSwapBuffers`, one per rendered buffer): p50 1.06–1.08 ms, p99 4.29–4.65 ms, worst 7.76–9.69 ms.
- The SurfaceView scene has no FrameTimeline app frames, so "late/dropped" and "no display present time" are 0 of 0. The display HAL's missing present times no longer hide app lateness because there is no app window frame to time.
- The scene is still not idle when still: the canvas plugin's native frame callback wakes the main thread 60 times a second while nothing is drawn. That callback is in `libcanvasnative.so`, not in the host. Idle segments produced 0 scene frames.
- What changed: `runAndroidTV` now creates the scene canvas as a SurfaceView by default; `surface: 'texture-view'` selects the old path. The mixed fixture also seeks to 0 when it enters the player, so a delayed Select cannot run into the 8 s clip's end and restart playback instead of pausing.

## Measure on Roku

There is no Roku frame-timing procedure on `main`. What exists:

- `node packages/platform/tests/cli/roku-device-check.mjs` reads a device's state over ECP when `ROKU_DEV_IP` is set. It is read-only.
- `solid-platform certify roku <metrics.json>` checks a metrics file against the budgets in `packages/platform/src/sdk/certification.ts` and exits non-zero if one is exceeded.

The Roku host, shapes, text and conformance runs were recorded on a physical TV on 2026-11-18; the evidence is under `handoff/roku-device/`. Animation still runs on the JavaScript thread, and frame pacing during animation has not been measured.

## Device data and secrets

Device credentials live in a `.env` outside the repository. Do not commit device serials, addresses or full system traces.
