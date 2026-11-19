# Text

All text goes in a `<text>` element.

```tsx
<text>Hello there</text>
```

A `<text>` takes the usual node props (`x`, `y`, `color`, `alpha`, states,
transitions) and the text props below.

## Text props

- `fontFamily`: the name you loaded the font under.
- `fontSize`: size in pixels.
- `fontWeight`: a number or a name. It is appended to the family name:
  `fontFamily="Roboto"` with `fontWeight={700}` uses the font you loaded as
  `Roboto700`. `Config.fontWeightAlias` maps names to that suffix: `bold` is
  `700`, `regular` adds nothing.
- `fontStyle`, `fontStretch`: accepted. An SDF font has no style axis, so the
  WebGL backend ignores `fontStyle`.
- `lineHeight`: a multiplier of the font's line height when 3 or less,
  otherwise pixels.
- `letterSpacing`: extra space between letters in pixels. Default `0`.
- `textAlign`: `'left'`, `'center'` or `'right'`. Centering and right
  alignment need a width to align in, so set `contain`.
- `verticalAlign`: `'top'`, `'middle'` or `'bottom'`.
- `contain`: `'none'` (default), `'width'` or `'both'`. It decides whether
  `maxWidth` and `maxHeight` bound the text.
- `maxWidth`, `maxHeight`: the bounds. With `contain` set and no `maxWidth`, the
  node's `width` is used, then the parent's remaining width.
- `maxLines`: the most lines to draw.
- `overflowSuffix`: appended when text is cut. Default `'...'`.
- `wordBreak`: how long words wrap. Default `'break-word'`.

```tsx
<text
  width={600}
  contain="width"
  maxLines={2}
  fontSize={32}
  lineHeight={40}
  textAlign="center"
>
  A long title that wraps onto a second line and is then cut off
</text>
```

Inside a flex container a `<text>` reports its size once it has loaded, and the
container lays out again.

## Keeping text inside its box

A `<text>` never paints outside the box its parent reserves for it. When it has
been measured and turns out wider or taller than the room left — the parent's
width or height, less the text's `x`/`y`, the parent's padding and the text's
margins — it is bounded to that room: it wraps (a long word is broken), and
when the remaining height has room for fewer lines the rest is cut with
`overflowSuffix`. Text that fits keeps no bound, and text the app bounds with
`contain` or `maxWidth` keeps the app's box instead. A glyph that overhangs its
advance by more than a pixel is clipped to the text's box.

This is what CSS, React Native, Flutter, Android and Roku do: content is
wrapped or cut at the container's edge, never silently painted past it.

## Defaults for all text

`Config.fontSettings` holds the defaults for every `<text>`. Set it once at
start-up, before anything renders. The built-in default is
`{ fontFamily: 'Ubuntu', fontSize: 100 }`, so you will want your own.

```ts
import { Config } from '@solid-multiplatform/platform';

Config.fontSettings = {
  fontFamily: 'Lato',
  fontSize: 32,
  color: 0xffffffff,
};
```

## Loading fonts

The WebGL backend draws SDF text. A font is an atlas image plus a JSON file of
glyph data. Convert a `.ttf` with an MSDF generator and ship both files with
your app. An app made by `solid-platform init` has `Lato` in `assets/fonts`.

With `startApp`, pass the fonts in the options:

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

startApp(webHost(), App, {
  fonts: [
    {
      type: 'msdf',
      fontFamily: 'Lato',
      atlasUrl: './fonts/Lato-Regular.msdf.png',
      atlasDataUrl: './fonts/Lato-Regular.msdf.json',
    },
  ],
});
```

Without `startApp`, call `loadFonts` yourself:

```ts
import { createRenderer, loadFonts } from '@solid-multiplatform/platform';

const fonts = loadFonts([
  {
    type: 'msdf',
    fontFamily: 'Lato',
    atlasUrl: './fonts/Lato-Regular.msdf.png',
    atlasDataUrl: './fonts/Lato-Regular.msdf.json',
  },
]);
const { render } = createRenderer();
void fonts.catch((error) => console.error('Font load failed', error));
```

Call `loadFonts` before `createRenderer` so the download overlaps renderer
start-up. Its promise settles only after the renderer exists, so do not `await`
it first.

Then use the family name:

```tsx
<text fontFamily="Lato">Set in Lato</text>
```

The DOM backend used by unit tests takes web fonts instead:
`{ fontFamily, fontUrl }`.
