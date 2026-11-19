# Starting an app

You write a Solid component tree made of `<view>` and `<text>`. A host draws it.
There are two ways to start it today.

## `startApp` with a host

`startApp(host, App, options)` declares the target's capabilities, builds the
host's renderer, loads fonts, wires keys to focus and renders. It calls
`useFocusManager` for you.

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const stop = startApp(
  webHost({ root: 'app' }),
  () => (
    <view width={1920} height={1080} color={0x101820ff}>
      <text x={90} y={70} fontSize={54}>
        Hello World
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

`webHost` draws with WebGL in the element whose id is `root` (default `app`).
`startApp` returns the host's disposer when it has one. Call it to tear the app
down.

The options are:

- `renderer`: renderer settings. Defaults to `Config.rendererOptions`.
- `fonts`: fonts to load. The download overlaps renderer start-up.
- `keyMap`: additions to the default key map.

## `createRenderer` directly

The app that `solid-platform init` generates does the same steps by hand. Use
this form when the CLI's generated entry file calls your `mount` function.

```tsx
import {
  Config,
  createRenderer,
  loadFonts,
} from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';

const fonts = loadFonts([
  {
    type: 'msdf',
    fontFamily: 'Lato',
    atlasUrl: './fonts/Lato-Regular.msdf.png',
    atlasDataUrl: './fonts/Lato-Regular.msdf.json',
  },
]);
Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };

const { render, renderer } = createRenderer();
void fonts.catch((error) => console.error(error));

const dispose = render(() => {
  useFocusManager();
  return <text>Hello World</text>;
});
```

`createRenderer(rendererOptions?, node?)` returns `{ renderer, rootNode, render }`.
`render` is not a top-level export; you get it from `createRenderer`. Call
`loadFonts` before `createRenderer` so the download starts early, and do not
`await` it before the renderer exists.

## `Config`

Set these before you start the app.

- `rendererOptions`: settings passed to the renderer when you do not pass your
  own.
- `fontSettings`: defaults for every `<text>`. Default
  `{ fontFamily: 'Ubuntu', fontSize: 100 }`.
- `animationSettings`: default transition settings. Default
  `{ duration: 250, easing: 'ease-in-out' }`.
- `animationsEnabled`: turns transitions on or off. It also reads the user's
  reduced-motion preference.
- `focusStateKey`: the state added to the focused element. Default `'$focus'`.
- `stateOrder`: see [States](/essentials/states.md).
- `throttleInput`: minimum time between handled key presses, in ms.
- `inferKeyRepeat`: for devices that never set `KeyboardEvent.repeat`.
- `preventDefaultOnHandledKeys`: calls `preventDefault()` on key events the app
  consumed. Default `false`.
- `taskDelay`: delay between scheduled tasks, in ms. See
  [Task scheduler](/essentials/taskscheduler.md).
- `fontWeightAlias`: maps weight names to numbers.
- `lockStyles`: default `true`.
- `debug`, `focusDebug`, `keyDebug`: logging switches. Default `false`.
- `domRendererEnabled`: use the DOM backend. It only has an effect in a build
  with the `SOLIDTV_DOM_RENDERING` define set to `true`. Unit tests use it.
- `convertToShader`: how effect props become a backend shader.

`SOLIDTV_DOM_RENDERING` and `SOLIDTV_DISABLE_SHADERS` are legacy names. They
will be renamed before 1.0.

## Renderer settings

Each backend reads the settings it knows. The WebGL backend reads, among others:

- `appWidth`, `appHeight`: the logical size you author in.
- `deviceLogicalPixelRatio`, `devicePhysicalPixelRatio`: see
  [Screen resolution](/essentials/screen_resolution.md).
- `clearColor`: background color, `0xRRGGBBAA`. Default `0` (transparent).
- `targetFPS`: frame cap. `0` or less (the default) is uncapped.
- `boundsMargin`: preload ring around the viewport in logical pixels. One number
  or `[top, right, bottom, left]`.
- `textureMemory`: texture memory thresholds.
- `fpsUpdateInterval`: sample interval in ms for the `fpsUpdate` and
  `renderUpdate` events. `0` (the default) samples nothing.
- `inspector`: the DOM inspector from `@solid-multiplatform/renderer/inspector`,
  or `false`. A production build ignores it.

`renderEngine` and `fontEngines` were removed. If you pass them you get one
warning and they are ignored.

## Renderer events

The WebGL renderer emits events. Subscribe with `renderer.on(event, handler)`.

```tsx
import { createRenderer } from '@solid-multiplatform/platform';

const { renderer, render } = createRenderer();

renderer.on('contextLost', () => {
  // The scene cannot recover in place. Reload to rebuild it.
  window.location.reload();
});

render(() => <App />);
```

- `contextLost`: the WebGL context was lost. The render loop stops.
- `outOfMemory`: the GPU reported out of memory. The renderer changes nothing
  itself. Lower `textureMemory.criticalThreshold`, store it, and reload.

With `startApp`, read the renderer with `getRenderer()` from
`@solid-multiplatform/platform`.
