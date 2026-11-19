/**
 * The host contract: what a platform supplies so that one Solid scene can run
 * on it. A host owns its process and surface lifecycle; `startApp` does the
 * rest the same way on every platform.
 *
 * Adding a platform means writing one `HostDefinition`. A new graphics model
 * also needs a backend in `@solid-multiplatform/renderer`.
 */
import { createComponent, type JSXElement } from 'solid-js';
import type { SceneRenderer } from '@solid-multiplatform/renderer/contracts';
import { HostScope } from './app/context.js';
import { Config } from './core/config.js';
import { isElementNode } from './core/utils.js';
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
import { createRenderer, rootNode } from './render.js';
import {
  setCapabilities,
  type PlatformCapabilities,
  type PlatformTarget,
} from './sdk/capabilities.js';
import type { EditorHost } from './sdk/editor.js';
import {
  createScenePointer,
  type PointerSource,
  type ScenePointerOptions,
} from './sdk/input.js';
import { attachSemantics, type SemanticsSink } from './sdk/semantics.js';

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
  /**
   * Pointer and touch input, where the platform has it. The host reports
   * where the pointer is; finding the node under it and telling a click from
   * a hold or a drag is the framework's part. A host without one pays
   * nothing for pointer support.
   */
  readonly pointer?: PointerSource;
  /**
   * Where the scene's accessibility semantics go, on a platform whose
   * assistive technology can read them. Without one the scene keeps none.
   */
  readonly semantics?: SemanticsSink;
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
  /**
   * How a pointer behaves, where the host has one: the hover and pressed
   * state names, focus on hover, hold time and drag slop.
   */
  pointer?: Omit<ScenePointerOptions, 'cursor'>;
}

/**
 * The input and output of a host that a scene is wired to, and what the app
 * reads with `useHost`: the target's name and the host's native root.
 */
export type HostWiring = Partial<
  Pick<HostContext, 'keys' | 'pointer' | 'semantics' | 'target' | 'native'>
>;

/**
 * Renders `app` with the renderer already chosen and wires it to `host`:
 * keys to focus, the pointer to the nodes under it, the scene's semantics to
 * the host's sink. Interactive nodes need no registration: see `sdk/input.ts`
 * for which nodes a pointer reaches and `sdk/semantics.ts` for what assistive
 * technology is told. `startApp` calls this; a host that has not moved to
 * `startApp` and installs its renderer itself calls it directly.
 */
export function mountApp(
  app: () => JSXElement,
  host: HostWiring = {},
  options: AppOptions = {},
): Disposer {
  const fonts = options.fonts ? loadFonts(options.fonts) : undefined;
  const { render } = createRenderer(options.renderer ?? Config.rendererOptions);
  // A missing font must not stop the app; text falls back when it can.
  fonts?.catch((error: unknown) => console.error('Font load failed', error));
  const before = rootNode.children.slice();
  // Released by hand and not by the render's owner: an app that throws while
  // rendering leaves no owner to dispose.
  const release: Disposer[] = [];
  const releaseAll = () => {
    while (release.length > 0) release.pop()!();
  };
  let dispose: Disposer;
  try {
    dispose = render(() => {
      useFocusManager(options.keyMap, host.keys);
      const source = host.pointer;
      if (source !== undefined) {
        const pointer = createScenePointer(rootNode, {
          ...options.pointer,
          cursor: source.setCursor && ((style) => source.setCursor!(style)),
        });
        release.push(() => pointer.dispose(), source.connect(pointer));
      }
      if (host.semantics !== undefined) {
        release.push(attachSemantics(rootNode, host.semantics));
      }
      return createComponent(HostScope.Provider, {
        value: host,
        get children() {
          return app();
        },
      });
    });
  } catch (error) {
    releaseAll();
    throw error;
  }
  return () => {
    dispose();
    releaseAll();
    // Disposing the render leaves its nodes in the root: take them out, so
    // that the next app on this root starts from an empty scene.
    for (const child of rootNode.children.slice()) {
      if (before.indexOf(child) !== -1) continue;
      rootNode.removeChild(child);
      if (isElementNode(child)) child.destroy();
    }
  };
}

/**
 * Runs `app` on `host`: declares the target's capabilities, builds the host's
 * renderer, loads fonts, wires keys, pointer and semantics and renders.
 * Nothing here runs per frame. Returns the host's own disposer when it has
 * one.
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
    let unmount: Disposer;
    try {
      unmount = mountApp(() => app(context), context, options);
    } catch (error) {
      setRendererFactory(undefined);
      throw error;
    }
    return () => {
      try {
        unmount();
        (getRenderer() as SceneRenderer | undefined)?.destroy();
      } finally {
        setRendererFactory(undefined);
      }
    };
  });
}
