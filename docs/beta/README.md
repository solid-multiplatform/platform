# 0.2 qualification matrix

The 0.2 archives are an engineering preview. TV promotion requires three ten-minute physical passes at the predeclared display cadence with zero missed presentation deadlines across input, artwork, animation, modals, playback and return from suspension. Capture startup separately. A missing trace, incomplete scenario set or missed deadline leaves the profile in preview.

| Profile                          | Evidence in this checkout                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Browser                          | Chromium WebGL/Canvas regression suite, native DOM editor tests and resize/focus checks                           |
| Linux desktop                    | SDL3, native GL, text rendering, resize and keyboard invocation on Linux/X11 with Mesa software rendering         |
| Windows / macOS desktop          | Native binding and launcher supplied; platform qualification pending                                              |
| Android handset / iOS / Apple TV | Separate host builds, native input/editor and plugin integrations; report device and simulator results separately |
| Roku OS 16                       | SceneGraph ZIP and native task build. Physical developer slot occupied; existing channel preserved                |
| Android TV                       | Physical onn. 4K Pro at 60 Hz. Gallery timing failed the zero-miss gate                                           |
| Tizen / webOS / Vizio            | Separate build profiles and legacy Canvas lane. Vendor device and partner qualification pending                   |

Baseline refs: platform 6140e99b4ae7f0b990f11a53d5c1237439dc085e, renderer 39a7dccb4d9087d11af083affd16d85c33bc6b6d. The benchmark now resolves these exact revisions from Git history and the checked-in package archive. The Chromium CPU smoke measurement is diagnostic and does not measure TV presentation timing.

For the physical Android gallery lane, use `tests/performance/make-tv-app.mjs` with the local solidtv comparison checkout. It consumes the frozen normal/dense scene descriptions and local artwork and does not publish the artwork. Install the resulting isolated probe. Record with `capture-android.py` and export per-layer timing with `analyze-android.py`. The reference's normal and dense modes are commonly called the 79- and 133-image scenes; this replay includes auxiliary artwork and scrolls the rail with renderer animation. This measures the gallery portion of the suite. It cannot qualify a TV alone.

### Android TV findings

The physical onn. 4K Pro reported a 60 Hz display and a 1920×1080 app view. The stock graphics library and density-derived backing store missed the zero-deadline gate in all three 600-second gallery runs. The diagnostic comparisons used the same frozen artwork. In 96 seconds the pinned framework baseline recorded 451 late frames out of 451, the preview with the stock native runtime 442 out of 442, and the EGL correction alone 2,004 out of 2,280. This isolated the native multisampling cost. Direct inspection then showed that the renderer was drawing 3840×2160 pixels for the 1920×1080 view. Matching the view reduced the missed count to 7 out of 2,853 over 96 seconds. This last comparison changed rendering cost; it explains the benefit of the new default. Explicit app-selected rendering scales remain available.

The final three ten-minute passes used the corrected native libraries, 1920×1080 backing store and the same source gallery. They recorded **59 / 17,334**, **52 / 17,902** and **47 / 18,109** late app-layer frames respectively. The device remains **preview**. The stored CSV files contain only timing and classifications for the probe's own layer. Complete system traces stay on the test machine. These are compositor presentation classifications. Callback FPS does not substitute for them.

The Android archive supplied by the renderer release retains the upstream JavaScript and changes the three shipped native ABIs with the pinned EGL fix. Rebuild it with the Android fixture's Rust/NDK scripts and `scripts/pack-android-canvas.py`. The compact `solid.2` archive also excludes non-Android platform directories. For webOS use the generated IPK; for Tizen use an app-owned signing profile; Vizio requires partner access for device qualification.
