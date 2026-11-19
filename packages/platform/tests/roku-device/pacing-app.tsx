// Drives the Roku frame-pacing workload. run-pacing.mjs installs it, relaunches
// it with launch parameters (contentId=pacing, case, seconds) and reads the
// samples it prints.
//
// What is measured is a PROXY: a deadline-corrected setTimeout loop records
// performance.now() (Date.now() where the engine has no performance.now) on
// the JavaScript thread, and the renderer's `idle` event is timestamped. The
// firmware's real frame timing is the Perfetto render/swapBuffers slices on
// the SceneGraph render thread, which an app cannot read (docs/performance.md).
//
// Cases:
//   steady     the scrolling poster rail, native x animation
//   animation  the rail plus a 30-node native alpha batch
//   block      the animation case plus one deliberate 1000 ms JavaScript block
//
// Every marker is prefixed PACING. The app prints one SAMPLE line per second,
// then SUMMARY and DONE. It never prints a device address or identifier.
import {
  createRenderer,
  setRendererFactory,
} from '@solid-multiplatform/platform';
import type { ElementNode } from '@solid-multiplatform/platform';
import { rokuHost } from '@solid-multiplatform/platform/roku';
import {
  BATCH,
  BLOCK_AT_MS,
  BLOCK_MS,
  DEFAULT_SECONDS,
  PERIOD_MS,
  RAIL,
  RAIL_TRAVEL,
  SCREEN,
  BG,
} from './pacing-cases.mjs';

const log = (line: string) => console.log('PACING ' + line);
const round = (value: number) => Math.round(value * 100) / 100;
const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

interface LaunchConfig {
  setLaunchParamsUpdateHandler(
    handler: ((params: Record<string, string>) => void) | null,
  ): void;
}

/** The firmware's launch parameters, read synchronously as the host does. */
function readLaunchParams(): Record<string, string> {
  let params: Record<string, string> = {};
  try {
    // The firmware object the SDK's own host reads; not exported from
    // @roku-sdk/rsg-ts/runtime.
    const runtime = (
      globalThis as unknown as {
        roku: {
          getRuntimeSingletonSync<T>(name: string): T;
        };
      }
    ).roku;
    const config =
      runtime.getRuntimeSingletonSync<LaunchConfig>('LaunchConfig');
    config.setLaunchParamsUpdateHandler((next) => {
      params = next ?? {};
    });
    config.setLaunchParamsUpdateHandler(null);
  } catch (error) {
    log('ERROR launch params: ' + String((error as Error)?.message ?? error));
  }
  return params;
}

function Workload(props: {
  rail: (el: ElementNode) => void;
  batch: (el: ElementNode) => void;
}) {
  const cards = Array.from({ length: RAIL.cards }, (_, i) => i);
  const nodes = Array.from({ length: BATCH.nodes }, (_, i) => i);
  return (
    <view width={SCREEN.w} height={SCREEN.h} color={BG}>
      <view
        x={0}
        y={RAIL.y}
        width={RAIL.cards * (RAIL.width + RAIL.gap)}
        height={RAIL.height}
      >
        <view
          x={0}
          y={0}
          width={RAIL.cards * (RAIL.width + RAIL.gap)}
          height={RAIL.height}
          onCreate={props.rail}
        >
          {cards.map((i) => (
            <view
              x={i * (RAIL.width + RAIL.gap)}
              y={0}
              width={RAIL.width}
              height={RAIL.height}
              color={i % 2 === 0 ? RAIL.color : RAIL.altColor}
            >
              <text
                x={16}
                y={RAIL.height - 72}
                width={RAIL.width - 32}
                height={56}
                color={RAIL.labelColor}
                fontSize={26}
              >
                {'Poster ' + (i + 1)}
              </text>
            </view>
          ))}
        </view>
      </view>
      {nodes.map((i) => (
        <view
          x={BATCH.x + (i % BATCH.columns) * (BATCH.width + BATCH.gapX)}
          y={
            BATCH.y +
            Math.floor(i / BATCH.columns) * (BATCH.height + BATCH.gapY)
          }
          width={BATCH.width}
          height={BATCH.height}
          color={BATCH.color}
          alpha={1}
          onCreate={props.batch}
        />
      ))}
    </view>
  );
}

