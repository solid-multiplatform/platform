# Sona — the gallery

One small music library, built from the framework's primitives, shown through
three shells from one source: a phone app, a ten-foot TV app and a desktop app.
The point is not a grid of components: every primitive appears where a real
product would use it, and the same scene proves the frame budget on each
device.

Run it:

```sh
corepack pnpm install

# web (desktop family in a browser), then open http://127.0.0.1:4173
pnpm --dir apps/gallery build
python3 -m http.server 4173 --directory apps/gallery/dist/web

# browser TV (Tizen/webOS host: the TV family)
pnpm --dir apps/gallery build:tizen

# native desktop (Rust runtime)
pnpm --dir apps/gallery build:desktop
packages/host-desktop/native/target/release/solid-desktop \
  --script apps/gallery/dist/desktop/app.js
```

A phone browser (coarse pointer, no hover) gets the mobile shell; a TV host
gets the focus rail; a desktop window gets the sidebar. The app decides from
the host's capabilities and the pointer media query — never from the target
name (`src/family.ts`).

## What is here

- **Library** — a hero with the one gradient action, three peeking rails, and
  the album grid as columns of generated covers. `Column`, `Row`, `Cover`
  (gradient + shapes), `Marquee`-safe single-line titles, `GhostButton`,
  `GradientButton`, `IconButton`.
- **Create playlist** — the form in context: `TextField` (single and
  multiline), radio group, palette choice, `DatePicker`, `Select`, a track
  list with selection, `Alert` for discard, `Toast` on create, and every
  button variant in one real flow.
- **Album** — cover, actions (gradient play, shuffle, a more menu, a tooltip),
  a track list, generated release notes in Markdown, a selectable credits
  line, a context menu on the cover, and Back to the library.
- **Performance** — the in-app lab: display rate, FPS, the frame's own cost,
  p50/p99 against the panel's budget, a live frame-time graph drawn from scene
  views, and Capture. It runs a measured loop only while the screen is open;
  leaving it removes the listener and the scene goes idle.

Covers are generated from each album's two palette colours, and icons are
drawn as scene bars (`Glyph`), so the app ships no images and every platform
draws the same thing.

## Status

Library, Create, Album and Performance are built and screenshot-checked in the
desktop, mobile and TV shells. Next: Search (`TextField`, `Select`, empty
states), Settings (modals, drawers, popovers, window chrome), the Components
index that links each primitive to where it is used for real, and the native
Android/TV builds.
