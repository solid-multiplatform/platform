import {
  RendererMain,
  CanvasRenderer,
  CanvasTextRenderer,
  type RendererMainSettings,
} from '@solid-multiplatform/renderer/canvas';
import { setRendererFactory } from '../core/lightningInit.js';
import { Config, defaultFontSettings } from '../core/config.js';
import type { FontLoadOptions } from '../core/intrinsicTypes.js';
import type { HostDefinition, HostRendererSettings } from '../host.js';
import { createWebHost, type WebHostOptions } from './web.js';

// The Canvas engine registers the system sans face at startup.
function useSystemFont() {
  if (
    Config.fontSettings === defaultFontSettings &&
    defaultFontSettings.fontFamily === 'Ubuntu'
  )
    Config.fontSettings = { ...defaultFontSettings, fontFamily: 'sans-serif' };
}

function createCanvasRenderer(
  settings: HostRendererSettings,
  options: Partial<RendererMainSettings>,
  root: string | HTMLElement,
) {
  const { appWidth, appHeight, deviceLogicalPixelRatio, boundsMargin } =
    settings || {};
  return new RendererMain(
    {
      appWidth,
      appHeight,
      deviceLogicalPixelRatio,
      devicePhysicalPixelRatio:
        settings && 'devicePhysicalPixelRatio' in settings
          ? settings.devicePhysicalPixelRatio
          : undefined,
      boundsMargin,
      ...options,
      renderEngine: CanvasRenderer,
      fontEngines: [CanvasTextRenderer],
    },
    root,
  );
}

const loadCanvasFonts = (scene: RendererMain, fonts: FontLoadOptions[]) =>
  Promise.all(
    fonts.map((font) =>
      'fontUrl' in font ? scene.stage.loadFont('canvas', font) : undefined,
    ),
  ).then(() => undefined);

export function useCanvas(options: Partial<RendererMainSettings> = {}) {
  useSystemFont();
  let scene: RendererMain;
  setRendererFactory(
    (settings, root) => {
      if (typeof root !== 'string' && !(root instanceof HTMLElement)) {
        throw new TypeError('Canvas requires an element or element ID.');
      }
      scene = createCanvasRenderer(settings, options, root);
      return scene;
    },
    (fonts) => loadCanvasFonts(scene, fonts),
  );
}

/**
 * The web host on the Canvas 2D backend, for browsers too old for WebGL 2:
 * the same keys, pointer, semantics and services as `webHost`.
 */
export function canvasHost(
  options: WebHostOptions = {},
  canvas: Partial<RendererMainSettings> = {},
): HostDefinition<HTMLElement> {
  useSystemFont();
  let scene: RendererMain;
  return createWebHost(
    options,
    (settings, surface) =>
      (scene = createCanvasRenderer(settings, canvas, surface)),
    (fonts) => loadCanvasFonts(scene, fonts),
  );
}