rokuHost().launch((context) => {
  setRendererFactory(
    (settings) => context.createRenderer(settings),
    context.loadFonts,
  );
  const { renderer, render } = createRenderer();

  const params = readLaunchParams();
  const pacingCase = params.case ?? '';
  if (!pacingCase) {
    // The installer launches the app once without parameters; the runner then
    // relaunches it with them. Do nothing until then.
    log('NO_PARAMS');
    return () => {};
  }
  const seconds = Math.max(1, Number(params.seconds) || DEFAULT_SECONDS);

  const frames: number[] = [];
  const idle: number[] = [];
  const idleTimes: number[] = [];
  const blocks: { start: number; end: number; ms: number }[] = [];
  let rail: ElementNode | undefined;
  const batch: ElementNode[] = [];

  render(() => (
    <Workload
      rail={(el) => {
        rail = el;
      }}
      batch={(el) => {
        batch.push(el);
      }}
    />
  ));
  log('READY ' + pacingCase);

  let startedAt = 0;
  let running = false;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let blockTimer: ReturnType<typeof setTimeout> | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;
  let sampleAt = 0;
  let idleAt = 0;

  // The renderer's `idle` fires after a JS flush, not on a render-thread
  // frame: it is a commit-cadence signal, not a display signal.
  renderer.on('idle', () => {
    if (!running) return;
    const at = now() - startedAt;
    idleTimes.push(at);
    idle.push(at);
  });

  const event = (kind: string, detail = '') => {
    if (!running) return;
    log(
      'EVENT ' + JSON.stringify({ kind, detail, t: round(now() - startedAt) }),
    );
  };

  /** Emit the frames and idle callbacks seen since the previous sample. */
  const emitSample = () => {
    const t = round(now() - startedAt);
    const newFrames = frames.slice(sampleAt).map(round);
    const newIdle = idle.slice(idleAt).map(round);
    sampleAt = frames.length;
    idleAt = idle.length;
    log('SAMPLE ' + JSON.stringify({ t, frames: newFrames, idle: newIdle }));
  };

  /**
   * A deadline-corrected 60 Hz callback on the JavaScript thread. This is the
   * measured series. It does no rendering work, so it measures whether the JS
   * thread can service a 60 Hz cadence, not what the render thread presents.
   */
  const startProbe = () => {
    let next = now() + PERIOD_MS;
    const tick = () => {
      if (!running) return;
      const t = now();
      frames.push(t - startedAt);
      next += PERIOD_MS;
      // After a block or a long pause, do not burst to catch up: one callback
      // now, then resume the cadence. The long interval is the evidence.
      if (next <= t) next = t + PERIOD_MS;
      probeTimer = setTimeout(tick, Math.max(0, next - now()));
    };
    probeTimer = setTimeout(tick, PERIOD_MS);
  };

  async function scrollRail() {
    while (running && rail) {
      const out = rail
        .animate({ x: -RAIL_TRAVEL }, { duration: 4000, easing: 'linear' })
        .start();
      event('anim-start', 'rail-out');
      await out.waitUntilStopped();
      event('anim-stop', 'rail-out');
      if (!running) break;
      const back = rail
        .animate({ x: 0 }, { duration: 4000, easing: 'linear' })
        .start();
      event('anim-start', 'rail-back');
      await back.waitUntilStopped();
      event('anim-stop', 'rail-back');
    }
  }

  async function pulseBatch() {
    if (batch.length === 0) return;
    let high = true;
    while (running) {
      const target = high ? 0.25 : 1;
      const runs = batch.map((el) =>
        el
          .animate(
            { alpha: target },
            { duration: BATCH.durationMs, easing: 'linear' },
          )
          .start(),
      );
      event('anim-start', 'batch-' + (high ? 'dim' : 'bright'));
      await Promise.all(runs.map((run) => run.waitUntilStopped()));
      event('anim-stop', 'batch-' + (high ? 'dim' : 'bright'));
      high = !high;
    }
  }

  /** The stress case: hold the JavaScript thread for 1000 ms. */
  const runBlock = () => {
    const start = round(now() - startedAt);
    event('block-start', String(BLOCK_MS));
    const until = now() + BLOCK_MS;
    while (now() < until) {
      // Deliberately empty: the firmware's native animation runs on another
      // thread, the JS probe above cannot.
    }
    const end = round(now() - startedAt);
    blocks.push({ start, end, ms: round(end - start) });
    log('BLOCK ' + JSON.stringify(blocks[blocks.length - 1]));
    event('block-end', String(round(end - start)));
  };

  const finish = () => {
    if (!running) return;
    emitSample();
    running = false;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    if (blockTimer !== undefined) clearTimeout(blockTimer);
    if (sampler !== undefined) clearInterval(sampler);
    log(
      'SUMMARY ' +
        JSON.stringify({
          case: pacingCase,
          seconds,
          frames: frames.length,
          idle: idle.length,
          blocks,
          durationMs: round(now() - startedAt),
          periodMs: round(PERIOD_MS),
        }),
    );
    log('DONE');
  };

  // Let the first scene settle before the measured window opens.
  setTimeout(() => {
    startedAt = now();
    running = true;
    log(
      'START ' +
        JSON.stringify({
          case: pacingCase,
          seconds,
          periodMs: round(PERIOD_MS),
          railCards: RAIL.cards,
          batchNodes: batch.length,
        }),
    );
    startProbe();
    sampler = setInterval(emitSample, 1000);
    if (pacingCase === 'steady') {
      void scrollRail();
    } else {
      void scrollRail();
      void pulseBatch();
      if (pacingCase === 'block')
        blockTimer = setTimeout(runBlock, BLOCK_AT_MS);
    }
    endTimer = setTimeout(finish, seconds * 1000);
  }, 300);

  return () => {
    running = false;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    if (endTimer !== undefined) clearTimeout(endTimer);
    if (blockTimer !== undefined) clearTimeout(blockTimer);
    if (sampler !== undefined) clearInterval(sampler);
  };
});
