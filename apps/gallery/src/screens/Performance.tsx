import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { displayRefreshRate, getRenderer } from '@solid-multiplatform/platform';
import type { UiFamily } from '../family';
import { C, R, S, T } from '../theme';
import { pageLayout } from '../layout';

interface Sample {
  delta: number;
  cost: number;
}

const WINDOW = 120;

/** The panel's frame budget: one panel period, or 60 Hz when unknown. */
const budgetFor = (hz: number): number => (hz > 0 ? 1000 / hz : 1000 / 60);

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[at]!;
}

export function Performance(props: {
  family: UiFamily;
  width: number;
  height: number;
  topNav?: JSX.Element;
}): JSX.Element {
  const tv = () => props.family === 'tv';
  const mobile = () => props.family === 'mobile';
  const width = () => props.width;
  const page = () => pageLayout(width(), props.family);
  const [hz, setHz] = createSignal(0);
  const [samples, setSamples] = createSignal<Sample[]>([]);
  const [draws, setDraws] = createSignal<number | undefined>(undefined);
  const [paused, setPaused] = createSignal(false);
  const [captured, setCaptured] = createSignal<{
    p50: number;
    p99: number;
    hz: number;
    at: number;
  }>();

  onMount(() => {
    setHz(Math.round(displayRefreshRate()));
    const renderer = getRenderer() as unknown as {
      on?(
        event: string,
        listener: (target: unknown, payload?: unknown) => void,
      ): void;
      off?(
        event: string,
        listener: (target: unknown, payload?: unknown) => void,
      ): void;
      flushedOps?: number;
      ops?: { length?: number };
      scene?: { quads?: number };
      requestRender?(): void;
    };
    if (typeof renderer?.on !== 'function') return;
    let frames = 0;
    // The lab is a loop while it is open: each tick asks for the next frame.
    // Closing the screen removes the listener, and the one frame it already
    // scheduled finds nothing to do and the scene goes idle.
    renderer.requestRender?.();
    const listener = (_target: unknown, payload?: unknown) => {
      if (paused()) return;
      // Ask after this frame is over: a request made during it is cleared by
      // the frame's own update, and the loop would stop after one tick.
      queueMicrotask(() => {
        if (!paused()) renderer.requestRender?.();
      });
      const frame = payload as { delta?: number; cost?: number } | undefined;
      const delta = frame?.delta;
      if (typeof delta !== 'number' || !(delta > 0)) return;
      frames++;
      // Publish every third frame: the graph does not need every sample, and
      // a signal write per frame would be the lab measuring itself.
      if (frames % 3 !== 0) return;
      const cost = typeof frame?.cost === 'number' ? frame.cost : 0;
      setSamples((previous) => {
        const next =
          previous.length >= WINDOW ? previous.slice(1) : previous.slice();
        next.push({ delta, cost });
        return next;
      });
      const ops = renderer.ops?.length ?? 0;
      setDraws(
        typeof renderer.flushedOps === 'number'
          ? renderer.flushedOps + ops
          : undefined,
      );
    };
    renderer.on('frameTick', listener);
    onCleanup(() => renderer.off?.('frameTick', listener));
  });

  const budget = () => budgetFor(hz());
  const current = () => samples()[samples().length - 1];
  const fps = () => {
    const sample = current();
    return sample ? 1000 / sample.delta : 0;
  };
  const stats = createMemo(() => {
    const deltas = samples()
      .map((sample) => sample.delta)
      .sort((a, b) => a - b);
    const costs = samples()
      .map((sample) => sample.cost)
      .sort((a, b) => a - b);
    return {
      p50: percentile(deltas, 0.5),
      p99: percentile(deltas, 0.99),
      cpu: percentile(costs, 0.5),
    };
  });
  const pass = () => stats().p99 <= budget() * 1.1;

  /** The live card, the graph inside it, and one bar's slot. */
  const cardWidth = () =>
    tv() ? 640 : mobile() ? page().width : Math.min(560, page().width * 0.55);
  const graphWidth = () => cardWidth() - 2 * S(5);
  const graphHeight = () => (tv() ? 220 : mobile() ? 120 : 180);
  const barWidth = () => Math.max(1, Math.floor(graphWidth() / WINDOW));
  const maxDelta = () =>
    Math.max(budget() * 2, ...samples().map((sample) => sample.delta));

  const capture = () => {
    const value = stats();
    setCaptured({ p50: value.p50, p99: value.p99, hz: hz(), at: Date.now() });
  };

  const columnsWidth = () =>
    tv() ? 420 : mobile() ? page().width : Math.min(360, page().width * 0.38);
  const stat = (
    label: string,
    value: string,
    accent = false,
    width?: number,
  ) => (
    <view
      display="flex"
      flexDirection="column"
      gap={2}
      width={width ?? Math.floor((columnsWidth() - 2 * S(6)) / 3)}
    >
      <text fontSize={T.caption} color={C.muted} letterSpacing={0.8}>
        {label}
      </text>
      <text
        fontSize={tv() ? T.headline : T.body}
        color={accent ? C.accent : C.text}
      >
        {value}
      </text>
    </view>
  );

  return (
    <view width={width()} height={props.height} clipping>
      <view
        x={page().x}
        y={S(6)}
        width={page().width}
        height={props.height - S(6)}
        display="flex"
        flexDirection="column"
        gap={S(6)}
      >
        {props.topNav}
        <view
          width={page().width}
          height={tv() ? 130 : 58}
          display="flex"
          flexDirection="row"
          alignItems="center"
          justifyContent="spaceBetween"
        >
          <view display="flex" flexDirection="column" gap={S(1)}>
            <text fontSize={tv() ? T.display : T.title} color={C.text}>
              Performance
            </text>
            <text fontSize={tv() ? T.body : T.caption} color={C.muted}>
              The same scene, measured where it runs
            </text>
          </view>
          <view
            display="flex"
            flexDirection="row"
            alignItems="center"
            gap={S(2)}
            padding={[6, 12]}
            borderRadius={R.pill}
            color={pass() ? 0x1f2b24ff : 0x2b1f1fff}
          >
            <view
              width={7}
              height={7}
              borderRadius={4}
              color={pass() ? 0x6fbf8aff : C.accent}
            />
            <text fontSize={T.caption} color={pass() ? 0x9fd8b0ff : C.accent}>
              {pass() ? 'WITHIN BUDGET' : 'OVER BUDGET'}
            </text>
          </view>
        </view>

        <view
          width={page().width}
          display="flex"
          flexDirection={mobile() ? 'column' : 'row'}
          gap={S(8)}
          alignItems="flexStart"
        >
          {/* The live graph */}
          <view
            width={cardWidth()}
            display="flex"
            flexDirection="column"
            gap={S(3)}
            color={C.surface}
            borderRadius={R.medium}
            padding={S(5)}
          >
            <view width={graphWidth()} height={graphHeight()}>
              <For each={samples()}>
                {(sample, index) => (
                  <view
                    x={index() * barWidth()}
                    y={
                      graphHeight() -
                      Math.max(1, (sample.delta / maxDelta()) * graphHeight())
                    }
                    width={Math.max(1, barWidth() - 1)}
                    height={Math.max(
                      1,
                      (sample.delta / maxDelta()) * graphHeight(),
                    )}
                    color={
                      sample.delta > budget() * 1.1 ? C.accent : 0x4a4a55ff
                    }
                  />
                )}
              </For>
              {/* The budget line: what one panel period looks like. */}
              <view
                width={graphWidth()}
                height={1}
                y={Math.max(
                  0,
                  graphHeight() - (budget() / maxDelta()) * graphHeight(),
                )}
                color={0xffffff33}
              />
            </view>
            <view display="flex" flexDirection="row" gap={S(4)}>
              {stat(
                'DISPLAY',
                hz() > 0 ? `${hz()} Hz` : 'n/a',
                false,
                Math.floor((graphWidth() - 2 * S(4)) / 3),
              )}
              {stat(
                'FPS',
                fps() > 0 ? String(Math.round(fps())) : 'n/a',
                true,
                Math.floor((graphWidth() - 2 * S(4)) / 3),
              )}
              {stat(
                'CPU',
                `${stats().cpu.toFixed(1)} ms`,
                false,
                Math.floor((graphWidth() - 2 * S(4)) / 3),
              )}
            </view>
          </view>

          {/* The numbers */}
          <view
            display="flex"
            flexDirection="column"
            gap={S(4)}
            width={columnsWidth()}
          >
            <view display="flex" flexDirection="row" gap={S(6)}>
              {stat('FRAME BUDGET', `${budget().toFixed(1)} ms`)}
              {stat('P50', `${stats().p50.toFixed(1)} ms`)}
              {stat('P99', `${stats().p99.toFixed(1)} ms`)}
            </view>
            <view display="flex" flexDirection="row" gap={S(6)}>
              {stat('DRAWS', draws() === undefined ? 'n/a' : String(draws()))}
              {stat('SAMPLES', String(samples().length))}
              {stat('MODE', paused() ? 'paused' : 'live')}
            </view>
            <text fontSize={T.body} color={C.muted} width={columnsWidth()}>
              p99 is the frame that matters: under the panel's period, the scene
              holds its rate. The cpu figure is the frame's own work; a frame
              that misses has either a large cpu or a rate request that did not
              land.
            </text>
            <view display="flex" flexDirection="row" gap={S(3)}>
              <view
                width={110}
                height={40}
                borderRadius={R.pill}
                border={{ width: 1, color: C.line }}
                display="flex"
                alignItems="center"
                justifyContent="center"
                onEnter={() => setPaused((value) => !value)}
                onMouseClick={() => setPaused((value) => !value)}
                cursorStyle="pointer"
                style={{ $focus: { border: { width: 1, color: C.accent } } }}
              >
                <text fontSize={T.label} color={C.text}>
                  {paused() ? 'Resume' : 'Pause'}
                </text>
              </view>
              <view
                width={130}
                height={40}
                borderRadius={R.pill}
                border={{ width: 1, color: C.line }}
                display="flex"
                alignItems="center"
                justifyContent="center"
                onEnter={capture}
                onMouseClick={capture}
                cursorStyle="pointer"
                style={{ $focus: { border: { width: 1, color: C.accent } } }}
              >
                <text fontSize={T.label} color={C.text}>
                  Capture
                </text>
              </view>
            </view>
            {(() => {
              const shot = captured();
              return shot ? (
                <view
                  color={C.raised}
                  borderRadius={R.small}
                  padding={S(3)}
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <text fontSize={T.caption} color={C.muted}>
                    CAPTURED
                  </text>
                  <text fontSize={T.body} color={C.text}>
                    {`p50 ${shot.p50.toFixed(1)} ms, p99 ${shot.p99.toFixed(1)} ms, ${shot.hz > 0 ? `${shot.hz} Hz` : 'rate unknown'}`}
                  </text>
                </view>
              ) : null;
            })()}
          </view>
        </view>
      </view>
    </view>
  );
}
