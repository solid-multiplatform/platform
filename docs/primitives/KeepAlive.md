# KeepAlive

`KeepAlive` and `KeepAliveRoute` keep a component's nodes and state after it
leaves the tree. When it comes back, it is shown as it was: same position, same
focused element, same data.

Both are exported from `@solid-multiplatform/platform/primitives/router`.
`KeepAliveRoute` needs `@solidjs/router`.

## Caching a route

`KeepAliveRoute` wraps the `<Route>` of `@solidjs/router`.

```tsx
import { Route } from '@solidjs/router';
import {
  HashRouter,
  KeepAliveRoute,
} from '@solid-multiplatform/platform/primitives/router';
import { Browse } from './pages/Browse';
import { Details } from './pages/Details';

export const Routes = () => (
  <HashRouter>
    <KeepAliveRoute id="browse" path="/browse/:filter" component={Browse} />
    <Route path="/details/:id" component={Details} />
  </HashRouter>
);
```

When the route is left, the focused element is remembered. When the route is
shown again, focus returns to that element.

## Stopping effects while cached

A cached route is hidden but its reactive scope is alive. Effects that read
global signals keep running. `KeepAliveRoute` passes an `isAlive` accessor to
the component and to `preload`. Return early when it is `false`.

```tsx
import { createEffect, type Accessor } from 'solid-js';

export const Browse = (props: { isAlive: Accessor<boolean> }) => {
  createEffect(() => {
    if (!props.isAlive()) return;
    console.log('Browse is on screen');
  });

  return <view />;
};
```

## Props

`KeepAliveRoute` takes the `<Route>` props, plus:

- `id` (`string`): the cache key. Defaults to `path`.
- `shouldDispose` (`(key: string) => boolean`): return `true` to drop the
  cached copy and build the route again on the next visit.
- `onRemove`, `onRender`, `transition`: set on the wrapper view. By default the
  wrapper's `alpha` goes to `0` on removal and to `1` on render.

`KeepAliveRoute` reads its props once, the first time it runs for a key. Later
changes to them are ignored until you call `clearKeepAliveRouteCache()`.

`KeepAlive` caches its children without a route:

- `id` (`string`, required): the cache key.
- `shouldDispose`, `onRemove`, `onRender`, `transition`: as above.

## Removing cached entries

Routes and plain `KeepAlive` entries are stored separately.

```ts
import {
  removeKeepAlive,
  removeKeepAliveRoute,
  clearKeepAlive,
  clearKeepAliveRoute,
} from '@solid-multiplatform/platform/primitives/router';

removeKeepAliveRoute('browse'); // one cached route
removeKeepAlive('player-overlay'); // one <KeepAlive id="player-overlay">
clearKeepAliveRoute(); // every cached route
clearKeepAlive(); // every <KeepAlive>
```

Removing an entry destroys its nodes and disposes its reactive scope.
