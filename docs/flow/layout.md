# Layout

Nodes are absolutely positioned unless their parent has `display: 'flex'`.

## Position and size

- `x`, `y`: position in pixels, relative to the parent. Negative values are
  allowed. Default `0`.
- `width`, `height`: size in pixels.
- `right`: distance from the parent's right edge. Sets `mountX` to 1.
- `bottom`: distance from the parent's bottom edge. Sets `mountY` to 1.
- `center`, `centerX`, `centerY`: center the node in its parent.

A `<view>` without a width or height takes the parent's size minus its own `x`
or `y`. Set both on anything you draw, or it may cover more than you expect.

A `<text>` needs no size. Its size is known once the text has loaded.

## Flex

Set `display: 'flex'` on a container to lay its children out in a row or a
column. There is one flex engine, in `packages/platform/src/core/flexLayout.ts`.

```tsx
const row = {
  display: 'flex',
  justifyContent: 'flexStart',
  width: 1760,
  height: 300,
  gap: 26,
  y: 400,
} as const;

<view style={row}>
  <text>TV Shows</text>
  <text>Movies</text>
  <text>Sports</text>
  <text>News</text>
</view>;
```

A flex container with text children waits for each text to load, then lays out
again with the measured sizes.

### Container props

- `display`: `'flex'` or `'block'`. Use `'block'` to turn flex off on `Row` and
  `Column`.
- `flexDirection`: `'row'` (default), `'column'`, `'row-reverse'` or
  `'column-reverse'`.
- `direction`: `'ltr'` (default) or `'rtl'`.
- `justifyContent`: `'flexStart'`, `'flexEnd'`, `'center'`, `'spaceBetween'`,
  `'spaceAround'` or `'spaceEvenly'`.
- `alignItems`: `'flexStart'`, `'flexEnd'` or `'center'`. The container needs a
  size on the cross axis.
- `flexWrap`: `'nowrap'`, `'wrap'` or `'wrap-reverse'`.
- `gap`, `rowGap`, `columnGap`: space between items.
- `padding`: a number, or an array of two, three or four numbers in CSS order
  (`[top, right, bottom, left]`).
- `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`: override one
  side.
- `flexBoundary`: `'contain'` or `'fixed'`. With `'contain'` the container
  takes the size of its children on the main axis. With `'fixed'` it keeps its
  own size.
- `flexCrossBoundary`: `'fixed'` keeps the cross-axis size. The default is to
  contain.

### Item props

- `flexGrow`: share of the free space this item takes.
- `flexShrink`: how much the item shrinks when the container overflows.
  Default `0`.
- `flexBasis`: the item's size before free space is shared out. A number or a
  string.
- `flexOrder`: position among the items.
- `flexItem`: set to `false` to leave the child out of flex layout. It is then
  positioned by its own `x` and `y`.
- `alignSelf`: `'flexStart'`, `'flexEnd'` or `'center'`. Overrides the
  container's `alignItems` for this item.
- `margin`: a number or an array in CSS order.
- `marginTop`, `marginRight`, `marginBottom`, `marginLeft`.
- `minWidth`, `maxWidth`, `minHeight`, `maxHeight`.

### Flex grow

Use `flexGrow` when one item has an unknown size and another should take the
rest.

```tsx
<view width={600} display="flex" gap={20} height={42} y={100} x={150}>
  <text fontSize={42}>Flex Grow</text>
  <view flexGrow={1} height={4} y={19} color={0xff3000ff} />
</view>
```

![Flex grow](../images/flexGrow.png)

Several items can grow. The free space is divided in proportion to each
`flexGrow`.

```tsx
<view width={600} display="flex" gap={20} height={42} y={100} x={150}>
  <text fontSize={42}>Flex Grow</text>
  <view flexGrow={1} height={4} y={19} color={0xff3000ff} />
  <view flexGrow={3} height={4} y={19} color={0xff30ffff} />
  <view flexGrow={1} height={4} y={19} color={0x003c0fff} />
</view>
```

![Flex grow with several items](../images/flexGrow-multiple.png)

## When layout runs

Layout runs when a flex container is rendered, when a child is added or
removed, and when a text child loads. It runs in a microtask after the change,
not on a timer. Nothing is scheduled while the scene is idle.

- `onLayout`: called on a node after its layout ran. Use it to position
  something from the computed sizes.
- `updateLayout()`: call it on the container after you change a child's size
  yourself.
- `updateLayoutOn`: a prop. Layout runs again whenever its value changes, so
  pass it a signal's value.

```tsx
<view display="flex" gap={20} updateLayoutOn={items().length}>
  <For each={items()}>{(item) => <Tile item={item} />}</For>
</view>
```

## Row and Column

`Row` and `Column` are flex containers that also move focus between their
children. See [Row and Column](/primitives/row_column.md).

An explicit size is respected: `<Column height={400}>` keeps 400 even when its
children are taller, and `<Row width={800}>` keeps 800 even when its items are
wider. The overflow is scrollable when the row/column has `scroll="touch"`;
otherwise it is an app bug the layout audit reports. A container with no
explicit size still follows its children. Pass `flexBoundary="contain"` to
make a sized container grow with them anyway.

## Fitting the screen

Three helpers make a layout adapt instead of being drawn at one size:

- `useContentBox({ maxWidth, gutter })` — the safe area minus a gutter, capped
  and centred, reactive to rotation, the keyboard and safe-area changes.
- `fitSize(preferred, available, margin)` — a fixed size clamped to the room.
- `clampSize(value, min, available, margin)` — the same, with a floor.
- `useUiScale()` — the design-space scale (`designSize` in
  `solid-platform.config.json`), for a portaled dialog that lives outside the
  scaled `Screen` column.

`DatePicker`, `Alert`, `Sheet`, `Menu`, `Popover`, `Drawer` and `Toast` use
these internally: a panel is measured from the viewport and the safe area,
never from a fixed width, so it cannot hang off a 320-pt phone or push its
footer below a landscape window.

## Overflow audit

The framework can tell you when a box will be cut off, because layout is
immediate and absolute. In development the browser host turns the audit on
(`Config.layoutAudit`); it walks the finished tree once per layout batch —
never per frame, never on a timer — and prints the node, the edge and the
units it escapes. Content inside a scroll container is exempt.

```ts
Config.layoutAudit = true; // or pass layoutAudit to webHost()
Config.layoutAuditPanels = false; // only report the screen, not panel spill
```

`auditLayout(root, bounds)` is also a pure function, for tests and build
gates. The gallery build runs `packages/platform/scripts/layout-audit.mjs`
before packaging; it fails the build when a real screen does not fit a 320-pt
phone, a Pixel 7 Pro, a 540-pt TV, Roku at 1080p or a desktop window. To keep
the findings as warnings without stopping the build, run
`node packages/platform/scripts/layout-audit.mjs --warn`.
