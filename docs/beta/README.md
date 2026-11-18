# 0.2 qualification matrix

The 0.2 archives are an engineering preview. TV promotion requires three ten-minute physical passes at the predeclared display cadence with zero missed presentation deadlines across input, artwork, animation, modals, playback and return from suspension. Capture startup separately. A missing trace, incomplete scenario set or missed deadline leaves the profile in preview.

| Profile                          | Evidence in this checkout                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Browser                          | Chromium WebGL/Canvas regression suite, native DOM editor tests and resize/focus checks                                         |
| Linux desktop                    | SDL3, native GL, text rendering, resize and keyboard invocation on Linux/X11 with Mesa software rendering                       |
| Windows / macOS desktop          | Extracted Windows x64 and macOS arm64 packages launched in CI and rendered the starter labels and focus panel                   |
| Android handset / iOS / Apple TV | Separate host builds, native input/editor and plugin integrations; report device and simulator results separately               |
| Roku OS 16                       | SceneGraph ZIP and native task build. Physical developer slot occupied; existing channel preserved                              |
| Android TV                       | Physical onn. 4K Pro at 60 Hz. Visible gallery recorded 0, 0 and 3 late frames in three ten-minute runs                         |
| Tizen / webOS / Vizio            | Generated WebGL and legacy Canvas apps rendered their title and reacted to remote Enter in Chromium 85. Physical timing pending |

Baseline refs: platform 6140e99b4ae7f0b990f11a53d5c1237439dc085e, renderer 39a7dccb4d9087d11af083affd16d85c33bc6b6d. The benchmark now resolves these exact revisions from Git history and the checked-in package archive. The Chromium CPU smoke measurement is diagnostic and does not measure TV presentation timing.

For the physical Android gallery lane, use `tests/performance/make-tv-app.mjs` with the local solidtv comparison checkout. It consumes the frozen normal/dense scene descriptions and local artwork and does not publish the artwork. Install the resulting isolated probe. Record with `capture-android.py` and export per-layer timing with `analyze-android.py`. The reference's normal and dense modes are commonly called the 79- and 133-image scenes; this replay includes auxiliary artwork and scrolls the rail with renderer animation. This measures the gallery portion of the suite. It cannot qualify a TV alone.

### Android TV findings

The physical onn. 4K Pro reported a 60 Hz display and a 1920×1080 app view. The stock graphics library and density-derived backing store missed the zero-deadline gate in all three 600-second gallery runs. The diagnostic comparisons used the same frozen artwork. In 96 seconds the pinned framework baseline recorded 451 late frames out of 451, the preview with the stock native runtime 442 out of 442, and the EGL correction alone 2,004 out of 2,280. This isolated the native multisampling cost. Direct inspection then showed that the renderer was drawing 3840×2160 pixels for the 1920×1080 view. Matching the view reduced the missed count to 7 out of 2,853 over 96 seconds. This last comparison changed rendering cost; it explains the benefit of the new default. Explicit app-selected rendering scales remain available.

An intermediate set of three ten-minute passes used the corrected native libraries, 1920×1080 backing store and the same source gallery. They recorded **59 / 17,334**, **52 / 17,902** and **47 / 18,109** late app-layer frames respectively. The device remains **preview**. The stored CSV files contain only timing and classifications for the probe's own layer. Complete system traces stay on the test machine. These are compositor presentation classifications. Callback FPS does not substitute for them.

The Android archive supplied by the renderer release retains the upstream JavaScript and changes the three shipped native ABIs with the pinned EGL fix. Rebuild it with the Android fixture's Rust/NDK scripts and `scripts/pack-android-canvas.py`. The compact `solid.2` archive also excludes non-Android platform directories. For webOS use the generated IPK; for Tizen use an app-owned signing profile; Vizio requires partner access for device qualification.

### Paint order and workload validation

Inspection of the intermediate physical captures found two visual faults. The gallery rail had inherited the viewport height while its content extended to 5,472 logical pixels. The backend could therefore cull a rail containing on-screen children. Also, a keyed background replaced at runtime could paint over an existing foreground sibling. The earlier traces are diagnostic evidence from this underdrawn scene and cannot qualify the intended workload.

The fixture now sizes the rail to the actual content extent. The framework synchronizes native sibling paint order during anchored insertions and same-parent moves. A Chromium regression reproduced the old background covering the foreground and now checks the actual foreground pixels after replacement on both WebGL and Canvas. The corrected physical workload records a preflight inventory for all 32 navigation steps in both modes and starts timing only if loaded posters are visible and in front of the backdrop at every checkpoint.

