// The same fixture through the renderer's browser path, for run.mjs to
// compare the desktop runtime against: Chromium's WebGL, the web platform.
import { Config } from '@solid-multiplatform/platform';
import { fontsReady, mountFixture } from './app';
import { nextFrame, scene, settled } from './probes';

// The desktop window's size, at one pixel per unit.
Config.rendererOptions = {
  appWidth: 1280,
  appHeight: 720,
  devicePhysicalPixelRatio: 1,
};

async function run(): Promise<unknown> {
  mountFixture('fonts');
  await settled(fontsReady);
  return { frame: await nextFrame(), scene: scene() };
}

run().then(
  (result) => {
    (globalThis as { sceneResult?: unknown }).sceneResult = result;
  },
  (error) => {
    (globalThis as { sceneResult?: unknown }).sceneResult = {
      error: String(error),
    };
  },
);
