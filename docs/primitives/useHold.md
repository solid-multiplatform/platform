# useHold

`useHold` tells a tap from a press-and-hold on one key. It returns two key
handlers: one for the press and one for the release.

```tsx
import { useHold } from '@solid-multiplatform/platform/primitives';

export const Tile = (props: { open: () => void; menu: () => void }) => {
  const [holdEnter, releaseEnter] = useHold({
    onEnter: props.open,
    onHold: props.menu,
    holdThreshold: 500,
  });

  return <view onEnter={holdEnter} onEnterRelease={releaseEnter} autofocus />;
};
```

## Options

- `onEnter` (required): called for a tap.
- `onHold` (required): called once the key has been held for `holdThreshold`.
- `onRelease`: called when the key is released after a hold.
- `holdThreshold` (`number`, default `500`): milliseconds before a press
  counts as a hold.
- `performOnEnterImmediately` (`boolean`, default `false`): call `onEnter` on
  key-down. A long press then calls both `onEnter` and `onHold`.
- `holdRequiresRepeat` (`boolean`, default `true`): a hold must be confirmed
  by an auto-repeat key-down. See below.

Each callback receives what a key handler receives: the event that began the
press, the element whose handler ran, and the focused element.

## How a press resolves

- Key-down starts a timer.
- Key-up before the timer ends: a tap. `onEnter` is called at once.
- An auto-repeat key-down arrives and the timer ends: a hold. `onHold` is
  called.
- Neither key-up nor auto-repeat arrives by the threshold: a tap, by default.
  This keeps taps working on remotes that never send key-up for a key. With
  `holdRequiresRepeat: false` this case is a hold instead.

The timer exists only while a key is down.

## Pass the event through

The press handler reads `e.repeat`. Used directly as a key handler it receives
the event. If you wrap it, forward every argument. A wrapper that drops the
event can never detect a hold.

## The press handler stops propagation

The press handler returns `true`, so handlers for that key on ancestors do not
run. Whether the press was a tap is known only later, after propagation is
over. If an ancestor must act on a tap, call it from your `onEnter`.

## Holds that move focus

A hold often moves focus while the key is still down, for example to open a
menu. The device keeps sending auto-repeats, and those would reach whatever
now has focus. Once `onHold` fires, `useHold` tells the focus manager to drop
further repeats of that key until it is released. `onRelease` is still called.

The same mechanism is available without `useHold`:

```ts
import { suppressKeyUntilRelease } from '@solid-multiplatform/platform/primitives';

export function swallowRepeats(event: KeyboardEvent) {
  suppressKeyUntilRelease(event, () => console.log('key released'));
}
```

Pass the event rather than a key name. A key is then matched on both its `key`
and its `keyCode`, which matters on devices that report a different `key` on
key-up.

## Keys that cannot report a hold

A hold is detected from what the device sends between press and release.

- Auto-repeat key-downs: a hold is detectable. This is the default path.
- Key-up only on real release, no auto-repeat: detectable with
  `holdRequiresRepeat: false`.
- Key-up sent at press time: not detectable. A tap and a hold produce the same
  events.
- Auto-repeat without the `repeat` flag: set `Config.inferKeyRepeat`, described
  in [useFocusManager](/primitives/useFocusManager.md).

Behavior differs by key and by device. This project has no automated test of
`useHold` on TV hardware. Log the raw events on your device before you rely on
a hold:

```tsx
export const KeyLogger = () => (
  <view
    autofocus
    onCaptureKey={(e) => {
      console.log('down', e.key, e.keyCode, e.repeat, performance.now());
    }}
    onCaptureKeyRelease={(e) => {
      console.log('up', e.key, e.keyCode, performance.now());
    }}
  />
);
```

If the `up` line appears when you press rather than when you let go, that key
cannot report a hold.
