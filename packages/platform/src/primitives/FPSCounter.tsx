/**
 * A frame-rate and frame-time meter, and the telemetry-backed counter the
 * primitives shipped with.
 *
 * The meter samples the renderer's own `frameTick` — a frame the renderer
 * was already drawing — so it never schedules a frame itself. It attaches
 * its listener when it is mounted and removes it when it is unmounted
 * (`App` renders it only while the person has asked for it, off by default):
 * hidden, it has no timer, no listener and no cost.
 *
 * The readout is published at most once every three frames. A publish
 * changes a signal, which asks for one frame; needing three frames since the
 * last publish keeps that one induced frame from publishing again, so an idle
 * scene reaches zero frames with the meter open, as it does with it closed.
 */
import {
  getRenderer,
  type NodeProps,
  RendererMain,
} from '@solid-multiplatform/platform';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { displayRefreshRate, onDisplayChange } from '../sdk/display.js';
import { viewport } from '../sdk/viewport.js';

// ---- The meter

/** Frames that must arrive before the readout is published again. */
const REPAINT_FRAMES = 3;
/** The averaging window, in milliseconds of frame time. */
const WINDOW_MS = 1000;

interface FrameSource {
  on?(event: string, listener: (target: unknown, data?: unknown) => void): void;
  off?(
    event: string,
    listener: (target: unknown, data?: unknown) => void,
  ): void;
}

/** Read-only counters `RendererCore` keeps for its own last update. */
interface RenderCounters {
  flushedOps?: number;
  ops?: { length?: number };
  scene?: { quads?: number };
}

interface FrameTickPayload {
  time?: number;
  delta?: number;
  /** The previous frame's own work, in milliseconds. */
  cost?: number;
}

export interface FPSReadout {
  /** Frames per second implied by the last frame's delta. */
  instant: number;
  /** Frames divided by the time they took, over the last second. */
  average: number;
  /** The last frame's time in milliseconds. */
  last: number;
  /** The previous frame's own work (scene walk and draw), in milliseconds. */
  cost: number;
  /** Median and 99th-percentile frame time over the window, in ms. */
  p50: number;
  p99: number;
  /** Ops drawn by the renderer's last update, when it reports them. */
  draws: number | undefined;
  /** Quads in the last update, when the renderer reports them. */
  quads: number | undefined;
  /** False until the first frames are sampled. */
  sampled: boolean;
}

const EMPTY: FPSReadout = {
  instant: 0,
  average: 0,
  last: 0,
  cost: 0,
  p50: 0,
  p99: 0,
  draws: undefined,
  quads: undefined,
  sampled: false,
};

const percentile = (sorted: number[], fraction: number): number =>
  sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(fraction * sorted.length) - 1),
    )
  ]!;