### Physical gallery with verified foreground artwork

The 64-step preflight on the onn. 4K Pro found all visible posters loaded, with at least 11 posters at each checkpoint. The display operated at 60 Hz. Perfetto matched every recorded app frame to its SurfaceFlinger display frame.

| Ten-minute run | Presented frames | Late app frames | Presentation intervals of 25–100 ms |
| -------------- | ---------------: | --------------: | ----------------------------------: |
| 1              |           18,016 |               0 |                               4,295 |
| 2              |           17,547 |               0 |                               4,396 |
| 3              |           17,854 |               3 |                               4,193 |

The gallery animates for 300 ms and rests for 200 ms. Short multi-refresh intervals occurred in all three runs. The third run also missed three app deadlines. Android TV remains in preview. An interrupted 489-second capture was excluded and repeated. Use `--start-pass 3 --passes 1` to resume a recording in a directory containing two completed passes.

[Device report and presentation timestamps](./onn-visible/summary.json) · [FrameTimeline conventions](https://perfetto.dev/docs/data-sources/frametimeline)

On the same device, a separate interaction run opened the details view with DPAD input, played an eight-second clip, returned with Back and resumed the app from the launcher. The frame timings above cover the gallery. [Physical evidence archive](https://github.com/solid-multiplatform/platform/releases/download/v0.2.0-preview.3/physical-tv-evidence.zip)

The optional dedicated Android TV SurfaceView passed its artwork preflight, and a packaged starter displayed its native plugin result after remote input. The physical device exposed the SurfaceView through the layer latency ring only. The short diagnostic contained 3,670 presentations over 99.25 seconds and 81 intervals of 25–100 ms. TextureView remains the default. [SurfaceView presentation evidence](https://github.com/solid-multiplatform/platform/releases/download/v0.2.0-preview.4/surface-view-diagnostic.json)

### Browser TV sizing and device pixel verification

On Chromium 85 the previous TV starter cropped a 1920×1080 canvas when its viewport shrank. The modern WebGL and legacy Canvas profiles now fit the drawing buffer and pointer map to the same displayed rectangle. The packaged Tizen, webOS and Vizio builds passed 24 checks covering 720p, letterboxing, 2× display density and return to 1080p. The checks include visible button color and activation through the fitted canvas. [Chromium 85 measurements](./tv-validation/browser-tv-viewports.json)

On the physical onn. 4K Pro, an independent screenshot audit compared **958 poster interiors across all 64 navigation checkpoints** with the local reference artwork. The maximum per-poster mean absolute RGB error was 5.03 on a 0–255 scale. A black-screen control failed, even though its in-app scene graph reported loaded artwork. The coverage includes the sampled poster pixels. Frame timing has a separate qualification gate. [Per-checkpoint measurements](./tv-validation/onn-poster-pixels.json)

Build and install the isolated probe generated by `tests/performance/make-tv-app.mjs`. Run `python tests/performance/check-gallery-pixels.py PROJECT --serial DEVICE --package APP_ID --out NEW_DIRECTORY` with Pillow installed. The probe holds each visual checkpoint until the host has captured the composited screen. The audit runs separately from timed captures and writes a failure screenshot locally if a poster differs. Relaunch the probe normally before recording performance.

### Gallery, modal and native video in one process

The mixed Android TV probe keeps the artwork scene mounted while remote input opens a dialog, starts the local Media3 clip, pauses, seeks, backgrounds the app, resumes playback and returns through the dialog to the gallery. The physical compositor exposed labels from the gallery showing through the opaque dialog. A capture before the fix contained 3,535 unexpected pixels in an empty rectangular area of the dialog. Captures after the fix contained zero there on both entry and return. The browser regression checks an opaque panel and a translucent one and verifies that nonoverlapping glyphs still batch.

Build an isolated probe with `node tests/performance/make-tv-app.mjs DEST REFERENCE_CHECKOUT --mixed VIDEO_ARCHIVE`. Install its APK and run `mixed-android.py --visual` with its serial, package ID and a new output directory. For each timed pass, run the same controller with `--seconds 600 --pass-number N` and a fresh output directory. The controller waits for the 64-step visibility preflight, then drives ten full remote-input cycles. Each pass records activity launch time separately. `analyze-mixed.py` checks the capture digest and action sequence and reports window-frame timing by phase alongside native decoder output, drop and skip counts. Media3 skips and drops are counted separately, including around seeks. Screenshots are collected in the separate visual pass.

Generate the probe with `--surface-view` to use the dedicated Android surface. The visual controller accepts `--over-video` to place a Solid transport panel over the video and a native Android caption over that panel. The test checks all three layers in the composited screen.

A second SurfaceView visual test suspended the app during playback, resumed it paused and checked the composited picture before sending another key. The native video and native caption returned, but an idle Solid scene could leave its new graphics buffer empty. The Android host now requests a frame on resume and when NativeScript finishes replacing a lost surface. The physical TV displayed the Solid panel, the native caption and the matching paused clip frame after resume. Visual mode uses FFmpeg and Pillow to compare the unobscured part of the video with the bundled reference clip.

### Ten-minute mixed passes on the onn. 4K Pro

| Pass | Input-to-playback cycles | Window frames | Late or dropped window frames | Media3 dropped buffers |
| ---- | -----------------------: | ------------: | ----------------------------: | ---------------------: |
| 1    |                       10 |        16,221 |                            53 |                      6 |
| 2    |                       10 |        15,583 |                            50 |                      5 |
| 3    |                       10 |        15,486 |                            56 |                      5 |

The original analyzer counted child-layer transactions alongside activity-window buffers. FrameTimeline can associate several layer updates with one display token. The corrected counts use the activity layer name and the `Is Buffer?` flag. The companion CSV retains the other layer updates. The zero-miss threshold and the native video counters are unchanged. [FrameTimeline documentation](https://perfetto.dev/docs/data-sources/frametimeline) · [Corrected layer evidence](https://github.com/solid-multiplatform/platform/releases/download/v0.2.0-preview.6/frame-accounting-v2.zip)

The device ran Android 14 at 60 Hz. Every window frame matched a SurfaceFlinger display frame. Of the 159 late or dropped window frames, 98 occurred in the modal phase (including opening the player), 57 while resuming and four in the gallery. Media3 reported 16 dropped output buffers across the 30 playback sessions. The window and decoder measurements describe different surfaces; their counts must be interpreted separately.

These traces used the corrected WebGL painter on the default TextureView path. The redrawn paused controls on the dedicated SurfaceView received a separate physical pixel check. Android TV remains in preview.

An earlier 54-second attempt was excluded when a Select event after activity resume was not acknowledged. The repeated controller waited for Android to assign the display’s input window to the app before sending Select. The local controller for pass 3 was recovered after seven cycles. The app and device recorder continued; the eighth interaction began later within its one-minute slot. The original trace contains all 150 prescribed action markers over 600.151 seconds. [Per-phase measurements](./onn-mixed/summary.json)

The Android video adapter now uses a Media3 layout that omits the disabled transport controller and retains native subtitles. On the same physical TV, regular/custom/custom/regular two-minute diagnostic passes measured first-view inflation at 322/86/90/325 ms and repeat inflation at 107/33/30/104 ms. Late or dropped window frames were 12/12/11/11. View creation time improved in both orders; the TV still fails the zero-miss gate. [Optional media module and diagnostic samples](https://github.com/solid-multiplatform/platform/releases/tag/video-v0.2.0-preview.2)

With the published video-module archive installed through the preview 6 CLI, a separate 600.101-second physical pass completed ten cycles. It recorded 52 late or dropped window frames out of 16,045 matched frames, including 31 in the modal phase and 19 in the resuming phase. Media3 reported 1,034 rendered video buffers and five drops. [Packaged module run](https://github.com/solid-multiplatform/platform/releases/download/video-v0.2.0-preview.2/frame-accounting-v2.zip)

The next Android adapter constructed the engine on a worker and inflated its view on the main looper in parallel. On this TV, two pairs of two-minute trials in opposite orders reduced the first playback input-dispatch span from 535–571 ms to 70–78 ms and the next from 77–78 ms to 4–5 ms. First playback focus arrived in 1.68–1.78 seconds with the worker and 1.74–1.77 seconds with the synchronous builder. The corrected activity-window flag counts were 11/12/13/11 in control/worker/worker/control order. The improvement is in time the remote handler occupies the UI thread; playback readiness and the zero-miss display requirement remain separate measurements. [Worker comparison samples](https://github.com/solid-multiplatform/platform/releases/tag/video-v0.2.0-preview.3)
