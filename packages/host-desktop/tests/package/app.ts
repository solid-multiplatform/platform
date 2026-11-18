// The packaged-app test, run by the packaged runtime itself from wherever
// run.mjs moved the package to: the shared fixture with its font from the
// package's resources, judged from the first frame's pixels; then the idle
// check; then where it runs from and what it was opened with.
import { loadService } from '@solid-multiplatform/platform/services';
import { startDesktop } from '@solid-multiplatform/host-desktop';
import { fontsReady, mountFixture } from '../scene/app';
import {
  nextFrame,
  scene,
  settled,
  verifyFrame,
  verifyScene,
} from '../scene/probes';

const IDLE_MS = 3000;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const problems: string[] = [];
  // Relative: the runtime looks in the package's resources directory.
  startDesktop(() => mountFixture('fonts'));
  await settled(fontsReady);
  const frame = await nextFrame();
  problems.push(...verifyFrame(frame), ...verifyScene(scene()));

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

  const link = (await loadService('links')).initial();
  // An error's stack names the script; run.mjs checks it says nothing of
  // where the app was built.
  const stack = new Error('where').stack ?? '';
  console.log(
    'PACKAGED ' +
      JSON.stringify({
        frame,
        idle,
        appDir: __solid.appDir,
        args: __solid.args,
        link,
        stack,
        problems,
      }),
  );
  __solid.exit(problems.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
