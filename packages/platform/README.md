# @solid-multiplatform/platform

The Solid JSX binding, flex layout, focus, UI primitives, device services, hosts and the `solid-platform` CLI of [Solid Multiplatform](https://github.com/solid-multiplatform/platform).

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const App = () => (
  <view width={1920} height={1080} color={0x101820ff}>
    <text x={90} y={70} fontSize={54}>
      Hello
    </text>
  </view>
);

startApp(webHost({ root: 'app' }), App, {
  renderer: { appWidth: 1920, appHeight: 1080 },
});
```

Compile JSX with Solid in universal mode and `moduleName: '@solid-multiplatform/platform'`. An app created with `solid-platform init` is configured that way.

## Entry points

- `@solid-multiplatform/platform`: `createRenderer`, `Config`, `ElementNode`, `loadFonts`, `activeElement` and Solid's control flow.
- `/primitives`: `Row`, `Column`, `Grid`, virtual and lazy lists and more. `/primitives/router`: the router bindings.
- `/host`: `startApp` and the `HostDefinition` contract. `/host/web` and `/host/dom`: the hosts that implement it.
- `/services`: the service registry. `/services/web`: the browser providers. Each SDK module has its own subpath, for example `/device`, `/media`, `/geolocation`, `/theme`.
- `/focusManager`, `/shaders`, `/devtools`.
- `/roku`, `/android`, `/android-tv`, `/ios`, `/apple-tv`, `/browser-tv`: per-target hosts. They do not implement `HostDefinition` yet.

The package also carries the `solid-platform` CLI (`cli/`).

## Status

Pre-1.0. What is tested on which target is in the [feature matrix](../../docs/features.md). The documentation is in [docs/](../../docs/README.md).

Some names from the project's earlier life are still in the code and will be renamed before 1.0: the `SOLIDTV_DOM_RENDERING` and `SOLIDTV_DISABLE_SHADERS` build defines, the `@solidtv/source` import condition and `ElementNode.lng`.

[Source records](PROVENANCE.md)
