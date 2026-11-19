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

Roku OS 16's firmware records real frame timing. A Perfetto trace contains the `render` and `swapBuffers` slices on `RenderThr:Main`; `render + swapBuffers` inside 16.67 ms is the frame budget. The SDK documents the slices and the `rk perfetto enable` / `rk perfetto start` workflow; the endpoints are ECP (`POST /perfetto/enable/<channel>` and a WebSocket at `/perfetto-session`). This is the real source, and the harness measures it by default.

`packages/platform/tests/performance/run-pacing.mjs` builds `tests/roku-device/pacing-app.tsx`, sideloads it, presses Home so the tracing configuration is read by a fresh process, enables tracing, records the `/perfetto-session` WebSocket while the workload runs, and analyses the trace with `trace_processor_shell`. It reads the `PACING` lines on the console alongside and restores the app that was on screen.

- The workload: a scrolling rail of 24 poster cards with text (`steady`); that plus a 30-node native `alpha` batch (`animation`); or that plus one deliberate 1000 ms JavaScript block at 10 s (`block`).
- The real analysis pairs each `render` slice with the following `swapBuffers` slice, reports the sum's p50/p95/p99/worst, counts frames over 16.67 ms and over 17.67 ms (the same 1 ms tolerance the proxy uses), and records the firmware wake slices (`consumeAllTasks`, `observer.callback`). This firmware emits no explicit `idle` slice.
- `--proxy` disables tracing and measures only the JavaScript-thread cadence: a deadline-corrected 60 Hz `setTimeout` with `performance.now()` timestamps, plus the renderer `idle` event. It is kept for comparison, not as the gate.
- The analyser finds `trace_processor_shell` from `--processor`, `$TRACE_PROCESSOR`, `PATH`, or the Perfetto prebuilt cache (`~/.local/share/perfetto/prebuilts`). This environment already had v59.1; the runner never downloads into the repository. Traces are written under `~/.cache/smp-perfetto/traces/`, outside the repository.

```sh
cd packages/platform
node tests/performance/run-pacing.mjs --case steady --seconds 60 --out <dir>
node tests/performance/run-pacing.mjs --case animation --seconds 60 --out <dir>
node tests/performance/run-pacing.mjs --case block --seconds 60 --out <dir>
node tests/performance/run-pacing.mjs --case steady --seconds 60 --proxy --out <dir>
node --test tests/performance/test_roku_pacing.mjs
```

`--max-over-budget N` applies to the Perfetto over-16.67 count when a trace was analysed, and to the proxy's over-budget count otherwise; without it a completed measurement exits 0. The analyser tests run on synthetic series and need no device; the `unit` CI job runs them.

### What the real source measured

Measured on 2026-11-19 on a 1080p Roku TV running OS 16.0.4, 60 s per case, one pass per case. Results and trace paths are in `handoff/roku-pacing/`; they contain no device address or serial.

| case      | frames | p50    | p95    | p99    | worst  | >16.67 ms         | >17.67 ms       | render p95 / worst |
| --------- | ------ | ------ | ------ | ------ | ------ | ----------------- | --------------- | ------------------ |
| steady    | 3583   | 15.347 | 17.416 | 17.613 | 97.642 | 1186/3583 (33.1%) | 28/3583 (0.78%) | 1.23 / 3.52 ms     |
| animation | 3577   | 14.869 | 16.946 | 17.218 | 93.732 | 833/3577 (23.29%) | 7/3577 (0.20%)  | 1.22 / 3.57 ms     |
| block     | 3582   | 14.859 | 16.941 | 17.132 | 79.610 | 902/3582 (25.18%) | 6/3582 (0.17%)  | 1.29 / 6.84 ms     |

All values are milliseconds; `render+swap` is the frame's occupancy. `swapBuffers` pads to the frame boundary on this firmware (p95 15.8–16.3 ms), so the strict >16.67 ms count includes frames sitting on the boundary. The >17.67 ms column is the stable comparison with the proxy. `render` alone is the SceneGraph work: p95 ≈1.2 ms, worst 3.5–6.8 ms. The worst frames (80–98 ms) are at startup/relaunch and the first batch, not in steady state.

**The 1000 ms JavaScript block did not stall the render thread.** The block case's proxy saw a 1015.86 ms gap and 118 missed-frame estimate; the real trace shows p99 17.132 ms, worst 79.610 ms and 6 frames over 17.67 ms — no ~1 s gap. Native SceneGraph animation continued while the JavaScript thread was held.

### What the proxy measured (comparison)

| case      | frames | p50   | p95   | p99   | worst   | over 17.67 ms    | missed est. |
| --------- | ------ | ----- | ----- | ----- | ------- | ---------------- | ----------- |
| steady    | 3589   | 16.21 | 17.90 | 18.21 | 95.07   | 206/3588 (5.74%) | 7           |
| animation | 3586   | 16.22 | 18.20 | 27.19 | 95.17   | 307/3585 (8.56%) | 50          |
| block     | 3524   | 16.24 | 18.19 | 28.22 | 1015.86 | 228/3523 (6.47%) | 118         |

For the block case outside its 1000.37 ms block: 3522 intervals, p95 18.19 ms, worst 94.49 ms, 227 over budget, missed estimate 58. The proxy's over-budget intervals are JavaScript timer granularity and drift; they do not appear as render-thread overruns. The strict zero-over-budget rule is not met by the proxy, and the real trace still has 6–28 frames over 17.67 ms per 60 s pass, so the gate is not proven either; it is much closer than the proxy suggests.

### What remains unmeasured

- GPU execution separately from the flush/swap; the trace gives render + swapBuffers, not a presented-frame vsync event.
- Whether a frame over the boundary was displayed late or padded; `swapBuffers` padding makes the strict 16.67 ms boundary ambiguous.
- 4K and other display modes, and run-to-run variance (one pass per case here).
- Idle-scene wake behaviour: the workload animates continuously and this firmware emits no explicit `idle` slice; `consumeAllTasks`/`observer.callback` counts are recorded but are not an idle test. The conformance suite's idle counter remains the idle gate.

The Roku host, shapes, text, conformance and motion runs were recorded on a physical TV on 2026-11-18; the evidence is under `handoff/roku-device/`. `x`, `y` and `alpha` animate on the SceneGraph render thread through `Animation` + `FloatFieldInterpolator`, and the motion harness passed 9/9 with no JavaScript timer armed while animating or after settling. Colour, `scale`, delay, loop and unknown easing still fall back to the JavaScript clock. Frame pacing during animation is now measured on the render thread by the Perfetto path above.

## Device data and secrets

Device credentials live in a `.env` outside the repository. Do not commit device serials, addresses or full system traces.
