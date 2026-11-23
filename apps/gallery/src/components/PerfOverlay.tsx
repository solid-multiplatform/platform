import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
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

const WINDOW = 90;
/** Publish every sixth frame: the overlay must not measure itself. */
const PUBLISH_EVERY = 6;

/** One panel period, or 60 Hz's when the host does not report one. */
const budgetFor = (hz: number): number => (hz > 0 ? 1000 / hz : 1000 / 60);

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[at]!;
}

/**
 * The frame readout, floating over whatever screen is showing. It replaces
 * the Performance screen: the numbers you want when a transition stutters
 * are the ones from that transition, not from a lab you navigated to.
 *
 * It listens to `frameTick` and never asks for a frame, so it costs nothing
 * while the scene is idle (the readout holds its last values). Every sixth
 * frame is published, so the overlay's own signal writes stay off the frame
 * it is measuring.
 */
export function PerfOverlay(props: {
  family: UiFamily;
  /** The shell's content offset (the sidebar's width on desktop). */
  contentX: number;
  width: number;
  height: number;
  /** Furniture at the bottom of the window: a player, a tab bar. */
  bottomInset: number;
  /** The status bar's height, so a top-docked panel clears it. */
  topInset: number;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [hidden, setHidden] = createSignal(false);
  const [hz, setHz] = createSignal(0);
  const [samples, setSamples] = createSignal<Sample[]>([]);
  const [draws, setDraws] = createSignal<number>();

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
    };
    if (typeof renderer?.on !== 'function') return;
    let frames = 0;
    const listener = (_target: unknown, payload?: unknown) => {
      const frame = payload as { delta?: number; cost?: number } | undefined;
      const delta = frame?.delta;
      if (typeof delta !== 'number' || !(delta > 0)) return;
      frames++;
      if (frames % PUBLISH_EVERY !== 0) return;
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
    // A hidden chip measures nothing: the listener costs a reactive write
    // every sixth drawn frame, and sampling the app is the chip's whole
    // job. The effect owns the registration — attached while shown, detached
    // while hidden, values fresh on each reattach.
    createEffect(() => {
      if (hidden()) return;
      renderer.on?.('frameTick', listener);
      frames = 0;
      onCleanup(() => renderer.off?.('frameTick', listener));
    });
    onCleanup(() => renderer.off?.('frameTick', listener));
  });

  const budget = () => budgetFor(hz());
  const last = () => samples()[samples().length - 1];
  const fps = () => {
    const sample = last();
    return sample === undefined ? 0 : 1000 / sample.delta;
  };
  const cost = () => last()?.cost ?? 0;
  const stats = () => {
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
  };
  const pass = () => stats().p99 <= budget() * 1.1;

  const page = () => pageLayout(props.width - props.contentX, props.family);
  const column = 236;
  const inner = column - 2 * S(3);
  const width = () => (expanded() ? column : 136);
  const height = () => (expanded() ? 196 : 30);
  const right = () => props.contentX + page().x + page().width;
  const x = () => (hidden() ? right() - 22 : right() - width() - S(2));
  // A phone has no room for a floating panel above the player: it sits in the
  // header's empty right corner instead, where it covers nothing.
  const y = () =>
    props.family === 'mobile'
      ? props.topInset + S(2)
      : props.height - props.bottomInset - (hidden() ? 22 : height()) - S(3);

  const stat = (label: string, value: string, accent = false) => (
    <view
      display="flex"
      flexDirection="column"
      gap={1}
      width={(inner - S(2)) / 2}
    >
      <text fontSize={10} color={C.dim} letterSpacing={0.8}>
        {label}
      </text>
      <text fontSize={T.caption} color={accent ? C.accent : C.text}>
        {value}
      </text>
    </view>
  );

  const barHeight = (sample: Sample) =>
    Math.max(1, Math.min(44, (sample.delta / Math.max(budget() * 2, 1)) * 44));

  return (
    <Show
      when={hidden() === false}
      fallback={
        <view
          x={x()}
          y={y()}
          width={22}
          height={22}
          borderRadius={11}
          color={C.raised}
          display="flex"
          alignItems="center"
          justifyContent="center"
          zIndex={500}
          role="button"
          ariaLabel="Show performance overlay"
          onEnter={() => setHidden(false)}
          onMouseClick={() => setHidden(false)}
          cursorStyle="pointer"
        >
          <view width={5} height={5} borderRadius={3} color={C.muted} />
        </view>
      }
    >
      <view
        x={x()}
        y={y()}
        width={width()}
        height={height()}
        color={C.surface}
        border={{ width: 1, color: C.line }}
        borderRadius={R.medium}
        padding={expanded() ? [S(3), S(3)] : [0, S(2)]}
        display="flex"
        flexDirection="column"
        gap={S(2)}
        zIndex={500}
      >
        <Show
          when={expanded()}
          fallback={
            <view
              display="flex"
              flexDirection="row"
              alignItems="center"
              justifyContent="spaceBetween"
              height={30}
              width={width() - 2 * S(2)}
              role="button"
              ariaLabel="Expand performance overlay"
              onEnter={() => setExpanded(true)}
              onMouseClick={() => setExpanded(true)}
              cursorStyle="pointer"
            >
              <view
                display="flex"
                flexDirection="row"
                alignItems="center"
                gap={S(2)}
              >
                <view
                  width={6}
                  height={6}
                  borderRadius={3}
                  color={pass() ? 0x6fbf8aff : C.accent}
                />
                <text fontSize={T.caption} color={C.text}>
                  {fps() > 0 ? `${Math.round(fps())} fps` : 'idle'}
                </text>
              </view>
              <text fontSize={10} color={C.dim}>
                {cost() > 0 ? `${cost().toFixed(1)} ms` : ''}
              </text>
            </view>
          }
        >
          {/* Expanded: a header that collapses, the numbers, then the last
              frames as bars. Only the header toggles, so Hide stays Hide. */}
          <view
            display="flex"
            flexDirection="row"
            justifyContent="spaceBetween"
            alignItems="center"
            width={inner}
            height={22}
            role="button"
            ariaLabel="Collapse performance overlay"
            onEnter={() => setExpanded(false)}
            onMouseClick={() => setExpanded(false)}
            cursorStyle="pointer"
          >
            <text fontSize={T.caption} color={C.text}>
              Frame
            </text>
            <view display="flex" flexDirection="row" gap={S(2)}>
              <text fontSize={10} color={C.muted}>
                {fps() > 0 ? `${Math.round(fps())} fps` : 'idle'}
              </text>
              <text fontSize={10} color={C.dim}>
                {hz() > 0 ? `${hz()} Hz` : 'n/a'}
              </text>
            </view>
          </view>
          {/* Two columns, two rows: measured, not wrapped, so a wide value
              cannot push the grid out of shape. */}
          <view display="flex" flexDirection="row" gap={S(2)} width={inner}>
            {stat('P50', `${stats().p50.toFixed(1)} ms`)}
            {stat('P99', `${stats().p99.toFixed(1)} ms`, !pass())}
          </view>
          <view display="flex" flexDirection="row" gap={S(2)} width={inner}>
            {stat('CPU', `${stats().cpu.toFixed(1)} ms`)}
            {stat('DRAWS', draws() === undefined ? 'n/a' : String(draws()))}
          </view>
          <view width={inner} height={44}>
            <For each={samples().slice(-56)}>
              {(sample, index) => (
                <view
                  x={index() * 3}
                  y={44 - barHeight(sample)}
                  width={2}
                  height={barHeight(sample)}
                  color={sample.delta > budget() * 1.1 ? C.accent : 0x4a4a55ff}
                />
              )}
            </For>
            <view
              width={inner}
              height={1}
              y={44 - (budget() / Math.max(budget() * 2, 1)) * 44}
              color={0xffffff2e}
            />
          </view>
          <view
            display="flex"
            flexDirection="row"
            justifyContent="flexEnd"
            width={inner}
          >
            <view
              height={22}
              padding={[0, S(2)]}
              borderRadius={R.small}
              display="flex"
              alignItems="center"
              role="button"
              ariaLabel="Hide performance overlay"
              onEnter={() => setHidden(true)}
              onMouseClick={() => setHidden(true)}
              cursorStyle="pointer"
            >
              <text fontSize={10} color={C.muted}>
                Hide
              </text>
            </view>
          </view>
        </Show>
      </view>
    </Show>
  );
}
