/// <reference types="vite/client" />
// A phone-sized variant of setup.ts (see that file): one WebGL renderer per
// test file, laid out at 390x844 scene units so the gallery runs its mobile
// shell, resizable to whatever the test's surface is.
import { RendererMain } from '@solid-multiplatform/renderer';
import {
  Config,
  createRenderer,
  loadFonts,
} from '@solid-multiplatform/platform';
import latoData from './fonts/Lato-Regular.msdf.json?url';
import latoAtlas from './fonts/Lato-Regular.msdf.png?url';

export const FONT_FAMILY = 'Lato';

/** The font every test lays text out with. */
export function latoFont(fontFamily: string) {
  return {
    type: 'msdf' as const,
    fontFamily,
    atlasDataUrl: latoData,
    atlasUrl: latoAtlas,
  };
}

Config.fontSettings = { fontFamily: FONT_FAMILY, fontSize: 30 };

const root = document.createElement('div');
document.body.appendChild(root);

// Phone scene units: uiFamily() turns the gallery into its mobile shell.
Config.rendererOptions = {
  appWidth: 390,
  appHeight: 844,
  resizable: true,
};

// Called before createRenderer, as apps do: the download overlaps the boot.
const fontsReady = loadFonts([latoFont(FONT_FAMILY)]);

const created = createRenderer(Config.rendererOptions, root);

if (!(created.renderer instanceof RendererMain)) {
  throw new Error(
    'tests/webgl must run on @solid-multiplatform/renderer, not the DOM',
  );
}

export const render = created.render;
export const renderer: RendererMain = created.renderer;

let frames = 0;
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => {
  frames++;
  return raf(callback);
};

/** Frames scheduled since the last read. */
export const frameCount = () => {
  const value = frames;
  frames = 0;
  return value;
};

/** Two animation frames, each followed by a macrotask. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 2; i++)
    await new Promise<void>((resolve) => raf(() => setTimeout(resolve, 0)));
}

await fontsReady;
