# Apple guidance as a reference

Platform behaviour in this framework — scrolling, lists, sheets, pickers, controls, text fields, navigation — is expected to follow Apple's guidance rather than improvised values. Apple's pages are JavaScript-rendered and scrape to a bare title, so this repository carries a downloader and keeps the full text out of git (it is Apple's copyrighted material).

## Getting the pages

```sh
node scripts/apple-docs.mjs                 # Human Interface Guidelines (172 pages)
node scripts/apple-docs.mjs --uikit         # ~30 UIKit reference pages for the controls we implement
node scripts/apple-docs.mjs --out ~/apple   # somewhere else than .apple-docs/
```

Each page becomes Markdown with its source URL, in `.apple-docs/hig/` and `.apple-docs/uikit/`, plus an `INDEX.md`. `.apple-docs/` is git-ignored. Apple serves each page as JSON at `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json` (and `.../documentation/uikit/<symbol>.json`); the script walks the topic sections from there.

## What to check before touching a primitive

- **Scroll views** (`.apple-docs/hig/scroll-views.md`): default gestures and keyboard shortcuts; elastic scroll indicators; make content look scrollable by showing partial content at the edge; never nest scroll views of the same axis (a horizontal rail inside a vertical page is fine); page-by-page scrolling with an optional overlap; automatic scrolling only as far as needed; one scroll edge effect per view, only when content sits behind floating elements; a page control never shares an axis with a scroll indicator; tvOS has no scroll objects — the system scrolls to keep focus visible.
- **Controls, text fields, lists, sheets, navigation**: the matching page under `.apple-docs/hig/` first, then the UIKit page for the behaviour the API defines.
- **Motion**: `.apple-docs/hig/motion.md` and Apple's "Designing Fluid Interfaces" talk for the intent behind velocity-based animation.

Record the source and the constants a primitive adopts in the code or its documentation, and verify the behaviour on a device or emulator — a screenshot or a frame measurement, not an opinion.