export const FPSCounter = (props: NodeProps) => {
  const [readout, setReadout] = createSignal<FPSReadout>(EMPTY);
  // The panel's rate, kept by the display service's change listener: read
  // once, then event-driven. Asking the display synchronously from the
  // readout would cross into native code on every repaint, three frames
  // apart — the very cost the meter exists to expose.
  const [hz, setHz] = createSignal(0);
  const rate = (value: number) => setHz(value > 0 ? Math.round(value) : 0);

  onMount(() => {
    rate(displayRefreshRate());
    const stopDisplay = onDisplayChange((info) => rate(info.refreshRate));
    const renderer = getRenderer() as unknown as
      | (FrameSource & RenderCounters)
      | undefined;
    if (typeof renderer?.on !== 'function') {
      onCleanup(stopDisplay);
      return;
    }

    // Frame times inside the window, with the running clock they end at.
    const window: { delta: number; at: number }[] = [];
    let clock = 0;
    let frames = 0;
    let published = 0;

    const listener = (_target: unknown, payload?: unknown) => {
      const frame = payload as FrameTickPayload | undefined;
      const delta = frame?.delta;
      if (typeof delta !== 'number' || !(delta > 0) || !isFinite(delta)) return;
      const cost =
        typeof frame?.cost === 'number' && isFinite(frame.cost)
          ? frame.cost
          : 0;
      frames++;
      clock += delta;
      window.push({ delta, at: clock });
      while (window.length > 1 && clock - window[0]!.at > WINDOW_MS)
        window.shift();
      // A publish asks for one frame. Requiring several since the previous
      // one means that induced frame cannot publish in turn.
      if (frames - published < REPAINT_FRAMES) return;
      published = frames;

      const recent = window.map((sample) => sample.delta);
      const total = recent.reduce((sum, value) => sum + value, 0);
      const sorted = [...recent].sort((a, b) => a - b);
      const draws = renderer.flushedOps;
      setReadout({
        instant: 1000 / delta,
        average: total > 0 ? (recent.length * 1000) / total : 0,
        last: delta,
        cost,
        p50: percentile(sorted, 0.5),
        p99: percentile(sorted, 0.99),
        draws:
          typeof draws === 'number'
            ? draws + (renderer.ops?.length ?? 0)
            : undefined,
        quads: renderer.scene?.quads,
        sampled: true,
      });
    };

    renderer.on('frameTick', listener);
    onCleanup(() => {
      renderer.off?.('frameTick', listener);
      stopDisplay();
    });
  });

  // A phone-sized panel leaves a margin; on a television the same panel sits
  // in the corner. It is a scene node like any other, drawn over the screen.
  const width = () => Math.min(320, viewport().width - 24);
  const x = () => viewport().width - width() - 12;
  const ms = (value: number) =>
    value < 10 ? value.toFixed(1) : String(Math.round(value));
  const fps = (value: number) => (value > 0 ? String(Math.round(value)) : '–');
  const label = () => {
    const r = readout();
    if (!r.sampled) return 'Frames per second: measuring';
    return `Frames per second: ${fps(r.instant)}, average ${fps(r.average)} over 1 s. Frame ${ms(r.last)} ms, cpu ${ms(r.cost)} ms, p50 ${ms(r.p50)}, p99 ${ms(r.p99)}.${
      hz() > 0 ? ` Display ${hz()} Hz.` : ''
    } ${r.draws === undefined ? 'Draw count unavailable' : `${r.draws} draws`}${
      r.quads === undefined ? '' : `, ${r.quads} quads`
    }.`;
  };

  return (
    <view
      {...props}
      x={x()}
      y={12}
      width={width()}
      height={96}
      color={0x000000dd}
      borderRadius={8}
      zIndex={100}
      role="status"
      ariaLabel={label()}
    >
      <text x={12} y={8} fontSize={20} color={0xf6f6f6ff}>
        {`FPS ${fps(readout().instant)}`}
      </text>
      <text x={130} y={11} fontSize={14} color={0x9fb0c3ff}>
        {`avg ${fps(readout().average)} / 1 s`}
      </text>
      <text x={12} y={36} fontSize={14} color={0xd5dee8ff}>
        {readout().sampled
          ? `frame ${ms(readout().last)} ms  p50 ${ms(readout().p50)}  p99 ${ms(readout().p99)}`
          : 'frame time: measuring'}
      </text>
      <text x={12} y={56} fontSize={14} color={0xd5dee8ff}>
        {readout().draws === undefined
          ? 'draws: not reported by this backend'
          : `draws ${readout().draws}${readout().quads === undefined ? '' : `  quads ${readout().quads}`}`}
      </text>
      <text x={12} y={76} fontSize={12} color={0x9fb0c3ff}>
        {`${hz() > 0 ? `display ${hz()} Hz` : 'display rate unknown'}  ·  cpu ${
          readout().sampled ? `${ms(readout().cost)} ms` : '–'
        }`}
      </text>
    </view>
  );
};

// ---- The telemetry-backed counter (setupFPS)

const fpsStyle = {
  color: 0x000000ff,
  height: 216,
  width: 330,
  x: 1900,
  y: 6,
  mountX: 1,
  alpha: 1,
  zIndex: 100,
};

const fpsLabel = {
  x: 10,
  fontSize: 20,
  textColor: 0xf6f6f6ff,
};

const fpsValue = {
  fontSize: 22,
  textColor: 0xf6f6f6ff,
};

const [fps, setFps] = createSignal(0);
const [avgFps, setAvgFps] = createSignal(0);
const [minFps, setMinFps] = createSignal(99);
const [maxFps, setMaxFps] = createSignal(0);
const [quads, setQuads] = createSignal(0);
const [criticalThresholdSignal, setCriticalThresholdSignal] = createSignal('');
const [targetThresholdSignal, setTargetThresholdSignal] = createSignal('');
const [renderableMemUsedSignal, setRenderableMemUsedSignal] = createSignal('');
const [memUsedSignal, setMemUsedSignal] = createSignal('');
const [renderableTexturesLoadedSignal, setRenderableTexturesLoadedSignal] =
  createSignal(0);
