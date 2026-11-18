// The desktop host: what the platform needs to run one Solid scene in the
// native runtime's window. `startApp(desktopHost(), App, { fonts })` is an
// app's whole start, as with the web host.
import {
  RendererMain,
  type RendererMainSettings,
} from '@solid-multiplatform/renderer';
import { setDefaultPlatform } from '@solid-multiplatform/renderer/platform';
import type { SceneRenderer } from '@solid-multiplatform/renderer/contracts';
import { bindColorScheme, getRenderer } from '@solid-multiplatform/platform';
import type { KeyEventTarget } from '@solid-multiplatform/platform';
import type {
  Disposer,
  HostContext,
  HostDefinition,
} from '@solid-multiplatform/platform/host';
import type { ControlSurface } from '@solid-multiplatform/platform/controls';
import type { EditorHost } from '@solid-multiplatform/platform/editor';
import { createInputScope } from '@solid-multiplatform/platform/input';
import type { InputKind } from '@solid-multiplatform/platform/capabilities';
import { installServices } from '@solid-multiplatform/platform/services';
import {
  updateViewport,
  zeroInsets,
} from '@solid-multiplatform/platform/viewport';
import { desktopEditors } from './editor.js';
import { onNative } from './events.js';
import type { FieldStyle } from './field.jsx';
import { KeySource, keyboardEvent } from './keys.js';
import { DesktopPlatform, windowMetrics } from './platform.js';
import { feedPointers } from './pointer.js';
import { primaryModifier } from './services/device.js';
import { desktopServices } from './services/manifest.js';

export interface DesktopHostOptions {
  /**
   * The app's id, as in `com.example.player`: letters, digits, `.`, `_` and
   * `-`. It names the app's settings file and its directories, and so keeps
   * them apart from other apps'. Defaults to `app`.
   */
  id?: string;
  /** The app's version, as `deviceInfo()` reports it. */
  version?: string;
  /** The window's title. */
  title?: string;
  /** How text fields look. */
  field?: FieldStyle;
}

/** The window an app draws in, as the scene sees it. */
export interface DesktopSurface {
  /** Scene units. */
  readonly width: number;
  readonly height: number;
  /** Pixels per scene unit. */
  readonly scale: number;
  setTitle(title: string): void;
}

const surface: DesktopSurface = {
  get width() {
    return windowMetrics().width;
  },
  get height() {
    return windowMetrics().height;
  },
  get scale() {
    return windowMetrics().scale;
  },
  setTitle: (title) => __solid.window!.setTitle(title),
};

function applyWindowSize(): void {
  const { width, height, scale } = windowMetrics();
  updateViewport({
    width,
    height,
    scale,
    // A desktop window has no cutouts or bars inside it and no on-screen
    // keyboard, and SDL does not report the system's motion preference.
    safeArea: zeroInsets,
    keyboardInset: 0,
    reducedMotion: false,
  });
}

/**
 * Runs `run` in the window and returns what ends it: the app's disposer,
 * then the host's own. Closing the window calls it and ends the process.
 */
export function launchDesktop(
  options: DesktopHostOptions,
  run: (context: HostContext<DesktopSurface>) => Disposer,
): Disposer {
  // Before anything reads the window: a run without one stops here.
  const metrics = windowMetrics();
  void metrics;
  setDefaultPlatform(DesktopPlatform);
  if (options.title !== undefined) surface.setTitle(options.title);

  const keys = new KeySource();
  // First: the colour scheme binding below reads its service.
  const removeServices = installServices(
    desktopServices({
      id: options.id ?? 'app',
      version: options.version,
      keys: keys as unknown as EventTarget,
    }),
  );
  // Before the app runs: its layout reads the viewport from its first line.
  applyWindowSize();
  const stopScheme = bindColorScheme();
  const pointer = createInputScope();
  const stopPointers = feedPointers(pointer);
  const editors = desktopEditors(pointer, primaryModifier(), options.field);

  let stopped = false;
  let stopApp: Disposer | undefined;
  const key = (native: SolidInputEvent): void => {
    const event = keyboardEvent(native);
    // A field that has the keyboard hears keys first, as an <input> does.
    if (!editors.handleKey(event)) keys.dispatchEvent(event);
  };
  const stops = [
    onNative('keydown', key),
    onNative('keyup', key),
    onNative('resize', applyWindowSize),
    // The window system dropped the window's contents: draw them again.
    onNative('expose', () =>
      (getRenderer() as SceneRenderer | undefined)?.requestRender(),
    ),
    // The user closed the window, or the system asked the app to end: the
    // app is disposed of, then the process ends.
    onNative('close', () => {
      try {
        stop();
      } finally {
        __solid.exit(0);
      }
    }),
  ];
  const release = (): void => {
    for (const stopListening of stops) stopListening();
    editors.dispose();
    stopPointers();
    pointer.dispose();
    stopScheme();
    removeServices();
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      stopApp?.();
    } finally {
      release();
    }
  };

  try {
    stopApp = run({
      target: 'desktop',
      surface,
      native: surface,
      keys: keys as unknown as KeyEventTarget,
      pointer,
      text: editors,
      createRenderer: (settings) =>
        // The second argument names a page element on the web; the adapter
        // draws in the window whatever it is.
        new RendererMain(settings as RendererMainSettings, 'app'),
    });
  } catch (error) {
    stopped = true;
    release();
    throw error;
  }
  return stop;
}

/**
 * The desktop host. Keyboard and mouse always; touch when a touch device is
 * attached as the app starts.
 */
export function desktopHost(
  options: DesktopHostOptions = {},
): HostDefinition<DesktopSurface> {
  return {
    target: 'desktop',
    get capabilities() {
      const inputs: InputKind[] = ['keyboard', 'mouse'];
      if (__solid.window?.hasTouch()) inputs.push('touch');
      return { inputs };
    },
    launch(run) {
      // Nothing is returned: the window ends the app, not the caller.
      launchDesktop(options, run);
    },
  };
}

/**
 * The surface `<Controls>` takes, for `TextField`, `SearchField` and
 * `TextArea` over the host's editors (`context.text`). The other controls
 * (`Button`, `Toggle`, `Slider`, …) are native widgets on phones; on the
 * desktop they are drawn by the app's scene, so `create` throws.
 */
export function desktopControls(text: EditorHost): ControlSurface {
  return {
    createEditor: (options) => text.createEditor(options),
    create(kind) {
      throw new Error(
        `Controls: "${kind}" is not implemented by the desktop host; draw it in the scene`,
      );
    },
  };
}
