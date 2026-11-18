/**
 * The host contract: what a platform supplies so that one Solid scene can run
 * on it. A host owns its process and surface lifecycle; `startApp` does the
 * rest the same way on every platform.
 *
 * Adding a platform means writing one `HostDefinition`. A new graphics model
 * also needs a backend in `@solid-multiplatform/renderer`.
 */
import type { JSXElement } from 'solid-js';
import type { SceneRenderer } from '@solid-multiplatform/renderer/contracts';
import { Config } from './core/config.js';
import {
  getRenderer,
  loadFonts,
  setRendererFactory,
  type RendererFactory,
} from './core/lightningInit.js';
import type { FontLoadOptions } from './core/intrinsicTypes.js';
import {
  useFocusManager,
  type KeyEventTarget,
  type KeyMap,
} from './core/focusManager.js';
import { createRenderer } from './render.js';
import {
  setCapabilities,
  type PlatformCapabilities,
  type PlatformTarget,
} from './sdk/capabilities.js';
import type { EditorHost } from './sdk/editor.js';
import type { InputScope } from './sdk/input.js';

export type Disposer = () => void;

/** Renderer settings an app passes; each backend reads the ones it knows. */
export type HostRendererSettings = Parameters<RendererFactory>[0];

/** What a host hands to the app once its drawing surface exists. */
export interface HostContext<Surface = unknown> {
  readonly target: PlatformTarget;
  /** The host's drawing surface: an element, a native view, a SceneGraph group. */
  readonly surface: Surface;
  /** Builds this host's scene backend on its surface. */
  createRenderer(settings: HostRendererSettings): SceneRenderer;
  /** Loads fonts when the backend does not take them through `loadFont`. */
  readonly loadFonts?: (fonts: FontLoadOptions[]) => Promise<void>;
  /** Remote, keyboard and gamepad keys, already in the platform's key names. */
  readonly keys: KeyEventTarget;
  /** Pointer and touch input, where the platform has it. */
  readonly pointer?: InputScope;
  /** Native text entry: IME, on-screen keyboard, autofill. */
  readonly text?: EditorHost;
  /** Whatever plugins on this target attach to (native root view, window). */
  readonly native?: unknown;
}

export interface HostDefinition<Surface = unknown> {
  readonly target: PlatformTarget;
  /** Departures from the target's default capabilities. */
  readonly capabilities?: Partial<Omit<PlatformCapabilities, 'target'>>;
  /**
   * Starts the platform and calls `run` once a surface exists. The host calls
   * the disposer `run` returns when the platform tears the app down (window
   * closed, activity destroyed, channel exited), and may call `run` again if
   * the platform recreates the surface. A host that can be stopped from code
   * returns a disposer of its own.
   */
  launch(run: (context: HostContext<Surface>) => Disposer): Disposer | void;
}

export interface AppOptions {
  /** Renderer settings; `Config.rendererOptions` when omitted. */
  renderer?: HostRendererSettings;
  /** Fonts to load; the download overlaps renderer start-up. */
  fonts?: FontLoadOptions[];
  /** Additions to the default key map. */
  keyMap?: Partial<KeyMap>;
}

/**
 * Runs `app` on `host`: declares the target's capabilities, builds the host's
 * renderer, loads fonts, wires keys to focus and renders. Nothing here runs
 * per frame. Returns the host's own disposer when it has one.
 */
export function startApp<Surface>(
  host: HostDefinition<Surface>,
  app: (context: HostContext<Surface>) => JSXElement,
  options: AppOptions = {},
): Disposer | void {
  return host.launch((context) => {
    setCapabilities(host.target, host.capabilities);
    setRendererFactory(
      (settings) => context.createRenderer(settings),
      context.loadFonts,
    );
    let dispose: Disposer | undefined;
    try {
      const fonts = options.fonts ? loadFonts(options.fonts) : undefined;
      const { render } = createRenderer(
        options.renderer ?? Config.rendererOptions,
      );
      // A missing font must not stop the app; text falls back when it can.
      fonts?.catch((error: unknown) =>
        console.error('Font load failed', error),
      );
      dispose = render(() => {
        useFocusManager(options.keyMap, context.keys);
        return app(context);
      });
    } catch (error) {
      setRendererFactory(undefined);
      throw error;
    }
    return () => {
      try {
        dispose?.();
        (getRenderer() as SceneRenderer | undefined)?.destroy();
      } finally {
        setRendererFactory(undefined);
      }
    };
  });
}
