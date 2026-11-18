export * as browserHost from '../core/dom-renderer/domRenderer.js';
import {
  RendererMain,
  type RendererMainSettings,
  prefetchFont,
} from '@solid-multiplatform/renderer';

export { prefetchFont };
export function createDefaultRenderer(
  settings: RendererMainSettings,
  root: object | string,
) {
  if (typeof root !== 'string' && !(root instanceof HTMLElement)) {
    throw new TypeError('A native root requires a host renderer factory.');
  }
  return new RendererMain(settings, root);
}
