// The NativeScript hosts as a `HostDefinition`: the phone and TV forms of
// Android and iOS supply keys, touch, text entry and services, and
// `startApp` runs the same scene on them as on every other target.
//
// A generated starter reaches this host through the target's bootstrap
// (`runAndroid`, `runAndroidTV`, `runIOS`, `runAppleTV`), which has already
// created the application window, the Canvas view, the key bridge and the
// touch scope. `host` carries those; the host adopts them and calls `run`
// with a `HostContext`. Launched with no established surface it creates the
// application, the root layout and the Canvas itself.
//
// There is no `document` here: keys come from the host's `KeyBridge`, touch
// from the host's input scope. Accessibility semantics are not supplied:
// Android's `AccessibilityNodeProvider` and UIKit's `UIAccessibility` would
// each need a real implementation, and a host that cannot do them right
// omits the sink rather than stubbing it.
import { RendererMain } from '@solid-multiplatform/renderer';
import { registerDefaultShaders } from '@solid-multiplatform/platform/shaders';
import { createBackDispatcher } from '@solid-multiplatform/platform';
import { createMemoryHistory } from './history.mjs';

/** The form a target uses, its platform target, and the input it delivers. */
const FORMS = {
  phone: {
    target: 'android',
    inputs: ['touch'],
    android: true,
    form: 'phone',
    device: 'android',
  },
  tv: {
    target: 'android-tv',
    inputs: ['remote'],
    android: true,
    form: 'tv',
    device: 'android-tv',
  },
  ios: {
    target: 'ios',
    inputs: ['touch'],
    android: false,
    form: 'phone',
    device: 'ios',
  },
  tvOS: {
    target: 'apple-tv',
    inputs: ['remote'],
    android: false,
    form: 'tv',
    device: 'apple-tv',
  },
};

/** The form's target, as `nativeHost` reads it. */
export function nativeFormOf(form) {
  const entry = FORMS[form];
  if (entry === undefined)
    throw new TypeError(
      'nativeHost: form must be phone, tv, ios or tvOS, not ' + String(form),
    );
  return entry;
}

/**
 * `HostDefinition` for a NativeScript form. `host`, when given, is the
 * established surface a target bootstrap already created: `canvas`, `root`,
 * `keys`, `input` and `text`. Without one the host creates the application
 * and Canvas as it launches.
 */
export function nativeHost(options = {}) {
  const form = nativeFormOf(options.form);
  const established =
    options.host !== undefined || options.surface !== undefined;
  return {
    target: form.target,
    capabilities: { inputs: form.inputs },
    launch(run) {
      return established
        ? launchEstablished(form, options, run)
        : launchApplication(form, options, run);
    },
  };
}

/** Draws on the surface the target's bootstrap already made. */
function launchEstablished(form, options, run) {
  const host = options.host ?? {};
  const surface = options.surface ?? host.canvas ?? options.canvas;
  if (surface === undefined)
    throw new Error('nativeHost: no Canvas surface to draw on');
  // The bootstrap may have made the dispatcher the hardware Back button
  // already drives; otherwise this host owns one.
  const exit = options.exit ?? host.exit;
  const back =
    options.back ??
    host.back ??
    createBackDispatcher(exit === undefined ? {} : { onExit: exit });
  const stop = run({
    target: form.target,
    surface,
    native: host.root ?? options.root,
    // The renderer the bootstrap's TvPlatform would build anyway: the same
    // WebGL backend, drawing into the Canvas `bindCanvas` registered. No
    // `target` is passed: a NativeScript Canvas is in the layout already and
    // has no DOM `appendChild`, which a target would call.
    createRenderer: (settings) => {
      // Rounded corners, borders, shadows and gradients are shaders of the
      // WebGL backend; an app on this host draws them without asking.
      const renderer = new RendererMain(settings);
      registerDefaultShaders(renderer);
      return renderer;
    },
    keys: options.keys ?? host.keys,
    // `createInputScope` is a `PointerSource`: the target's touch binding
    // feeds it before the scene connects it. No gestures live in the host.
    pointer: options.pointer ?? host.input,
    text: options.text ?? host.text,
    // The bootstrap's history, when it made one; otherwise a stack this host
    // owns. The router never reads `window.history` here.
    history: options.history ?? host.history ?? createMemoryHistory(),
    back,
    exit,
    // No `semantics`: see the file comment.
  });
  return () => {
    stop?.();
  };
}

/**
 * Creates the NativeScript application, its root layout and the Canvas.
 * The application module is loaded lazily: it imports the NativeScript
 * runtime, which this host module must not need (tests and the package
 * build import `nativeHost` itself).
 */
function launchApplication(form, options, run) {
  let stopped = false;
  let stop;
  void import(/* @vite-ignore */ './application.mjs')
    .then(({ launchApplication: launch }) => {
      if (!stopped) stop = launch(form, options, run);
    })
    .catch((error) => console.error('Native host startup failed', error));
  return () => {
    stopped = true;
    stop?.();
  };
}
