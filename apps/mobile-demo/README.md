# Mobile demo

Two modes on one Solid Multiplatform scene, phone only, built into an Android APK:

- **Discover** — a TMDB-style media browser: full-bleed hero with a bottom scrim and two pill actions, four peeking poster rails that drag, fling and snap, a details screen with a backdrop, poster, overview, cast initials and a similar rail, and shimmer skeletons shaped exactly like the cards they replace.
- **Chat** — 10,000 deterministic messages through a virtual window, momentum scrolling, a visible scrollbar, a jump-to-latest pill, date separators, asymmetric bubbles, a composer and a typing indicator.

Both modes stay mounted offscreen when the other is active, so switching loses neither scroll position nor loaded posters. A toggleable `FPSCounter` sits below the mode switch.

## Build

Prerequisites: Node 24, pnpm 10.33.4 (Corepack), JDK 21, an Android SDK with build-tools 36 and NDK as installed by the CLI, and the framework's `dist/` (the CLI needs it; `build.mjs` builds it if missing).

```sh
# from the repository root
corepack pnpm install

# x86_64 release APK for the emulator, signed with a throwaway keystore
node apps/mobile-demo/build.mjs

# arm64 release APK for a Pixel 7 Pro
node apps/mobile-demo/build.mjs --arm64
```

`build.mjs` scaffolds an `init --targets android` project in `/var/tmp/smp-mobile-demo-<arch>`, copies `src/` and `solid-platform.config.json` over it, injects `TMDB_API_KEY` if set, restricts `app.gradle` to one ABI (and keeps `useLegacyPackaging = true`), runs `solid-platform build android`, then `ns build android --release` with a generated keystore. The APK lands in `apps/mobile-demo/build/mobile-demo-<arch>.apk`.

The source in this directory is the app. `src/` replaces the generated project's `src/`; nothing in it depends on Vite or NativeScript APIs.

### TMDB

`TMDB_API_KEY` is read at build time and written into `src/config.ts`; there is no runtime environment. Without a key, or when a request fails, every rail falls back to the bundled `src/data/sample.json` (40 titles across four rails, with real poster and backdrop paths). The UI is complete offline.

## Design

Grounded in current products, then committed to measurements before styling: MUBI (monochrome, typography-led, sparse chrome), Letterboxd (poster-first hierarchy, Graphik/Atlas metadata), Netflix / Apple TV / Disney+ mobile (gradient hero, two pill actions, peeking rails with snap), iMessage / ChatGPT / Claude (asymmetric bubbles, grouped spacing, rounded composer), Material 3 (8 dp grid, 48 dp targets) and Apple HIG (44 pt targets, safe-area margins).

References: [MUBI](https://mubi.com/), [Letterboxd fonts](https://letterboxd.com/about/fonts/), [Material 3 spacing](https://m3.material.io/foundations/layout/understanding-layout/spacing), [Material 3 accessibility](https://m3.material.io/foundations/accessible-design/accessibility-basics), [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple HIG buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Netflix Tech Blog](https://netflixtechblog.com/), [Apple TV app](https://www.apple.com/apple-tv-app/), [Disney+](https://www.disneyplus.com/), [ChatGPT](https://openai.com/chatgpt/), [Claude](https://claude.ai/).

Committed measurements, at 1080 × 2400 physical / 540 × 1200 logical (density 2): 20 unit side margins; 12 unit gutters; rail card width `(540 − 40 − 24) / 2.4 = 198`, so the third poster peeks; poster 2:3 (198 × 297); hero 62% of the screen; title 34/40 in pure white, section labels 21, body 15–16, metadata 13; 12–16 corner radii; one desaturated-red accent (`#c05643`), pure white reserved for primary titles. Chat bubbles 18 radius, 8 between messages in a sender group and 20 between groups; date rows as centred small caps; composer 48 high above the keyboard. Every interactive target is at least 48 units.

## How it works

- **Scrolling** (`src/scroller.ts`): one offset signal per scroller. Drag follows the finger with a rubber edge, release projects velocity (`px/ms × 170`), then a cubic settle; rails snap to `card + gutter`, the page and chat do not. `requestAnimationFrame` runs only during a fling/settle, so an idle scene schedules nothing.
- **Rails**: each rail mounts only the cards intersecting the viewport plus one on each side; only those `Image` nodes exist, so only their textures load. A drag that starts on a card picks one axis after the first few units — horizontal moves the rail, vertical moves the page.
- **Chat**: `layoutChat` estimates conservative heights (wider than Lato's average glyph), builds a prefix layout once, and a binary search finds the first visible row each frame. Only ~12 rows are mounted for 10,000 messages. The scrollbar's thumb is derived from offset and content height; "Latest" appears when the offset leaves the bottom.
- **Skeletons**: fixed-size card blocks with one sweeping highlight per card. The highlight is an `animate(..., { loop: true })` on a node that is destroyed when the rail's data arrives, so no shimmer survives the load. Rails load in sequence: the next fetch starts only when the previous rail settles.
- **Images**: TMDB URL tiers are chosen at the call site (`w342` for cards, `w780` for backdrops); `Image` mounts lazily with the card window. This version of the framework has no `loadWidth` prop (see gaps).

## Framework gaps hit

- **Default shaders are not registered on native hosts.** `packages/platform/src/hosts/web.ts:216` calls `registerDefaultShaders`, but `packages/platform/hosts/nativescript/host.mjs:105` (`launchEstablished`) and `packages/platform/hosts/nativescript/application.mjs:97` (`launchApplication`) never do. On Android every `borderRadius`, `border` and `linearGradient` was a bare rectangle until the app called `registerDefaultShaders(getRenderer())` itself (`src/app.tsx`). The smallest framework change: call it once in `startLightningRenderer` for every host, or in the two native launch paths beside `new RendererMain(settings)`.
- `packages/platform/src/primitives/Image.tsx:10` — no `loadWidth`/request-size cap; the app selects a TMDB URL tier instead. The smallest useful change: forward `loadWidth` to `textureOptions` (or the renderer's `w`) so a `w780` URL can be decoded at card size.
- `packages/platform/src/primitives/SelectableText.tsx:192` — the wrapper always captures pointer drags for selection, so the selectable overview cannot also start a page drag; the details screen scrolls from any non-text area. The smallest change would be a `selectable="long-press"` mode that arms selection after a hold.
- `packages/platform/src/primitives/Virtual.tsx:1` — `VirtualRow`/`VirtualColumn` are focus-navigation virtualisers: they have no touch drag, velocity or offset API, so the rails and chat use app-level windowing. A framework-level `VirtualList` with an exposed offset and pointer source would replace both app virtualisers.
- `packages/platform/src/primitives/Skeleton*` — no skeleton primitive or shimmer (grep for "shimmer"/"skeleton" finds nothing); the app owns `Skeleton.tsx`.
