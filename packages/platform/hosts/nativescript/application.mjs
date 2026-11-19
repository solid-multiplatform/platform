// Creates the NativeScript application and calls the host on its Canvas.
// Loaded only by `nativeHost.launch` when no target bootstrap has made a
// surface, so the host module itself stays importable where there is no
// NativeScript runtime.
import { RendererMain } from '@solid-multiplatform/renderer';
import { registerDefaultShaders } from '@solid-multiplatform/platform/shaders';
import { createBackDispatcher } from '@solid-multiplatform/platform';
import { createMemoryHistory } from './history.mjs';

/** Runs `run` on a Canvas this module creates. Returns how to stop. */
export function launchApplication(form, options, run) {
  let stopped = false;
  let stop;
  let teardown = () => {};

  const create = async (root, canvas) => {
    if (stopped) return;
    const [ns, viewport, touch, editors, registry, providers] =
      await Promise.all([
        import('@solid-multiplatform/platform/nativescript'),
        import('./viewport.mjs'),
        import('./touch.mjs'),
        import('./editors.mjs'),
        import('@solid-multiplatform/platform/services'),
        form.android
          ? import('./providers/android/manifest.ts')
          : import('./providers/apple/manifest.ts'),
      ]);
    if (stopped) return;
    ns.installShims();
    ns.bindCanvas(canvas);
    const bridge = new ns.KeyBridge();
    const services = form.android
      ? providers.androidServices({
          form: form.form,
          app: Application.android,
          // The bridge is where the host raises keys: the shortcut service
          // listens there instead of on a fake `document`.
          keyTarget: form.target === 'android-tv' ? bridge : undefined,
        })
      : providers.appleServices({ form: form.form });
    const releases = [];
    releases.push(registry.installServices(services));
    releases.push(viewport.bindMobileViewport(root, form.target));
    if (form.target === 'ios') root.ios.overrideUserInterfaceStyle = 2;
    const text = editors.nativeEditorHost(root, form.target);
    const history = options.history ?? createMemoryHistory();
    // A TV's hardware Back and the phone's hardware Back both report here.
    const exit = form.android
      ? () => {
          try {
            Application.android.foregroundActivity?.finish?.();
          } catch {
            // The activity is already gone.
          }
        }
      : undefined;
    const back = createBackDispatcher(
      exit === undefined ? {} : { onExit: exit },
    );
    let pointer;
    if (form.inputs.includes('touch')) {
      const binding = touch.bindSceneTouch(canvas, form.device);
      // The scope is the scene's `PointerSource`; the binding feeds it.
      pointer = binding.input;
      releases.push(binding.dispose);
    }
    if (form.target === 'android-tv') {
      const [{ bindAndroidCanvas }, { bindAndroidInput }] = await Promise.all([
        import('../android-tv/platform.android.ts'),
        import('../android-tv/input.android.ts'),
      ]);
      bindAndroidCanvas(canvas, true);
      releases.push(bindAndroidInput(bridge, canvas.android, history, back));
    } else if (form.target === 'apple-tv') {
      const remote = ns.bindRemote(bridge, Application.ios.window);
      releases.push(remote.unbind);
    }
    if (stopped) {
      while (releases.length > 0) releases.pop()();
      return;
    }
    teardown = () => {
      while (releases.length > 0) {
        try {
          releases.pop()();
        } catch (error) {
          console.error('Native host cleanup failed', error);
        }
      }
    };
    stop = run({
      target: form.target,
      surface: canvas,
      native: root,
      // `bindCanvas` above registered the Canvas with TvPlatform, whose
      // `createCanvas` the renderer uses; no DOM target is passed.
      createRenderer: (settings) => {
        // Rounded corners, borders, shadows and gradients are shaders of the
        // WebGL backend; an app on this host draws them without asking.
        const renderer = new RendererMain(settings);
        registerDefaultShaders(renderer);
        return renderer;
      },
      keys: bridge,
      pointer,
      text,
      // The router's stack, owned by the host: nothing here shims a browser.
      history,
      back,
      exit,
    });
  };

  void (async () => {
    const { Application, Color, GridLayout } =
      await import('@nativescript/core');
    const { Canvas } = await import('@nativescript/canvas');
    Application.run({
      create() {
        const root = new GridLayout();
        // iOS screen bounds already include the viewport's safe insets.
        if (form.target === 'ios') root.iosIgnoreSafeArea = true;
        root.backgroundColor = new Color('#000000');
        const canvas = options.createCanvas
          ? options.createCanvas()
          : new Canvas();
        canvas.width = '100%';
        canvas.height = '100%';
        canvas.iosOverflowSafeArea = true;
        canvas.once('ready', () => {
          create(root, canvas).catch((error) =>
            console.error('Native host startup failed', error),
          );
        });
        root.addChild(canvas);
        return root;
      },
    });
  })().catch((error) => console.error('Native host startup failed', error));

  return () => {
    stopped = true;
    try {
      stop?.();
    } finally {
      teardown();
    }
  };
}
