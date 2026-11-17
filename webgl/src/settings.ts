import {
  CORE_DEFAULTS,
  resolveQuadBufferSize,
  type CoreSettings,
} from './core/RendererCore.js';
import { normalizeBoundsMargin, type BoundsMargin } from './common/types.js';
import type { PlatformConstructor } from './platform/Platform.js';
import type { Inspector, InspectorOptions } from './inspector/Inspector.js';

/** Texture memory thresholds (1.10 TextureMemoryManagerSettings); used from phase 3. */
export interface TextureMemorySettings {
  criticalThreshold: number;
  targetThresholdLevel: number;
  cleanupInterval: number;
  debugLogging: boolean;
  baselineMemoryAllocation: number;
  doNotExceedCriticalThreshold: boolean;
}

export type { TextBaselineMode } from './core/text/TextLayout.js';

/** The settings `setOptions` can change at runtime (spec 13.2). */
export interface RendererRuntimeSettings {
  /** Canvas clear colour, 0xRRGGBBAA. Default 0 (transparent). */
  clearColor: number;
  /** Frame cap in frames per second; 0 or less (the default) is uncapped. */
  targetFPS: number;
  /**
   * The panel's refresh rate in Hz, to step animations by whole display
   * frames at that rate instead of by the frame delta; 0 or less (the
   * default) steps by the delta. For hosts whose animation-frame timestamps
   * jitter about the panel's vsync (a callback a busy main thread delayed, a
   * host that calls back faster than the panel), where the delta makes
   * motion speed up and slow down from one frame to the next. Time not
   * stepped carries over, so animations keep wall-clock time. A frame steps
   * at least one display frame while the callbacks keep pace with the panel
   * (each takes its own vsync), and may step zero only on a host measured to
   * call back faster than it. Set it to the panel's rate: any other rate
   * judders. `frameTick`, the telemetry and shader time keep the delta.
   * Experimental.
   */
  animationSnapRate: number;
  /**
   * Preload ring around the viewport, in logical px: one value for every
   * side, or a per-side `[top, right, bottom, left]` tuple. Read back as
   * the tuple. Default `[100, 100, 450, 50]`.
   */
  boundsMargin: number | BoundsMargin;
  /** Texture memory thresholds (phase 3). */
  textureMemory: Partial<TextureMemorySettings>;
  /**
   * Frame telemetry (`fpsUpdate` and `renderUpdate`): the sample interval
   * in ms; 0 (the default) samples nothing.
   */
  fpsUpdateInterval: number;
  /** Texture upload budget per idle frame in ms (phase 3). Default 25. */
  textureProcessingTimeLimit: number;
  /**
   * The DOM inspector (`Inspector` from `@solidtv/renderer/inspector`), or
   * false (the default). Built only in a build with `__enableInspector__`
   * on; a production build ignores it.
   */
  inspector: typeof Inspector | false;
  /** Its monitoring options, read when it is built. */
  inspectorOptions: Partial<InspectorOptions>;
}

/**
 * Every renderer setting (spec 13.2). App size and pixel ratios are fixed
 * at construction: programs compile them in.
 */
export interface RendererSettings
  extends RendererRuntimeSettings,
    CoreSettings {
  canvas: HTMLCanvasElement;
  platform: PlatformConstructor | null;
  /** 0 or 1: one worker beats a pool on the target TVs. */
  numImageWorkers: number;
  imageDecodeConcurrency: number;
  createImageBitmapSupport: 'auto' | 'basic' | 'options' | 'full';
  premultiplyAlphaHonored: boolean | 'auto';
  maxRetryCount: number;
  enableContextSpy: boolean;
  forceWebGL2: boolean;
  disableVertexArrayObject: boolean;
  powerPreference: WebGLPowerPreference;
  /** Receives an error thrown inside a frame; the loop keeps running. Default: swallow. */
  handleLoopError: (error: unknown) => void;
  /**
   * ms a frame requested while no animation frame is on its way (the loop
   * waking from sleep) waits for one before a timer runs it instead: some
   * hosts (Xumo's WPE) stop delivering animation frames once none has been
   * requested for a while, until input arrives. 0 or less turns it off.
   * Default 50.
   */
  wakeFallbackDelay: number;
  /**
   * Once the loop goes idle, ask the platform to put the last drawn frame
   * on screen (`Platform.present`: the web platform flips the canvas's
   * opacity between 1 and 0.999, so the canvas's inline opacity is the
   * renderer's while this is on), for hosts (Xumo's WPE) that show a WebGL
   * frame drawn in an animation frame woken from idle only once something
   * repaints the page. The cost is one style write per idle period.
   * Default false.
   */
  presentOnIdle: boolean;
  /**
   * Experimental: upload browser-decoded images of at most half a page
   * (511 px a side) into shared 1024 x 1024 RGBA pages instead of a texture
   * each, so quads of different images batch into one draw
   * (docs/superpowers/plans/2026-10-18-renderer-v2-atlas-pages.md). Memory
   * is counted, and freed, by page. A node's `atlasGroup` keeps the images
   * of its subtree on pages of their own. Not yet safe with LinearGradient,
   * HolePunch or Blur on an image node, which read texture coordinates as
   * the node's. Default false.
   */
  imageAtlas: boolean;
}

