// Drives the device motion test: native x/alpha animations started through the
// platform's JSX path. run-motion.mjs installs it, takes screenshots while the
// app holds known states, and reads the console markers.
//
// Every marker is prefixed MOTION. The app counts timers armed by the backend
// (not its own sequencing timers) so a fully native animation can be shown to
// arm none.
import {
  createRenderer,
  setRendererFactory,
} from '@solid-multiplatform/platform';
import type { ElementNode } from '@solid-multiplatform/platform';
import { rokuHost } from '@solid-multiplatform/platform/roku';
import { BG, FADE, MOVE, SCREEN } from './motion-cases.mjs';

let armed = 0;
const testTimeout = globalThis.setTimeout;
const testInterval = globalThis.setInterval;
globalThis.setTimeout = ((handler: () => void, ms?: number) => {
  armed++;
  return testTimeout(handler, ms);
}) as typeof globalThis.setTimeout;
globalThis.setInterval = ((handler: () => void, ms?: number) => {
  armed++;
  return testInterval(handler, ms);
}) as typeof globalThis.setInterval;
const sleep = (ms: number) =>
  new Promise<void>((done) => testTimeout(done, ms));
const log = (line: string) => console.log('MOTION ' + line);
const xOf = (el: ElementNode) =>
  Math.round((el.lng as unknown as { x: number }).x);

async function sequence(move: ElementNode, fade: ElementNode): Promise<void> {
  log('START');
  // Start, pause mid-way and resume: the paused position is stable for the
  // screenshot probe (half of the linear run).
  const moveAnim = move
    .animate({ x: MOVE.x1 }, { duration: MOVE.duration, easing: 'linear' })
    .start();
  const started = Date.now();
  const armedBefore = armed;
  await sleep(MOVE.duration / 2);
  moveAnim.pause();
  log(`PAUSED x=${xOf(move)} state=${moveAnim.state}`);
  await sleep(3000);
  // The controller contract resumes a paused run with start().
  moveAnim.start();
  log('RESUMED');
  await moveAnim.waitUntilStopped();
  log(
    `MOVE_DONE x=${xOf(move)} ms=${Date.now() - started} armed=${armed - armedBefore}`,
  );
  await sleep(1500);

  // Interrupt a running transition with a new target.
  const interrupted = move
    .animate({ x: MOVE.x0 }, { duration: 2000, easing: 'linear' })
    .start();
  await sleep(500);
  // A new run of the same property replaces the running one mid-flight.
  const replacement = move
    .animate({ x: MOVE.x1 }, { duration: 300, easing: 'linear' })
    .start();
  log(`INTERRUPT_START x=${xOf(move)} state=${replacement.state}`);
  await interrupted.waitUntilStopped();
  log('INTERRUPT_OLD_STOPPED');
  // Do not block the sequence on the replacement's completion: a replaced
  // SceneGraph Animation can drop its stopped event, which is recorded here
  // rather than allowed to stall the remaining cases.
  await sleep(1200);
  log(`INTERRUPT_DONE x=${xOf(move)} state=${replacement.state}`);
  await sleep(1500);

  // Pause a fade, probe its opacity, resume, then restore to the start value.
  const fadeAnim = fade
    .animate({ alpha: FADE.a1 }, { duration: FADE.duration, easing: 'linear' })
    .start();
  await sleep(FADE.duration / 2);
  fadeAnim.pause();
  log(
    `FADE_PAUSED alpha=${(fade.lng as unknown as { alpha: number }).alpha.toFixed(3)}`,
  );
  await sleep(3000);
  fadeAnim.start();
  await sleep(300);
  fadeAnim.restore();
  log(
    `RESTORED alpha=${(fade.lng as unknown as { alpha: number }).alpha.toFixed(3)} state=${fadeAnim.state}`,
  );
  await sleep(1500);

  // Chained transitions run in order through the controller.
  move
    .chain({ x: MOVE.x0 }, { duration: 500, easing: 'linear' })
    .chain({ x: MOVE.x1 }, { duration: 500, easing: 'linear' });
  await move.start();
  log(`CHAIN_DONE x=${xOf(move)}`);
  await sleep(1000);

  // While a native animation runs, and after it settles, the backend arms no
  // timers; one flush per write is allowed, a per-frame clock is not.
  move.animate({ x: MOVE.x0 }, { duration: 1500, easing: 'linear' }).start();
  // Count from after start: nothing may be armed while the render thread runs,
  // and nothing may recur after it settles.
  const idleBefore = armed;
  await sleep(500);
  const during = armed - idleBefore;
  await sleep(1600);
  const after = armed - idleBefore;
  await sleep(1000);
  log(
    `IDLE during=${during} after=${after} idle=${armed - idleBefore - after} armed=${armed}`,
  );
  log('DONE');
}

export function launch(): void {
  rokuHost().launch((context) => {
    setRendererFactory(
      (settings) => context.createRenderer(settings),
      context.loadFonts,
    );
    const { render } = createRenderer();
    let move: ElementNode | undefined;
    let fade: ElementNode | undefined;
    render(() => (
      <view width={SCREEN.w} height={SCREEN.h} color={BG}>
        <view
          x={MOVE.x0}
          y={MOVE.y}
          width={MOVE.w}
          height={MOVE.h}
          color={MOVE.color}
          onCreate={(el) => {
            move = el;
          }}
        />
        <view
          x={FADE.x}
          y={FADE.y}
          width={FADE.w}
          height={FADE.h}
          color={FADE.color}
          alpha={FADE.a0}
          onCreate={(el) => {
            fade = el;
          }}
        />
      </view>
    ));
    // One frame to settle, then the sequence; a boot failure is a timeout on
    // the runner's side.
    testTimeout(() => {
      if (move && fade)
        void sequence(move, fade).catch((error) =>
          log('ERROR ' + String(error)),
        );
    }, 300);
    return () => {};
  });
}

launch();
