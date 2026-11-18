/**
 * The browser host: WebGL on a page element, DOM key events, pointer and
 * touch input, native text fields, and the browser viewport (size, safe area,
 * on-screen keyboard, colour scheme). Browser TVs use it with their own
 * `target`.
 */
import {
  RendererMain,
  type RendererMainSettings,
} from '@solid-multiplatform/renderer';
import type { SceneRenderer } from '@solid-multiplatform/renderer/contracts';
import type {
  HostContext,
  HostDefinition,
  HostRendererSettings,
} from '../host.js';
import { bindBrowserViewport } from '../sdk/browser-viewport.js';
import type { PlatformTarget } from '../sdk/capabilities.js';
import { browserEditorHost } from '../sdk/editor.js';
import { bindPointerEvents, createInputScope } from '../sdk/input.js';
import { installServices } from '../sdk/registry.js';
import { webServices } from './web-services/index.js';

export interface WebHostOptions {
  /** The element to draw in, or its id. Defaults to `app`. */
  root?: string | HTMLElement;
  target?: Extract<PlatformTarget, 'web' | 'tizen' | 'webos' | 'vizio'>;
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
      const removeServices = installServices(webServices);
      const stopViewport = bindBrowserViewport(surface);
      const pointer = createInputScope();
      const stopPointer = bindPointerEvents(surface, pointer, (x, y) => {
        const box = surface.getBoundingClientRect();
        return { x: x - box.left, y: y - box.top };
      });
      const release = () => {
        stopPointer();
        pointer.dispose();
        stopViewport();
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
          text: browserEditorHost(surface),
          loadFonts,
          createRenderer: (settings) => createRenderer(settings, surface),
        });
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
  return createWebHost(
    options,
    (settings, surface) =>
      new RendererMain(settings as RendererMainSettings, surface),
  );
}
