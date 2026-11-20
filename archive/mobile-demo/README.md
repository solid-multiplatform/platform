# Mobile demo

Two modes on one Solid Multiplatform scene, phone only, built into an Android APK:

- **Discover** — a TMDB-style media browser: full-bleed hero with a bottom scrim and two pill actions, four peeking poster rails that drag, fling and snap, a details screen with a backdrop, poster, overview, cast initials and a similar rail, and shimmer skeletons shaped exactly like the cards they replace.
- **Chat** — 10,000 deterministic messages rendered as agent messages: Markdown (headings, lists, inline code, links), collapsible tool cards (Read, Edit, Bash, Search), file references and fenced code. A measured-height virtual window, iOS momentum, a visible scrollbar, a jump-to-latest pill, date separators, user bubbles on the right, a composer and a typing indicator.

Both modes stay mounted offscreen when the other is active, so switching loses neither scroll position nor loaded posters. A toggleable `FPSCounter` sits below the mode switch.

## Build

Prerequisites: Node 24, pnpm 10.33.4 (Corepack), JDK 21, an Android SDK with build-tools 36 and NDK as installed by the CLI, and the framework's `dist/` (the CLI needs it; `build.mjs` builds it if missing).

After changing `packages/renderer`, refresh the archive `init` vendors before building — otherwise the app silently carries the previous renderer:

```sh
node packages/platform/cli/renderer-archive.mjs
```

```sh
# from the repository root
corepack pnpm install

# x86_64 release APK for the emulator, signed with a throwaway keystore
node archive/mobile-demo/build.mjs

# arm64 release APK for a Pixel 7 Pro
node archive/mobile-demo/build.mjs --arm64
```

`build.mjs` scaffolds an `init --targets android` project in `/var/tmp/smp-mobile-demo-<arch>`, copies `src/` and `solid-platform.config.json` over it, injects `TMDB_API_KEY` if set, restricts `app.gradle` to one ABI (and keeps `useLegacyPackaging = true`), runs `solid-platform build android`, then `ns build android --release` with a generated keystore. The APK lands in `archive/mobile-demo/build/mobile-demo-<arch>.apk`.

The source in this directory is the app. `src/` replaces the generated project's `src/`; nothing in it depends on Vite or NativeScript APIs.

### TMDB

`TMDB_API_KEY` is read at build time and written into `src/config.ts`; there is no runtime environment. Without a key, or when a request fails, every rail falls back to the bundled `src/data/sample.json` (40 titles across four rails, with real poster and backdrop paths). The UI is complete offline.

## Design

Grounded in current products, then committed to measurements before styling: MUBI (monochrome, typography-led, sparse chrome), Letterboxd (poster-first hierarchy, Graphik/Atlas metadata), Netflix / Apple TV / Disney+ mobile (gradient hero, two pill actions, peeking rails with snap), iMessage / ChatGPT / Claude (asymmetric bubbles, grouped spacing, rounded composer), Material 3 (8 dp grid, 48 dp targets) and Apple HIG (44 pt targets, safe-area margins).

