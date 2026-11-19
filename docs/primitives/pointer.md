# Pointer, context menus and desktop behaviour

A desktop window is judged by the things a mouse and a keyboard are expected
to do: hover, secondary click, the wheel, text selection, focus rings and
keyboard shortcuts. This page lists what the framework does, and the Apple
Human Interface Guidelines page each behaviour follows. The guidance applied
here is **macOS and iPadOS**: iOS touch-scrolling physics and tvOS focus rules
are intentionally not imported into desktop or web.

The rule that governs all of it: nothing here runs while the scene is idle. A
listener exists only where a host has a pointer, a held timer only while a
press or a hover delay is pending, and the one drag-time Escape listener is
removed when the drag ends.

## The pointer path

Every host feeds one sink (`src/sdk/input.ts`). The scene finds the node under
the point, then recognises hover, press, click, hold, drag, wheel and the
secondary click. Nodes opt in with props:

| Prop                                | When it runs                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `onPointerEnter` / `onPointerLeave` | The pointer crosses the node's box; each fires once per crossing                                      |
| `onPointerContext`                  | A secondary click (right click, Control-click, a trackpad's secondary click) on the node or inside it |
| `cursorStyle`                       | While the node is hovered, the host shows this cursor                                                 |
| `onPointerDrag` / `onPointerScroll` | As before; see [useMouse](/primitives/useMouse.md)                                                    |

Hover itself (the `$hover` state) needs no handler; a style is enough.
[Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)
asks for consistent feedback and the standard pointer appearances, and for
content effects that are useful rather than decorative. The framework follows
that with:

- the click hand over controls (`onEnter`/`onMouseClick`, or an explicit
  `cursorStyle="pointer"`), a not-allowed hand over a disabled control, and
  the I-beam over selectable text and text fields;
- no hover effect on plain text and no pointer-only decoration;
- hover feedback on `Button`, list rows and any node with a `$hover` style.

`cursorStyle="text"` is set by `SelectableText`, `TextField` and the desktop
field. `Button` sets `pointer` or `not-allowed` itself. An app that draws a
custom control should pick the system-shaped cursor rather than invent one.

## Context menus

`ContextMenu` (from `/primitives`) is a `Menu` anchored to the pointer, opened
from a node's `onPointerContext`:

```tsx
import { ContextMenu } from '@solid-multiplatform/platform/primitives';

const [at, setAt] = createSignal<Rect>();

<view onPointerContext={(point) => setAt({ ...point, width: 0, height: 0 })}>
  <text>Right-click me</text>
</view>;

<ContextMenu
  visible={() => at() !== undefined}
  point={() => at() ?? { x: 0, y: 0, width: 0, height: 0 }}
  items={[
    { label: 'Copy name', onSelect: copy },
    { label: 'Rename', onSelect: rename },
    // Destructive last, in the destructive colour.
    { label: 'Delete', destructive: true, onSelect: remove },
  ]}
  onRequestClose={() => setAt(undefined)}
/>;
```

What it adopts from
[Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus):

- a secondary click is the pointer's reveal; Control-click and a trackpad
  secondary click arrive as the same event on the hosts;
- the nearest `onPointerContext` from the point is used, and a disabled
  control stops the search instead of letting a container answer for it;
- unavailable items are hidden, not dimmed (a regular `Menu` still dims them,
  as [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)
  asks);
- destructive items carry `destructive` and belong at the end;
- Up/Down move, Enter chooses, Escape or a click outside closes, and focus
  returns to what had it before the menu opened;
- on the web host, Shift+F10 and the keyboard's ContextMenu key open the
  focused control's menu, so the feature is not mouse-only.

One level of submenu, previews, separators and item icons are not part of the
primitive yet. An app that keeps its commands in a regular menu or toolbar as
well (Apple asks for that) gets them through the same `MenuItem` shape.

## Wheel and page scrolling

The wheel is normalised once, where the host's event arrives:
`normalizeWheelDelta` keeps pixel deltas, converts line deltas (the platform's
"one notch is a line") to 16 units, and page deltas to the visible size. Web
pointer binding, `useMouse` and the focus-based lists all use it. The
platform's own momentum is carried by those events; the framework adds no
smoothing animation of its own, so a trackpad keeps its native feel
([Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views)).

`Column` and `Row` (and `VirtualColumn`/`VirtualRow`) consume the wheel in
whole item slots. Their scroll model follows the selected row, so a wheel
step moves the selection by a row, like Up/Down; the accumulator keeps small
trackpad deltas from losing their fraction. At either end the wheel is passed
to the containing list. PageUp/PageDown move by the number of rows the list
shows. A list with `scroll="none"` leaves the wheel to its ancestors.

## Tooltips

`createTooltip` supplies the show/dismiss rules for a control and `Tooltip`
draws the hint:

```tsx
const tip = createTooltip({ delay: 500 });
<view {...tip.trigger} />;
<Tooltip visible={tip.visible} anchor={rect} label="Save" />;
```

Hover waits for the delay, keyboard focus shows at once, leaving or blurring
hides, and Escape dismisses. There is no auto-hide timer: while the hint is
visible the scene schedules nothing. This follows
[Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)
and the expansion-tooltip note in
[Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields).

## Text selection and copy

`<Text selectable>` selects with a pointer drag (double click selects a word),
shows the I-beam, and copies with Control+C on other platforms or Command+C on
Apple keyboards. Text fields have the same clipboard shortcuts through the
host editor. The selection is drawn by the scene and the copy goes through the
host's `clipboard` service; a host without one logs and copies nothing.

## Keyboard shortcuts and focus

`createShortcuts` (from `/shortcuts`) listens where the host's `keyEvents`
service delivers keys, so it works on the web and in the desktop window; `Mod`
is Command on an Apple keyboard and Control elsewhere. Tab and Shift+Tab move
through the scene's focus stops. A pointer press focuses without drawing the
`$focus` ring (the `auto` policy, like `:focus-visible`); the next key turns it
on. These are the behaviours in
[Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards)
and [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos).

## Drag and drop

A press that leaves the tap slop starts the nearest `onPointerDrag` around it.
While a drag is active, Escape cancels it (the listener exists only for that
window) and the `cancel` phase reaches the handler. A drag does not also
click. Drag images, drop destinations and spring loading are not implemented
yet; see
[Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop).
Text selection wins over an enclosing drag because `SelectableText` has its
own `onPointerDrag`.

## What is not done yet

- A context menu on a text selection (an edit menu with Copy/Select All);
  the text field's platform editor still owns its own menu.
- Submenus, separators and icons in `ContextMenu`.
- Drag images, drop feedback and spring loading.
- The desktop runtime has no cursor-shape API yet, so `host-desktop`'s
  `desktopPointers()` implements no `setCursor`; the scene already passes the
  style, and the host will show it once the runtime exposes it.
- The desktop host does not bind Shift+F10 yet: its keys go through the
  runtime's key queue, and the pointer source has no key target.
