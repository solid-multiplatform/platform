# Add a host

A host is what a platform supplies so that one scene can run on it. Adding a platform means writing one `HostDefinition`. If the platform also has a new graphics model, it needs a renderer backend too: see [Add a renderer backend](/add-a-backend.md).

The contract is `packages/platform/src/host.ts`, exported as `@solid-multiplatform/platform/host`. The worked example on this page is the browser host, `packages/platform/src/hosts/web.ts`.

## The contract

```ts
export interface HostDefinition<Surface = unknown> {
  readonly target: PlatformTarget;
  readonly capabilities?: Partial<Omit<PlatformCapabilities, 'target'>>;
  launch(run: (context: HostContext<Surface>) => Disposer): Disposer | void;
}

export interface HostContext<Surface = unknown> {
  readonly target: PlatformTarget;
  readonly surface: Surface;
  createRenderer(settings: HostRendererSettings): SceneRenderer;
  readonly loadFonts?: (fonts: FontLoadOptions[]) => Promise<void>;
  readonly keys: KeyEventTarget;
  readonly pointer?: InputScope;
  readonly text?: EditorHost;
  readonly native?: unknown;
}
```

The host owns the process and the surface lifecycle. `startApp(host, app, options)` does the rest: it calls `host.launch`, and inside `run` it declares the capabilities, installs the host's renderer factory, starts font loading, creates the renderer, wires `context.keys` to the focus manager and renders `app(context)`.

## What a host must supply

1. **A target.** `target` is a `PlatformTarget` from `src/sdk/capabilities.ts`: `web`, `tizen`, `webos`, `vizio`, `roku`, `android`, `android-tv`, `ios`, `apple-tv` or `desktop`. Each has default capabilities (input kinds, colour scheme, insets, haptics). Set `capabilities` only for departures from the defaults. A new platform needs a new entry in that file.
2. **A surface.** Whatever the backend draws on: a page element, a native view, a SceneGraph group. Call `run` only once it exists.
3. **A renderer.** `createRenderer(settings)` returns a `SceneRenderer` for the surface. Reuse an existing backend if the platform gives you WebGL or a 2D canvas.
4. **Keys.** `keys` is a `KeyEventTarget`: an object with `addEventListener` and `removeEventListener` for `keydown` and `keyup`. Deliver remote, keyboard and gamepad keys through it, already in the platform's key names. The app maps names to actions with `options.keyMap`.
5. **Teardown.** `run` returns a disposer. Call it when the platform tears the app down (window closed, activity destroyed, channel exited). You may call `run` again if the platform recreates the surface. If your host can be stopped from code, return a disposer from `launch`.

Optional:

- `loadFonts`, when the backend does not take fonts through `loadFont`.
- `pointer`, an `InputScope` from `src/sdk/input.ts`, when the platform has a pointer or touch.
- `text`, an `EditorHost` from `src/sdk/editor.ts`, for native text entry.
- `native`, whatever plugins on this target attach to.

A host also installs its service providers. Do it in `launch`, before `run`, and remove them in the disposer. See [Services](/services.md).

## Worked example: the web host

`createWebHost(options, createRenderer, loadFonts?)` builds a host around any backend that draws in a page element. `webHost` passes the WebGL renderer; `domHost` passes the DOM test backend.

This is what its `launch` does, in order:

1. Finds the surface: `webSurface(options.root)` returns the element, or throws if there is none.
2. Installs services: `installServices({ ...webServices, ...webAppServices(namespace) })`. This comes first because binding the viewport reads the colour scheme service.
3. Binds the viewport: `bindBrowserViewport(surface)` reports size, safe area, on-screen keyboard and colour scheme.
4. Creates pointer input: `createInputScope()` and `bindPointerEvents(surface, pointer, toLocal)`, which converts page coordinates to surface coordinates.
5. Calls `run` with the context: `keys: document`, `pointer`, `text: browserEditorHost(surface)`, `native: surface`, and `createRenderer: (settings) => createRenderer(settings, surface)`.
6. If `run` throws, releases everything it set up and rethrows.
7. Returns a disposer that calls the disposer `run` returned, then releases pointer, viewport and services, in that order, even if the app's disposer throws.

Everything is set up once. Nothing in the host runs per frame, and nothing polls.

An app uses it like this:

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const stop = startApp(
  webHost({ root: 'app', target: 'tizen', namespace: 'living-room' }),
  (host) => (
    <view width={1920} height={1080}>
      <text x={90} y={70} fontSize={54}>
        {host.target}
      </text>
    </view>
  ),
  {
    renderer: { appWidth: 1920, appHeight: 1080 },
    fonts: [
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasUrl: './fonts/Lato-Regular.msdf.png',
        atlasDataUrl: './fonts/Lato-Regular.msdf.json',
      },
    ],
  },
);
```

## Step by step

1. Add the target to `PlatformTarget` and its defaults in `src/sdk/capabilities.ts`, if it is new.
2. Write `src/hosts/<name>.ts` exporting a function that returns a `HostDefinition`. Start from `createWebHost`.
3. Bind input. Translate the platform's key events into `keydown`/`keyup` on an object you pass as `keys`. Bind pointer events to an `InputScope` if the platform has a pointer.
4. Install the platform's service providers in `launch`. A service you do not provide is reported `unavailable`; do not stub it.
5. Release everything in the disposer, and on the error path.
6. Test it. `tests/host/start-app.test.tsx` runs `startApp` on `domHost` and checks capabilities, focus, services and teardown; copy its shape. Then add a test that runs on the real target, or the feature stays `preview` in the [feature matrix](/features.md).
7. Export the host as a subpath in `packages/platform/package.json`, as `./host/web` is.
8. To build apps for it with the CLI, add the target to `available` in `cli/files.mjs`, a template directory for `init`, and a branch in `cli/build.mjs`. See the CLI target contract in [Architecture](/architecture.md).

## Rules

- No timers, polling or listeners that fire while the scene is idle.
- No fake `document` or `window`. A host that has no DOM passes its own `KeyEventTarget` and surface.
- A difference between platforms is handled in the host or the backend, never by branching on the target in `src/core`.

## Targets not on the contract yet

`webHost` and `domHost` are the only hosts on `main` that implement `HostDefinition`. Android, Apple and Roku still start through their own entry points under `hosts/`, and the CLI generates its own start-up code. A desktop runtime written in Rust that embeds Hermes is in progress in an open pull request; the Node-based desktop host on `main` is being replaced by it.
