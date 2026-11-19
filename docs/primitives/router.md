# Router

Routing uses [`@solidjs/router`](https://github.com/solidjs/solid-router). It
is a peer dependency of `@solid-multiplatform/platform`; an app created by
`solid-platform init` already has it.

The platform package adds `HashRouter`, a hash-based router without the
browser link handling that `@solidjs/router` installs for anchors.

```tsx
import { Route } from '@solidjs/router';
import { HashRouter } from '@solid-multiplatform/platform/primitives/router';

const Home = () => <text>Home</text>;
const Details = () => <text>Details</text>;
const NotFound = () => <text>Not found</text>;

export const Routes = () => (
  <HashRouter>
    <Route path="/" component={Home} />
    <Route path="/details/:id" component={Details} />
    <Route path="/*all" component={NotFound} />
  </HashRouter>
);
```

`Route`, `useNavigate`, `useParams` and the other router functions come from
`@solidjs/router`.

`HashRouter` reads and writes `window.location.hash` and uses
`window.history`. It needs a host that has them.

## Props

`HashRouter` accepts the `@solidjs/router` base router props (`root`,
`children`, `base`, …), plus:

| Prop          | Type       | Description                                                                        |
| ------------- | ---------- | ---------------------------------------------------------------------------------- |
| `forceProxy`  | `boolean`  | Build params and query objects without `Proxy`, as on engines that do not have it. |
| `queryParams` | `string[]` | The query parameter names your app reads. Needed when `Proxy` is not used.         |

When the JavaScript engine has no `Proxy`, the router falls back to plain
objects by itself. Route params are found from the route patterns. Query
parameters cannot be, so list them in `queryParams`.

## Caching routes

`KeepAliveRoute` keeps a route's nodes and state while you are on another
route. See [KeepAlive](/primitives/KeepAlive.md).
