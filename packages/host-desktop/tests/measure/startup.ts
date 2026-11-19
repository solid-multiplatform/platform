// What measure.mjs times at start-up: the fixture from the start of the
// process to its first presented frame and to its complete one, with text.
// Prints one line of JSON and exits.
import { startDesktop } from '@solid-multiplatform/host-desktop';
import { fontsReady, mountFixture } from '../scene/app';
import { renderer, settled } from '../scene/probes';

// performance.now() counts from the start of the runtime's main().

async function run(): Promise<void> {
  startDesktop(() => mountFixture('fonts'));
  const mounted = performance.now();
  // The renderer's first frame runs in the first animation frame; a timer
  // set there runs once that frame has been presented.
  const firstFrame = await new Promise<number>((resolve) => {
    requestAnimationFrame(() =>
      setTimeout(() => resolve(performance.now()), 0),
    );
  });
  const presents = __solid.stats().presents;
  // The complete frame is the last one drawn before the scene settles: the
  // one with the text in it.
  let complete = 0;
  renderer().on('idle', () => {
    complete = performance.now();
  });
  await settled(fontsReady);
  console.log(
    'MEASURE ' + JSON.stringify({ mounted, firstFrame, presents, complete }),
  );
  __solid.exit(0);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
