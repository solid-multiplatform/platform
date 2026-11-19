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

Roku OS 16's firmware records real frame timing. A Perfetto trace contains the `render` and `swapBuffers` slices on `RenderThr:Main`; `render + swapBuffers` inside 16.67 ms is the frame budget. The SDK documents the slices and the `rk perfetto enable` / `rk perfetto start` workflow; the endpoints are ECP (`POST /perfetto/enable/<channel>` and a WebSocket at `/perfetto-session`). That is the only source of render-thread, compositor and GPU timing. The trace is protobuf and needs Perfetto tooling (the UI or `trace_processor`) to read.

The repository's harness measures a **proxy** on the device, because it runs through the existing sideload/console runners and reads text, not binary traces:

- `packages/platform/tests/performance/run-pacing.mjs` builds `tests/roku-device/pacing-app.tsx`, sideloads it, relaunches it with `contentId=pacing&case=<case>&seconds=<n>`, reads the `PACING` lines from the console, and restores the app that was on screen.
- The app runs one fixed workload for the duration: a scrolling rail of 24 poster cards with text (`steady`); that plus a 30-node native `alpha` batch (`animation`); or that plus one deliberate 1000 ms JavaScript block at 10 s (`block`).
- The measured series is a deadline-corrected 60 Hz `setTimeout` callback with `performance.now()` timestamps on the JavaScript thread; the renderer's `idle` event is timestamped too. It is a proxy: it measures whether the JavaScript thread serviced its 60 Hz cadence, not what the SceneGraph render thread presented.

```sh
cd packages/platform
node tests/performance/run-pacing.mjs --case steady --seconds 60 --out <dir>
node tests/performance/run-pacing.mjs --case animation --seconds 60 --out <dir>
node tests/performance/run-pacing.mjs --case block --seconds 60 --out <dir>
node --test tests/performance/test_roku_pacing.mjs
```

The analyser counts intervals over the 16.67 ms period plus 1 ms tolerance, reports p50/p95/p99/worst and a missed-frame estimate, and excludes the deliberate block from a second set of statistics. `--max-over-budget N` makes the runner exit non-zero; without it a completed measurement exits 0. The analyser's unit test runs on synthetic samples and needs no device.

### What the proxy measured

Measured on 2026-11-19 on a 1080p Roku TV running OS 16.0.4, 60 s per case. Results are in `handoff/roku-pacing/`; they contain no device address or serial.

| case      | frames | p50   | p95   | p99   | worst   | over 17.67 ms     | missed est. |
| --------- | ------ | ----- | ----- | ----- | ------- | ----------------- | ----------- |
| steady    | 3592   | 16.92 | 17.82 | 17.96 | 36.78   | 243/3591 (6.77%)  | 3           |
| animation | 3588   | 16.76 | 17.77 | 22.52 | 77.20   | 485/3587 (13.52%) | 6           |
| block     | 3530   | 16.63 | 18.35 | 27.98 | 1018.26 | 425/3529 (12.04%) | 130         |

For the block case, excluding the 1000.26 ms block itself: 3528 intervals, p95 18.25 ms, worst 38.49 ms, 424 over budget, missed estimate 70. The block adds one long interval; the cadence on either side is the same, which is consistent with native SceneGraph animation continuing on the render thread while the JavaScript thread is held.

These numbers are not a pass. The strict rule is zero intervals over budget, and none of the three passes meets it under the 1 ms tolerance. Most over-budget intervals are 17.7–18.5 ms — the JavaScript timer's own granularity and drift, not a display measurement. The missed-frame estimate (3, 6, 130) counts whole refresh periods implied by interval lengths; the block's estimate is dominated by its own 1000 ms gap and must not be read as 130 dropped displayed frames.

### What remains unmeasured

- GPU and compositor timing; `render + swapBuffers` on `RenderThr:Main`.
- Whether a JavaScript-thread gap coincides with a missed display frame.
- True presented-frame cadence, and 4K or other display modes.
- The proxy cannot certify the zero-missed-frames gate. A Perfetto trace can: enable tracing before launch, record during the same workload, and measure the slices per the SDK's perfetto-profiling guide.

The Roku host, shapes, text, conformance and motion runs were recorded on a physical TV on 2026-11-18; the evidence is under `handoff/roku-device/`. `x`, `y` and `alpha` animate on the SceneGraph render thread through `Animation` + `FloatFieldInterpolator`, and the motion harness passed 9/9 with no JavaScript timer armed while animating or after settling. Colour, `scale`, delay, loop and unknown easing still fall back to the JavaScript clock. Frame pacing during animation is now measured only by the proxy above.

## Device data and secrets

Device credentials live in a `.env` outside the repository. Do not commit device serials, addresses or full system traces.
