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
  const pad = () => (tv() ? S(10) : mobile() ? S(5) : S(6));
  const width = () => props.width;
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

  /** The graph's width, and therefore one bar's slot. */
  const graphWidth = () =>
    tv() ? 560 : mobile() ? width() - 2 * pad() - 2 * S(5) : 420;
  const barWidth = () => Math.max(1, Math.floor(graphWidth() / WINDOW));
  const maxDelta = () =>
    Math.max(budget() * 2, ...samples().map((sample) => sample.delta));

  const capture = () => {
    const value = stats();
    setCaptured({ p50: value.p50, p99: value.p99, hz: hz(), at: Date.now() });
  };

  const stat = (label: string, value: string, accent = false) => (
    <view
      display="flex"
      flexDirection="column"
      gap={2}
      width={tv() ? 220 : 140}
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
        width={width()}
        height={props.height}
        display="flex"
        flexDirection="column"
        gap={S(6)}
        padding={[0, pad()]}
      >
        {props.topNav}
        <view
          width={width() - 2 * pad()}
          height={tv() ? 130 : 90}
          display="flex"
          flexDirection="row"
          alignItems="flexEnd"
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
          width={width() - 2 * pad()}
          display="flex"
          flexDirection={mobile() ? 'column' : 'row'}
          gap={S(8)}
          alignItems="flexStart"
        >
          {/* The live graph */}
          <view
            width={tv() ? 640 : mobile() ? width() - 2 * pad() : 520}
            display="flex"
            flexDirection="column"
            gap={S(3)}
            color={C.surface}
            borderRadius={R.medium}
            padding={S(5)}
          >
            <view width={graphWidth()} height={90}>
              <For each={samples()}>
                {(sample, index) => (
                  <view
                    x={index() * barWidth()}
                    y={90 - Math.max(1, (sample.delta / maxDelta()) * 90)}
                    width={Math.max(1, barWidth() - 1)}
                    height={Math.max(1, (sample.delta / maxDelta()) * 90)}
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
                y={Math.max(0, 90 - (budget() / maxDelta()) * 90)}
                color={0xffffff33}
              />
            </view>
            <view display="flex" flexDirection="row" gap={S(6)}>
              {stat('DISPLAY', hz() > 0 ? `${hz()} Hz` : 'n/a')}
              {stat('FPS', fps() > 0 ? String(Math.round(fps())) : '—', true)}
              {stat('CPU', `${stats().cpu.toFixed(1)} ms`)}
            </view>
          </view>

          {/* The numbers */}
          <view
            display="flex"
            flexDirection="column"
            gap={S(4)}
            width={tv() ? 420 : mobile() ? width() - 2 * pad() : 320}
          >
            <view display="flex" flexDirection="row" gap={S(6)}>
              {stat('FRAME BUDGET', `${budget().toFixed(1)} ms`)}
              {stat('P50', `${stats().p50.toFixed(1)} ms`)}
              {stat('P99', `${stats().p99.toFixed(1)} ms`)}
            </view>
            <view display="flex" flexDirection="row" gap={S(6)}>
              {stat('DRAWS', draws() === undefined ? '—' : String(draws()))}
              {stat('SAMPLES', String(samples().length))}
              {stat('MODE', paused() ? 'paused' : 'live')}
            </view>
            <text
              fontSize={T.body}
              color={C.muted}
              width={tv() ? 420 : mobile() ? width() - 2 * pad() : 320}
            >
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
                    {`p50 ${shot.p50.toFixed(1)} ms · p99 ${shot.p99.toFixed(1)} ms · ${shot.hz > 0 ? `${shot.hz} Hz` : 'rate unknown'}`}
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