const [loadedTexturesSignal, setLoadedTexturesSignal] = createSignal(0);
const [renderOps, setRenderOps] = createSignal(0);

interface RenderUpdatePayload {
  quads: number;
  renderOps: number;
}

let count = 0;
let totalFps = 0;
const infoFontSize = 14;

export const resetCounter = () => {
  // clear fps
  totalFps = 0;
  count = 0;
  setMinFps(99);
};

function bytesToMb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' Mb';
}

const calcFps = (fps: number) => {
  if (!fps) return;

  setFps(fps);
  setMinFps((prev) => Math.min(fps, prev));
  setMaxFps((prev) => Math.max(fps, prev));

  totalFps += fps;
  count++;

  setAvgFps(Math.round(totalFps / count));
};

function updateMemoryInfo(renderer: RendererMain) {
  // memoryInfo is optional in the scene contract: not every backend has it.
  const memInfo = renderer.memoryInfo?.();
  if (!memInfo) return;
  setCriticalThresholdSignal(bytesToMb(memInfo.criticalThreshold));
  setTargetThresholdSignal(bytesToMb(memInfo.targetThreshold));
  setRenderableMemUsedSignal(bytesToMb(memInfo.renderableMemUsed));
  setMemUsedSignal(bytesToMb(memInfo.memUsed));
  setRenderableTexturesLoadedSignal(memInfo.renderableTexturesLoaded);
  setLoadedTexturesSignal(memInfo.loadedTextures);
}

let frameCount = 0;
export function setupFPS(root: any) {
  root.renderer.on('fpsUpdate', (target: RendererMain, fpsData: any) => {
    const fps = typeof fpsData === 'number' ? fpsData : fpsData.fps;
    // ignore really low fps which occur on page loads
    if (fps > 5) {
      calcFps(fps);
      if (frameCount % 10 === 0) {
        updateMemoryInfo(target);
        frameCount = 0;
      }
      frameCount++;
    }
  });

  root.renderer.on(
    'renderUpdate',
    (target: RendererMain, quadsData: RenderUpdatePayload) => {
      setQuads(quadsData.quads);
      setRenderOps(quadsData.renderOps);
    },
  );
}

/**
 * The telemetry panel: it reads the renderer's `fpsUpdate` and
 * `renderUpdate` events, which exist only while `fpsUpdateInterval` is
 * above 0. Call `setupFPS(root)` first; the renderer then owns a sampler
 * timer, so this panel is not part of the idle scene. The `FPSCounter`
 * above is the one the showcase uses.
 */
export const TelemetryCounter = (props: NodeProps) => {
  return (
    <view {...props} style={fpsStyle}>
      <view y={6}>
        <text style={fpsLabel}>FPS:</text>
        <text style={fpsValue} x={90}>
          {fps().toString()}
        </text>
      </view>

      <view y={6} x={160}>
        <text style={fpsLabel}>AVG:</text>
        <text style={fpsValue} x={100}>
          {avgFps().toString()}
        </text>
      </view>

      <view x={0} y={26}>
        <text style={fpsLabel}>MIN:</text>
        <text style={fpsValue} x={90}>
          {minFps().toString()}
        </text>
      </view>

      <view x={160} y={26}>
        <text style={fpsLabel}>MAX:</text>
        <text style={fpsValue} x={100}>
          {maxFps().toString()}
        </text>
      </view>

      <view display="flex" flexDirection="column" y={58} gap={4}>
        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            criticalThreshold:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {criticalThresholdSignal()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            targetThreshold:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {targetThresholdSignal()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            renderableMemUsed:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {renderableMemUsedSignal()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            memUsed:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {memUsedSignal()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            Textures In Memory:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {loadedTexturesSignal().toString()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            Textures On Screen:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {renderableTexturesLoadedSignal().toString()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            Quads:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {quads().toString()}
          </text>
        </view>

        <view height={infoFontSize}>
          <text fontSize={infoFontSize} style={fpsLabel}>
            Draws:
          </text>
          <text fontSize={infoFontSize} style={fpsLabel} x={230}>
            {renderOps().toString()}
          </text>
        </view>
      </view>
    </view>
  );
};