// What a runtime change does beyond storing the value; bit flags so that
// one setOptions call runs each effect once. 0: read where it is used.
export const APPLY_CLEAR_COLOR = 1;
export const APPLY_TARGET_FPS = 2;
export const APPLY_BOUNDS_MARGIN = 4;
export const APPLY_TEXTURE_MEMORY = 8;
export const APPLY_TELEMETRY = 16;
export const APPLY_INSPECTOR = 32;
export const APPLY_INSPECTOR_OPTIONS = 64;
export const APPLY_ANIMATION_SNAP = 128;

type RuntimeKey = keyof RendererRuntimeSettings;

export interface RuntimeSetting<K extends RuntimeKey> {
  /** Defaults and normalization; `current` is the value in effect, undefined at construction. */
  resolve: (
    value: RendererRuntimeSettings[K] | undefined,
    current: RendererRuntimeSettings[K] | undefined,
  ) => RendererRuntimeSettings[K];
  effect: number;
}

const positive = (value: number | undefined, fallback: number): number =>
  value !== undefined && value > 0 ? value : fallback;

const resolveTextureMemory = (
  value: Partial<TextureMemorySettings> | undefined,
  current: Partial<TextureMemorySettings> | undefined,
): TextureMemorySettings => {
  const v = value ?? {};
  const c = current ?? {};
  return {
    criticalThreshold: v.criticalThreshold ?? c.criticalThreshold ?? 200e6,
    targetThresholdLevel:
      v.targetThresholdLevel ?? c.targetThresholdLevel ?? 0.8,
    cleanupInterval: v.cleanupInterval ?? c.cleanupInterval ?? 5000,
    debugLogging: v.debugLogging ?? c.debugLogging ?? false,
    baselineMemoryAllocation:
      v.baselineMemoryAllocation ?? c.baselineMemoryAllocation ?? 26e6,
    doNotExceedCriticalThreshold:
      v.doNotExceedCriticalThreshold ?? c.doNotExceedCriticalThreshold ?? false,
  };
};

/**
 * Every runtime setting: how it resolves and what a change does. The
 * constructor and setOptions both resolve through this table, and the
 * mapped type fails to compile until a new runtime setting has an entry.
 */
export const runtimeSettings: { [K in RuntimeKey]: RuntimeSetting<K> } = {
  clearColor: { resolve: (v) => v ?? 0, effect: APPLY_CLEAR_COLOR },
  // Undefined or 0 or less is uncapped: the loop draws on every vsync.
  targetFPS: {
    resolve: (v) => (v !== undefined && v > 0 ? v : 0),
    effect: APPLY_TARGET_FPS,
  },
  // Undefined or 0 or less steps animations by the frame delta.
  animationSnapRate: {
    resolve: (v) => positive(v, 0),
    effect: APPLY_ANIMATION_SNAP,
  },
  boundsMargin: {
    resolve: (v) => normalizeBoundsMargin(v ?? CORE_DEFAULTS.boundsMargin),
    effect: APPLY_BOUNDS_MARGIN,
  },
  // 1.10's effect: apply the new thresholds, then run a cleanup.
  textureMemory: {
    resolve: resolveTextureMemory,
    effect: APPLY_TEXTURE_MEMORY,
  },
  // Attaches, restarts or detaches the telemetry.
  fpsUpdateInterval: {
    resolve: (v) => positive(v, 0),
    effect: APPLY_TELEMETRY,
  },
  textureProcessingTimeLimit: { resolve: (v) => positive(v, 25), effect: 0 },
  // 1.10's effects: build or tear down the inspector on a toggle, and,
  // since it reads its options only when built, build it anew for new ones.
  inspector: { resolve: (v) => v ?? false, effect: APPLY_INSPECTOR },
  inspectorOptions: {
    resolve: (v) => v ?? {},
    effect: APPLY_INSPECTOR_OPTIONS,
  },
};

