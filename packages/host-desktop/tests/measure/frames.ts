// What measure.mjs times per frame: the settled fixture drawn again and
// again. A frame is timed from its start to the end of its draw calls, which
// is the JavaScript and binding work; rasterizing and presenting happen
// after, in the driver. Prints one line of JSON and exits.
import { startDesktop } from '@solid-multiplatform/host-desktop';
import { fontsReady, mountFixture } from '../scene/app';
import { renderer, settled } from '../scene/probes';

const FRAMES = 300;

async function run(): Promise<void> {
  startDesktop(() => mountFixture('fonts'));
  await settled(fontsReady);
  const stage = renderer();
  const costs: number[] = [];
  let began = 0;
  const start = performance.now();
  await new Promise<void>((resolve) => {
    stage.on('frameTick', () => {
      began = performance.now();
    });
    stage.on('idle', () => {
      costs.push(performance.now() - began);
      if (costs.length === FRAMES) resolve();
      else stage.requestRender();
    });
    stage.requestRender();
  });
  const interval = (performance.now() - start) / FRAMES;
  costs.sort((a, b) => a - b);
  console.log(
    'MEASURE ' +
      JSON.stringify({
        count: FRAMES,
        median: costs[FRAMES >> 1],
        p95: costs[Math.floor(FRAMES * 0.95)],
        worst: costs[FRAMES - 1],
        interval,
        driver: String(__solid.gl!.getParameter(0x1f01)),
      }),
  );
  __solid.exit(0);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