References: [MUBI](https://mubi.com/), [Letterboxd fonts](https://letterboxd.com/about/fonts/), [Material 3 spacing](https://m3.material.io/foundations/layout/understanding-layout/spacing), [Material 3 accessibility](https://m3.material.io/foundations/accessible-design/accessibility-basics), [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple HIG buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Netflix Tech Blog](https://netflixtechblog.com/), [Apple TV app](https://www.apple.com/apple-tv-app/), [Disney+](https://www.disneyplus.com/), [ChatGPT](https://openai.com/chatgpt/), [Claude](https://claude.ai/).

Committed measurements, at 1080 × 2400 physical / 540 × 1200 logical (density 2): 20 unit side margins; 12 unit gutters; rail card width `(540 − 40 − 24) / 2.4 = 198`, so the third poster peeks; poster 2:3 (198 × 297); hero 62% of the screen; title 34/40 in pure white, section labels 21, body 15–16, metadata 13; 12–16 corner radii; one desaturated-red accent (`#c05643`), pure white reserved for primary titles. Chat bubbles 18 radius, 8 between messages in a sender group and 20 between groups; date rows as centred small caps; composer 48 high above the keyboard. Every interactive target is at least 48 units.

## How it works

- **Scrolling** (`src/scroller.ts`): one offset signal per scroller, with the physics of iOS `UIScrollView` — the real constants, not a guess. Details and sources under "Scrolling" below. `requestAnimationFrame` runs only during a drag's flight, so an idle scene schedules nothing.
- **Rails**: each rail mounts only the cards intersecting the viewport plus one on each side; only those `Image` nodes exist, so only their textures load. A drag that starts on a card picks one axis after 10 units of movement — the dominant one — and keeps it for the rest of the gesture: the rail or the page, never both, as UIKit's nested scroll views behave.
- **Chat heights** (`src/chat.ts`, `src/heightIndex.ts`): every item starts with a conservative estimate. `ChatHeights` keeps a Fenwick tree of slot heights, so the total height, `offsetOf(index)` and `indexAt(offset)` are O(log n) and the scroll path never scans the transcript. A mounted message reports its laid-out height once through `onLayout`; the index is corrected, and a change above the first visible item shifts the offset by exactly that delta, so the anchor keeps its screen position. Offscreen messages are neither parsed nor measured; a re-mount parses from the `markdown()` cache. Roughly a dozen rows are mounted for 10,000 messages, and tool cards expand per message without touching the physics. The scrollbar's thumb is derived from offset and content height; "Latest" appears when the offset leaves the bottom.
- **Skeletons**: fixed-size card blocks with one sweeping highlight per card. The highlight is an `animate(..., { loop: true })` on a node that is destroyed when the rail's data arrives, so no shimmer survives the load. Rails load in sequence: the next fetch starts only when the previous rail settles.
- **Images**: TMDB URL tiers are chosen at the call site (`w342` for cards, `w780` for backdrops); `Image` mounts lazily with the card window. This version of the framework has no `loadWidth` prop (see gaps).

## Scrolling

The touch scroller reproduces the physics of `UIScrollView` on iOS, using constants recovered from public reverse engineering of UIKit, not guesses. This is the **touch/iOS model** — it does not describe TV focus navigation or desktop wheel scrolling, which follow different platform conventions.

**The model** (all in logical pixels; iOS points ≈ this app's units at density 2):

- **Deceleration** is exponential **per millisecond**, `v(t) = v0 · 0.998^t` (`UIScrollViewDecelerationRateNormal = 0.998`; `0.99` is the "fast" rate), integrated per frame as `dx = v · rate · (1 − rate^dt) / (1 − rate)`, so a release travels `v0 · rate / (1 − rate) ≈ 499 · v0` px in total.
- **Release velocity** is derived the way `UIPanGestureRecognizer` does: per-move finite differences blended `0.2·current + 0.8·previous` while dragging, then a guarded low-pass at release, `0.75·previous + 0.25·latest`. A drag that stops before release therefore has no fling. A release below **0.25 px/ms** does not decelerate at all.
- **Rubber band**: dragging past an edge follows `(1 − 1/(x·c/d + 1)) · d` with **c = 0.55** and `d` the visible dimension — the content can never be dragged more than one viewport past an edge, moving at 55% of the finger immediately past the bound.
- **Bounce**: the release-from-overscroll spring is a fixed **0.99/ms** contraction of the overshoot (independent of the deceleration rate) that carries the velocity term and settles within 0.5 px of the bound; a fling that reaches an edge mid-flight integrates to the edge and hands the frame remainder to the same spring.
- **Paging/snap**: a rail release lands on the snap slot **nearest the projected landing point** — `projected = v0/|ln(0.998)|` with a 0.01 px/ms velocity floor, the number `scrollViewWillEndDragging:withVelocity:targetContentOffset:` reports — and decelerates into it on the same exponential curve, at the rate that lands exactly on the slot. The content end counts as a slot, so the last card lands flush right.
- **Axis lock** for a horizontal rail inside a vertical page: 10 pt of movement before a direction is chosen (Apple's pan hysteresis), then the dominant axis owns the gesture until it ends. A diagonal never moves both — perpendicular UIKit scroll views do not recognise simultaneously, and moving both felt like the wrong view was scrolling.

**Sources:**

- [Telegram-iOS UIKit scroll physics analysis](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/TelegramUI/Components/CoreList/docs/plans/2026-05-22-uikit-scrollview-physics-analysis.md) — instruction-level disassembly of UIKitCore (iOS 26.2, arm64e) with the per-constant addresses, validated against recorded scroll trajectories. The decay law, the release-velocity blends, the bounce spring (`ln(0.99)` literal) and the edge-crossing hand-off are all decoded here, with a reference implementation in [`CoreListDemo/ScrollPhysics`](https://github.com/TelegramMessenger/Telegram-iOS/tree/master/submodules/TelegramUI/Components/CoreList/CoreListDemo/ScrollPhysics).
- [`UIScrollView.h` SDK header](https://github.com/theos/sdks/blob/master/iPhoneOS12.4.sdk/System/Library/Frameworks/UIKit.framework/Headers/UIScrollView.h) — `UIScrollViewDecelerationRateNormal = 0.998`, `...Fast = 0.99`; the iOS 7 and iOS 10 class dumps list the private selectors (`_getStandardDecelerationOffset:...`, `_getBouncingDecelerationOffset:...`, `_rubberBandContentOffsetForOffset:...`).
- The rubber-band formula and c = 0.55: first published by Grant Paul ([@chpwn](https://twitter.com/chpwn/status/291794740553338880)), spread as ["Analysis of Apple's rubber band scrolling"](http://web.archive.org/web/20150101182221/http://squareb.wordpress.com:80/2013/01/06/31/) and on Stack Overflow, since validated against the disassembly.
- WWDC 2018, [Designing Fluid Interfaces (session 803)](https://developer.apple.com/videos/play/wwdc2018/803/) — Apple's own description of projection and the "imperceptible stop"; [reference implementations](https://github.com/nathangitter/fluid-interfaces).
- Apple HIG, [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views): support the default scrolling gestures; elastic, expected indicator behaviour; make scrollability apparent (the peeking rail does this); a horizontal scroll view inside a vertical one is fine — never the same orientation; page-by-page scrolling with an optional unit of overlap subtracted from the page size; a page control and a scroll indicator must not share an axis. The local copy of the page and the UIKit references are in `handoff/apple-docs/` (Apple copyright — cited, not pasted).

**Debugging**: each gesture logs its release velocity, target and settle time to logcat under the tag `ScrollDemo` (the Android release bundle strips `console.*`, so the scroller writes through `android.util.Log`). `SCROLL_DEBUG=0 node build.mjs` builds without it. Tests: `pnpm test` in this directory (`node --test src/scroller.test.ts src/heightIndex.test.ts`) — 12 physics tests (velocity blends, decay distance, rubber band, bounce, snap targets, no frames at rest) and 5 height-index tests (append, update, prefix offsets, offset-to-item lookup, growth past the capacity).

## Framework gaps hit

- **Default shaders are not registered on native hosts.** `packages/platform/src/hosts/web.ts:216` calls `registerDefaultShaders`, but `packages/platform/hosts/nativescript/host.mjs:105` (`launchEstablished`) and `packages/platform/hosts/nativescript/application.mjs:97` (`launchApplication`) never do. On Android every `borderRadius`, `border` and `linearGradient` was a bare rectangle until the app called `registerDefaultShaders(getRenderer())` itself (`src/app.tsx`). The smallest framework change: call it once in `startLightningRenderer` for every host, or in the two native launch paths beside `new RendererMain(settings)`.
- `packages/platform/src/primitives/Image.tsx:10` — no `loadWidth`/request-size cap; the app selects a TMDB URL tier instead. The smallest useful change: forward `loadWidth` to `textureOptions` (or the renderer's `w`) so a `w780` URL can be decoded at card size.
- `packages/platform/src/primitives/SelectableText.tsx:192` — the wrapper always captures pointer drags for selection, so the selectable overview cannot also start a page drag; the details screen scrolls from any non-text area. The smallest change would be a `selectable="long-press"` mode that arms selection after a hold.
- `packages/platform/src/primitives/Virtual.tsx:1` — `VirtualRow`/`VirtualColumn` are focus-navigation virtualisers: they have no touch drag, velocity or offset API, so the rails and chat use app-level windowing. A framework-level `VirtualList` with an exposed offset and pointer source would replace both app virtualisers.
- `packages/platform/src/primitives/Skeleton*` — no skeleton primitive or shimmer (grep for "shimmer"/"skeleton" finds nothing); the app owns `Skeleton.tsx`.
- **Bold on WebGL.** The Android backend picks a face by family and has no weight axis, so **strong** shows as regular unless a registered bold face is passed through `strongFontFamily`. No font asset is added here; headings and lists carry the hierarchy by size instead.
