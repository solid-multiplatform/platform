/**
 * The browser host: WebGL on a page element, DOM key events, pointer and
 * touch input, an ARIA mirror of the scene for screen readers, native text
 * fields, and the browser viewport (size, safe area, on-screen keyboard,
 * colour scheme). Browser TVs use it with their own `target`, wrapped by
 * `tvHost` for the fixed TV stage and the remote.
 */
import {
  RendererMain,
  type RendererMainSettings,
} from '@solid-multiplatform/renderer';
import type { SceneRenderer } from '@solid-multiplatform/renderer/contracts';
import { registerDefaultShaders } from '../core/shaders.js';
import { Config, isDev } from '../core/config.js';
import type {
  HostContext,
  HostDefinition,
  HostRendererSettings,
} from '../host.js';
import { bindBrowserViewport } from '../sdk/browser-viewport.js';
import type { PlatformTarget } from '../sdk/capabilities.js';
import { resetCursor, setCursor } from '../sdk/cursor.js';
import { createBrowserHistory } from './web-history.js';
import { bindBackKey, createBackDispatcher } from '../sdk/shortcuts.js';
import { browserEditorHost } from '../sdk/editor.js';
import { bindPointerEvents, type PointerSource } from '../sdk/input.js';
import { installServices } from '../sdk/registry.js';
import { browserSemantics } from '../sdk/semantics.js';
import { webAppServices, webServices } from './web-services/index.js';

export interface WebHostOptions {
  /** The element to draw in, or its id. Defaults to `app`. */
  root?: string | HTMLElement;
  target?: Extract<PlatformTarget, 'web' | 'tizen' | 'webos' | 'vizio' | 'ps4'>;
  /**
   * Keeps this app's settings apart from other apps on the same origin.
   * Defaults to `app`.
   */
  namespace?: string;
  /**
   * Mouse, touch and pen input. On unless `false`; a remote-only build that
   * turns it off listens for no pointer events and never searches the scene
   * for one.
   */
  pointer?: boolean;
  /**
   * The ARIA mirror of the scene that screen readers read. On for `web` and
   * off for browser TVs unless set.
   */
  semantics?: boolean;
  /**
   * Replaces the browser viewport binding. A browser TV fits a fixed stage in
   * the window instead of following the element's size.
   */
  viewport?: (surface: HTMLElement) => WebViewport;
  /**
   * Warn in the console when a box is cut off or spills out of its panel.
   * Defaults to on in development and off in production. A release build can
   * turn it on explicitly to check a device; it walks once per layout batch,
   * never per frame.
   */
  layoutAudit?: boolean;
}

export interface WebViewport {
  /** Called once the renderer exists. */
  attach?(): void;
  dispose(): void;
}

/**
 * Leaving a browser TV. A plain page and the PS4 browser have no exit the
 * framework can perform, so they report it unavailable instead of pretending
 * `window.close` worked.
 */
function browserExit(
  target: Extract<PlatformTarget, 'web' | 'tizen' | 'webos' | 'vizio' | 'ps4'>,
): (() => void) | undefined {
  if (target === 'tizen') {
    const tizen = (
      globalThis as {
        tizen?: {
          application?: { getCurrentApplication?(): { exit?(): void } };
        };
      }
    ).tizen;
    const app = tizen?.application?.getCurrentApplication;
    if (app !== undefined) {
      return () => {
        try {
          app().exit?.();
        } catch {
          // The platform refused; nothing else can leave the app.
        }
      };
    }
  }
  if (target === 'webos') {
    const webos = (globalThis as { webOS?: { platformBack?(): void } }).webOS;
    if (webos?.platformBack !== undefined) {
      return () => {
        try {
          webos.platformBack?.();
        } catch {
          // Same: the launcher decides.
        }
      };
    }
  }
  return undefined;
}

/** The page element a web host draws in. */
export function webSurface(root: string | HTMLElement = 'app'): HTMLElement {
  const element =
    typeof root === 'string' ? document.getElementById(root) : root;
  if (!element) throw new Error(`No element with id "${String(root)}"`);
  return element;
}

/**
 * A web host around any backend that draws in a page element. `webHost` uses
 * WebGL; the legacy Canvas 2D host passes its own renderer.
 */
export function createWebHost(
  options: WebHostOptions,
  createRenderer: (
    settings: HostRendererSettings,
    surface: HTMLElement,
  ) => SceneRenderer,
  loadFonts?: HostContext['loadFonts'],
): HostDefinition<HTMLElement> {
  const target = options.target ?? 'web';
  return {
    target,
    launch(run) {
      const surface = webSurface(options.root);
      Config.layoutAudit = options.layoutAudit ?? isDev;
      // First: binding the viewport reads the colour scheme service.
      const removeServices = installServices({
        ...webServices,
        ...webAppServices(options.namespace ?? 'app'),
      });
      const viewport = options.viewport?.(surface) ?? {
        dispose: bindBrowserViewport(surface),
      };
      const semantics =
        (options.semantics ?? target === 'web')
          ? browserSemantics(surface)
          : undefined;
      // One point for every event: the scene reads it and keeps nothing.
      const point = { x: 0, y: 0 };
      const pointer: PointerSource | undefined =
        options.pointer === false
          ? undefined
          : {
              connect: (sink) =>
                bindPointerEvents(surface, sink, (x, y) => {
                  const box = surface.getBoundingClientRect();
                  point.x = x - box.left;
                  point.y = y - box.top;
                  return point;
                }),
              setCursor: (style) =>
                style === undefined ? resetCursor() : setCursor(style),
            };
      // One dispatcher beside the one history. Roku, Android, browser-TV and
      // PS4 all deliver Back here; the browser toolbar goes through the
      // router's traversal flag.
      const exit = browserExit(target);
      const back = createBackDispatcher(
        exit === undefined ? {} : { onExit: exit },
      );
      const releaseBack = bindBackKey(document, back);
      const release = () => {
        releaseBack();
        semantics?.dispose();
        viewport.dispose();
        removeServices();
      };
      let stop: () => void;
      try {
        stop = run({
          target,
          surface,
          native: surface,
          keys: document,
          pointer,
          semantics,
          text: browserEditorHost(surface),
          history: createBrowserHistory(),
          back,
          exit,
          loadFonts,
          createRenderer: (settings) => createRenderer(settings, surface),
        });
        viewport.attach?.();
      } catch (error) {
        release();
        throw error;
      }
      return () => {
        try {
          stop();
        } finally {
          release();
        }
      };
    },
  };
}

export function webHost(
  options: WebHostOptions = {},
): HostDefinition<HTMLElement> {
  return createWebHost(options, (settings, surface) => {
    const renderer = new RendererMain(
      settings as RendererMainSettings,
      surface,
    );
    // Rounded corners, borders, shadows and gradients are shaders of the
    // WebGL backend: an app started on this host draws them without asking.
    // Only `webHost` reaches this module's shader import; `createWebHost`
    // with another backend leaves it to the bundler to drop.
    registerDefaultShaders(renderer);
    return renderer;
  });
}
