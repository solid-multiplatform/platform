import {
  RendererMain,
  CanvasRenderer,
  CanvasTextRenderer,
  type RendererMainSettings,
} from '@solid-multiplatform/renderer/canvas';
import { setRendererFactory } from '../core/lightningInit.js';
import { Config, defaultFontSettings } from '../core/config.js';

export function useCanvas(options: Partial<RendererMainSettings> = {}) {
  // The Canvas engine registers the system sans face at startup.
  if (
    Config.fontSettings === defaultFontSettings &&
    defaultFontSettings.fontFamily === 'Ubuntu'
  )
    Config.fontSettings = { ...defaultFontSettings, fontFamily: 'sans-serif' };
  let scene: RendererMain;
  setRendererFactory(
    (settings, root) => {
      if (typeof root !== 'string' && !(root instanceof HTMLElement)) {
        throw new TypeError('Canvas requires an element or element ID.');
      }
      const { appWidth, appHeight, deviceLogicalPixelRatio, boundsMargin } =
        settings || {};
      scene = new RendererMain(
        {
          appWidth,
          appHeight,
          deviceLogicalPixelRatio,
          boundsMargin,
          ...options,
          renderEngine: CanvasRenderer,
          fontEngines: [CanvasTextRenderer],
        },
        root,
      );
      return scene;
    },
    async (fonts) => {
      await Promise.all(
        fonts.map((font) =>
          'fontUrl' in font ? scene.stage.loadFont('canvas', font) : undefined,
        ),
      );
    },
  );
}
