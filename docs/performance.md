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

The procedure is in `packages/platform/tests/performance`. It needs a physical device and `adb`, and it is not run by CI. It uses Android's FrameTimeline through Perfetto and counts only the frames of the app's own layer.

- `make-tv-app.mjs DEST REFERENCE_CHECKOUT [--mixed VIDEO_ARCHIVE] [--surface-view]` builds a probe app. The reference scenes and artwork are not in this repository.
- `check-gallery-pixels.py` compares what the device displays with the source artwork, before any timing is trusted.
- `capture-android.py --serial <serial> --package <id> --out <dir>` records the passes. The defaults are three passes of 600 seconds.
- `analyze-android.py <dir> --processor <trace processor> --out <dir>` exports the per-frame timings and writes `summary.json`.
- `quick-android.py --package <id> --serial <serial>` is a short capture of one interaction cycle, for iterating on a fix. It does not replace the three-pass run.
- `mixed-android.py` and `analyze-mixed.py` do the same for a workload that mixes the gallery, a dialog, video playback, suspend and resume.

`test_frame_timeline.py` tests the trace parser and does run in CI (`unit` job).

Results that were recorded with these scripts are in `docs/beta`, with a [README](/beta/README.md) that says what each directory holds and what the numbers are. Read it before quoting any of them.

### Where the Android TV gate stands

Measured on 2026-11-18 on a physical Android TV at 60 Hz with `main`: **the gate is not met.**

- One complete 10-minute mixed pass: 14,389 window frames, 6 flagged late. All six fall in one 104 ms run where another app's system prompt closed over the test app; the app finished those frames on time.
- Three 5-minute gallery passes: 0 flagged late of about 9,600 frames each. Frame time p50 6.7 ms, p99 10.6 ms, worst 13.9 ms.
- The flagged count understates the problem. In 30 s of scrolling the GL thread swapped 1,141 frames one refresh apart, and the window showed 1,022, with 114 two-refresh intervals. JavaScript and GL were on time (4.5 ms and 2.4 ms median per refresh). The frames are lost between the GL surface and the window; a build with `surface-view` delivered every buffer one refresh apart. The analysers do not count that layer yet.
- The scene is not idle when still: the canvas plugin's native frame callback wakes the main thread 60 times a second while nothing is drawn.
- On that day the display reported no present time for 97–100% of frames, so a zero could not have been confirmed either.

The analysers now report frames with no display present time, and the mixed driver checks input focus before each key.

## Measure on Roku

There is no Roku frame-timing procedure on `main`. What exists:

- `node packages/platform/tests/cli/roku-device-check.mjs` reads a device's state over ECP when `ROKU_DEV_IP` is set. It is read-only.
- `solid-platform certify roku <metrics.json>` checks a metrics file against the budgets in `packages/platform/src/sdk/certification.ts` and exits non-zero if one is exceeded.

The Roku host, shapes, text and conformance runs were recorded on a physical TV on 2026-11-18; the evidence is under `handoff/roku-device/`. Animation still runs on the JavaScript thread, and frame pacing during animation has not been measured.

## Device data and secrets

Device credentials live in a `.env` outside the repository. Do not commit device serials, addresses or full system traces.
