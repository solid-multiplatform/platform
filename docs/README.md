# Solid Multiplatform

One SolidJS scene on Roku, browser TVs (Tizen, webOS, Vizio), Android and Android TV, iOS and tvOS, desktop and the web.

The scene is not DOM. You write `<view>`, `<text>`, `<Row>` and `<Column>` with Solid's reactivity; Solid's universal renderer turns them into nodes of a drawing backend: WebGL, Canvas 2D or Roku SceneGraph. A host supplies the surface, the keys and the device services for each platform.

```tsx
import { createSignal } from 'solid-js';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <view
      autofocus
      width={420}
      height={120}
      color={0x253040ff}
      onEnter={() => {
        setCount(count() + 1);
        return true;
      }}
    >
      <text x={24} y={36} fontSize={40}>
        {`Pressed ${count()} times`}
      </text>
    </view>
  );
}

startApp(webHost({ root: 'app' }), App, {
  renderer: { appWidth: 1920, appHeight: 1080 },
});
```

## The first rule

TV performance comes first: zero missed frames, and nothing scheduled while a scene is idle. See [Performance](/performance.md).

## Where the project is

This is pre-1.0 software and the repository is mid-restructure. The documentation says what is on `main` today.

- On `main`: the monorepo; a typed scene contract with a conformance suite that CI runs on the DOM, WebGL, Canvas and Roku backends; one flex engine; the host contract with `startApp`, implemented by the web and DOM hosts; a service registry with browser providers; the `solid-platform` CLI; release automation.
- In progress, in open pull requests: Roku verified on a physical TV, a desktop runtime in Rust that embeds Hermes, pointer and accessibility as framework features, native Android service providers.
- Not verifiable by this project today: physical Apple devices, Tizen, webOS and Vizio hardware, desktop on Windows and macOS, push notifications end to end.

The [feature matrix](/features.md) lists every feature per target with one of four statuses. A cell says `tested` only when it names an automated test that runs that feature on that target.

## Read next

- [Getting started](/getting-started.md): create an app with the CLI and build the web target.
- [Architecture](/architecture.md): packages, the three contracts, the frame loop.
- [Layout](/flow/layout.md), [Styling](/essentials/styling.md), [Focus and keys](/essentials/focus.md): writing UI.
- [Services](/services.md): device features behind one registry.
- [Add a host](/add-a-host.md) and [Add a renderer backend](/add-a-backend.md): bring up a new platform.
- [Targets](/targets/README.md): what each target is built from and how it is tested.
- [Migrating from the old names](/migrate.md): coming from `@lightningtv/solid` or `@solidtv/solid`.

## Packages

- `@solid-multiplatform/platform`: the JSX binding, layout, focus, primitives, services, hosts and the CLI.
- `@solid-multiplatform/renderer`: the scene contract and the drawing backends.
- `@solid-multiplatform/video`: optional playback adapters.

Licensed under Apache-2.0.