const initial = <K extends RuntimeKey>(
  key: K,
  value: RendererRuntimeSettings[K] | undefined,
): RendererRuntimeSettings[K] => runtimeSettings[key].resolve(value, undefined);

const noop = (): void => {};

const windowPixelRatio = (): number | undefined =>
  typeof window !== 'undefined' ? window.devicePixelRatio : undefined;

/**
 * Resolve every setting key by key with 1.10's defaults (Renderer.ts
 * 966-1027), without Object.assign (Chrome 45).
 * `canvas` is the canvas in use: the app's, or one the platform created.
 */
export function resolveSettings(
  s: Partial<RendererSettings>,
  canvas: HTMLCanvasElement,
): RendererSettings {
  return {
    appWidth: positive(s.appWidth, CORE_DEFAULTS.appWidth),
    appHeight: positive(s.appHeight, CORE_DEFAULTS.appHeight),
    deviceLogicalPixelRatio: positive(
      s.deviceLogicalPixelRatio,
      CORE_DEFAULTS.deviceLogicalPixelRatio,
    ),
    devicePhysicalPixelRatio: positive(
      s.devicePhysicalPixelRatio,
      positive(windowPixelRatio(), CORE_DEFAULTS.devicePhysicalPixelRatio),
    ),
    quadBufferSize: resolveQuadBufferSize(s.quadBufferSize),
    canvas,
    platform: s.platform ?? null,
    clearColor: initial('clearColor', s.clearColor),
    targetFPS: initial('targetFPS', s.targetFPS),
    animationSnapRate: initial('animationSnapRate', s.animationSnapRate),
    boundsMargin: initial('boundsMargin', s.boundsMargin),
    textureMemory: initial('textureMemory', s.textureMemory),
    fpsUpdateInterval: initial('fpsUpdateInterval', s.fpsUpdateInterval),
    textureProcessingTimeLimit: initial(
      'textureProcessingTimeLimit',
      s.textureProcessingTimeLimit,
    ),
    inspector: initial('inspector', s.inspector),
    inspectorOptions: initial('inspectorOptions', s.inspectorOptions),
    textLayoutCacheSize:
      s.textLayoutCacheSize ?? CORE_DEFAULTS.textLayoutCacheSize,
    idleTextLayouts: s.idleTextLayouts ?? CORE_DEFAULTS.idleTextLayouts,
    textBaselineMode: s.textBaselineMode ?? CORE_DEFAULTS.textBaselineMode,
    numImageWorkers:
      s.numImageWorkers === undefined ? 1 : Math.min(s.numImageWorkers, 1),
    imageDecodeConcurrency: s.imageDecodeConcurrency ?? 14,
    createImageBitmapSupport: s.createImageBitmapSupport ?? 'auto',
    premultiplyAlphaHonored: s.premultiplyAlphaHonored ?? true,
    maxRetryCount: s.maxRetryCount ?? 5,
    enableContextSpy: s.enableContextSpy ?? false,
    forceWebGL2: s.forceWebGL2 ?? false,
    disableVertexArrayObject: s.disableVertexArrayObject ?? false,
    powerPreference: s.powerPreference ?? 'default',
    handleLoopError: s.handleLoopError ?? noop,
    wakeFallbackDelay:
      s.wakeFallbackDelay === undefined
        ? 50
        : s.wakeFallbackDelay > 0
        ? s.wakeFallbackDelay
        : 0,
    presentOnIdle: s.presentOnIdle ?? false,
    imageAtlas: s.imageAtlas ?? false,
  };
}
