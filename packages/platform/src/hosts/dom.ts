/**
 * The DOM host: the renderer package's DOM backend on a page element. It is
 * what unit tests run on in jsdom; it is not a production target.
 */
import {
  DOMRendererMain,
  configureDomRenderer,
  loadFontToDom,
  type DomRendererMainSettings,
} from '@solid-multiplatform/renderer/dom';
import { Config } from '../core/config.js';
import type { HostDefinition } from '../host.js';
import { createWebHost, type WebHostOptions } from './web.js';

export function domHost(
  options: WebHostOptions = {},
): HostDefinition<HTMLElement> {
  return createWebHost(
    options,
    (settings, surface) => {
      // The DOM backend reads font defaults from the live Config object.
      configureDomRenderer(Config);
      return new DOMRendererMain(settings as DomRendererMainSettings, surface);
    },
    async (fonts) => {
      for (const font of fonts) if ('fontUrl' in font) loadFontToDom(font);
    },
  );
}
