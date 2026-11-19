# Screen history and keyed focus

`createScreenHistory` is the framework's Back stack for an app with routes.
The host's history stays the source of truth for location and traversal; the
screen history keeps a session-local snapshot of each screen and restores the
focus that screen had, by key.

Use it on top of `HashRouter`; `createNavigation` has its own synchronous
stack and is not compatible with tracked routes.

```tsx
import {
  createScreenHistory,
  HashRouter,
  Route,
} from '@solid-multiplatform/platform/app';

const history = createScreenHistory<{ scroll: number }>({
  capture: () => ({ scroll: listRef()?.lng.y ?? 0 }),
  // Back and Forward always remount and call this. A stale entry expects you
  // to revalidate (bypass a query cache when needed).
  restore: async (entry, { signal }) => {
    const items = await fetchItems({ signal, fresh: entry.stale });
    if (items === undefined) return 'gone'; // the whole screen vanished
    setItems(items);
  },
  fallbackPath: '/',
  onBackEmpty: 'confirm-exit',
});

history.push('/detail/42', { tab: 'cast' });
```

`capture` runs once before every `push`, `back` and `forward`. `replace`
discards the screen it replaces. Push truncates anything ahead, so `forward()`
after a push does nothing. The snapshot (`T`) is app-owned data; never store a
component, element or node in it.

## Back

One dispatcher owns Back on every host:

1. **Work in flight** — handlers registered with
   `dispatcher.push(fn, { beforeFocus: true })` run first, most recent first. A
   pending stream or admission can consume Back while cancelling itself.
2. **The focus path** — one synthetic mapped `Back` goes through the focused
   element's ancestors. A `Modal`/`Sheet` closes; a player's chrome exits
   fullscreen. A handler returning `true` consumes the press.
3. **Screen history** — otherwise `history.back()` runs exactly once.
4. **The root** — `onBackEmpty` chooses: `'exit'` (the host's exit action where
   it has one), `'confirm-exit'` (one shared `Alert` rendered by the generated
   app shell; Back while it is open only cancels), or a function.

Hosts construct one dispatcher beside the history and expose it as
`HostContext.back`. Roku's Back, Android's hardware Back, a browser TV's Back
key and the PS4 cancel button all call it. A browser toolbar/gesture Back
enters `HashRouter` with a traversal flag: a focus handler that consumes the
press makes the router compensate with `go(-delta)`; otherwise the moved
location is accepted. Exit exists on Roku, Android and Tizen/webOS; plain web
and PS4 report it unavailable instead of pretending `window.close` worked.

## Keyed focus

Containers take `focusKey`; data lists take `itemKey`. Focus is captured as a
path of keys, outermost first, and restored by walking that path against the
freshly mounted screen. An index is never captured and is never restored.

```tsx
<Row focusKey="rails">
  <List each={rails()} itemKey={(rail) => rail.id} focusKey="rail-cards">
    {(rail) => (
      <Row focusKey="actions">
        <view focusKey="play" role="button" onEnter={play} />
      </Row>
    )}
  </List>
</Row>
```

- `focusKey` belongs on focusable containers and on plain children; lists
  register their items automatically through `itemKey`.
- A list rebuilds its key → index map only when `each` changes. When the item
  is outside a virtual window, restore tells the list which key to bring into
  view and focuses that item once it mounts.
- When the key is missing (an item was deleted, or the screen changed shape),
  restore leaves the screen's declared `autofocus` element focused. A missing
  card is not `'gone'`.
- Duplicate keys are a development error.
- A network screen should supply stable server IDs. `restore` awaits the
  request and commits the new `each` before resolving; post-mutation focus then
  applies the key path.

## Errors and resets

A restore that rejects keeps the destination current, marks the entry stale and
sets `status` to `{ phase: 'error', error }`. Back may abandon it; `retry()`
is input-driven and runs only from that state. Every restore carries an
`AbortSignal` and a sequence check: another navigation, a reset or `dispose`
aborts it, and a late resolution cannot change status or focus.

Returning `'gone'` clears the stack and resets to `fallbackPath`. `reset()`
starts a new history epoch: browser entries from before the reset cannot
restore an old screen. `invalidate(predicate?)` only flags entries; it starts
no request and no focus work.

Nothing here schedules while a screen is idle: no timers, retries, refetches or
observers; work happens on a press, a traversal, or an app-driven `push`.

## In an app

The generated entry forwards `history`, `back` and `exit` into `HostScope`;
`createScreenHistory` reads them, so app code keeps no target-specific Back
policy. An app that never calls `createScreenHistory` keeps the previous
behaviour of the host and the router.
