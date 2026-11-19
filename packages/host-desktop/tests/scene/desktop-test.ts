// The real-scene test, run by the desktop runtime itself: the fixture drawn
// by the WebGL renderer in Hermes, judged from the pixels; then the idle
// check; then a resize. Prints one line of JSON for run.mjs, which compares
// it with Chromium's, and exits non-zero if anything here is wrong.
import { viewport } from '@solid-multiplatform/platform/viewport';
import { startDesktop } from '@solid-multiplatform/host-desktop';
import { fontsReady, mountFixture } from './app';
import {
  nextFrame,
  renderer,
  scene,
  settled,
  verifyFrame,
  verifyScene,
} from './probes';

const IDLE_MS = 2000;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const problems: string[] = [];
  startDesktop(() => mountFixture('fonts'));
  const firstFrameAt = await new Promise<number>((resolve) => {
    requestAnimationFrame(() =>
      setTimeout(() => resolve(performance.now()), 0),
    );
  });

  await settled(fontsReady);
  const frame = await nextFrame();
  const state = scene();
  problems.push(...verifyFrame(frame), ...verifyScene(state));

  // Idle: nothing changes for a while. The loop may wake once, for the timer
  // that ends the wait, and must run no frame and present nothing.
  await sleep(200);
  const before = __solid.stats();
  await sleep(IDLE_MS);
  const after = __solid.stats();
  const idle = {
    ms: IDLE_MS,
    wakeups: after.wakeups - before.wakeups,
    frames: after.frames - before.frames,
    presents: after.presents - before.presents,
  };
  if (idle.wakeups > 1) problems.push(`idle: ${idle.wakeups} wakeups`);
  if (idle.frames !== 0) problems.push(`idle: ${idle.frames} frames`);
  if (idle.presents !== 0) problems.push(`idle: ${idle.presents} presents`);

  // Resize: the window system reports it, the host tells the platform, and
  // the renderer draws at the new size. The window becomes narrower than the
  // panel, so a renderer that had not heard would leave it out of place.
  __solid.window!.setSize(500, 300);
  for (
    let waited = 0;
    viewport().width !== 500 && waited < 3000;
    waited += 20
  ) {
    await sleep(20);
  }
  if (viewport().width !== 500) {
    problems.push('the resize never reached the platform');
  }
  await settled(fontsReady);
  const resized = await nextFrame();
  problems.push(...verifyFrame(resized).map((p) => `after the resize: ${p}`));
  if (resized.width !== 500 || resized.height !== 300) {
    problems.push(
      `the surface is ${resized.width} x ${resized.height} after the resize`,
    );
  }
  if (viewport().height !== 300) {
    problems.push(`viewport() is ${viewport().width} x ${viewport().height}`);
  }

  // An error in a frame: the renderer hands it to the host instead of
  // letting it out, and the host must not swallow it. run.mjs looks for it
  // on standard error. The loop goes on: the next frame is read as usual.
  const stage = renderer();
  const failing = (): void => {
    stage.off('frameTick', failing);
    throw new Error('thrown in a frame listener');
  };
  stage.on('frameTick', failing);
  problems.push(
    ...verifyFrame(await nextFrame()).map((p) => `after the error: ${p}`),
  );

  console.log(
    'SCENE ' +
      JSON.stringify({
        frame,
        scene: state,
        idle,
        resized,
        firstFrameAt,
        problems,
      }),
  );
  __solid.exit(problems.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
