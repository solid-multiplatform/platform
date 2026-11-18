/**
 * SolidTV renderer backend for native Roku SceneGraph.
 *
 * The shared framework owns the scene graph, layout, focus and animation
 * requests; this class only turns nodes into RSG Groups and posts one flush per
 * tick. No WebGL, DOM canvas or second UI is involved.
 */

import type { SceneRenderer } from '../contracts.js';
import type { AnimationSettings } from './animation-types.js';
import type { CompositorAnimation } from './compositor-animation.js';
import { getAppMemoryMonitor, getDeviceInfo } from '@roku-sdk/rsg-ts/runtime';
import { Animator } from './animation.js';
import { FrameClock } from './frame-clock.js';
import { Events } from './events.js';
import { EffectCache } from './effect-cache.js';
import { effectGaps } from './effects.js';
import type { EffectTier } from './effects.js';
import { FontRegistry, fontMetricsFor, fontTable } from './fonts.js';
import type { FontDescription } from './fonts.js';
import type { FontLineMetrics } from './font-metrics.js';
import { layoutText } from './text-layout.js';
import { RokuNode, RokuTexture, ShaderHandle } from './node.js';
import type { RokuNodeProps } from './node.js';

const APP_W = 1920;
const APP_H = 1080;
const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Whether this device draws the Effect node: Roku OS 16 or later on the
 * OpenGL graphics platform, the test Roku's SDK prescribes. Anywhere else
 * the `effect` field is ignored without an error, so effects are drawn from
 * generated images instead. An unknown device is treated as one without.
 */
export function detectEffectTier(): EffectTier {
  try {
    const info = getDeviceInfo();
    if (info && Number(info.osVersion?.major) >= 16 && info.graphicsPlatform === 'opengl') return 'native';
  } catch (error) {
    console.warn('ROKU_DEVICE_INFO unavailable: ' + String((error as any)?.message || error));
  }
  return 'assets';
}

/**
 * What `loadFont` takes: the scene contract's SceneFont with this backend's
 * options. `fontUrl` is the packaged font file, as `import url from
 * './X.ttf'` gives it under the platform's Roku preset; the same import makes
 * the file's layout table at build time.
 */
export interface RokuFont {
  /** The family text names; more than one registers the file under each. */
  fontFamily: string | string[];
  /** More family names for the same file. */
  aliases?: string[];
  fontUrl: string;
  /** 100 to 900, `normal` or `bold`. Default 400. */
  fontWeight?: number | string;
  /** `normal` (default) or `italic`. */
  fontStyle?: string;
  /** Line metrics to lay out with instead of the file's own, as on the WebGL backend. */
  metrics?: FontLineMetrics;
  /** How long the file may take to load, in ms. */
  timeout?: number;
}

export interface SceneGraphHost {
  debug?: boolean;
  hasNativeSync?(): boolean;
  syncOverlays?(deadline: number): boolean;
  markNativeSync?(node: RokuNode, kind: 'position' | 'alpha' | 'geometry'): void;
  canNativeAnimate?(node: RokuNode, key: string, settings: AnimationSettings): boolean;
  createNativeAnimation?(node: RokuNode, key: string, target: number, settings: AnimationSettings): CompositorAnimation | undefined;
}

export class SceneGraphRenderer extends Events implements SceneRenderer<RokuNode, RokuNode> {
  settings: any;
  rootId: any;
  root: RokuNode;
  animator = new Animator();
  stage = this;
  /**
   * How effects are drawn, chosen once: `settings.effectTier` when given (a
   * test forcing the image tier on a device that has Effect), else what the
   * device reports.
   */
  readonly effectTier: EffectTier;
  /** The Effect nodes, shared between nodes with equal values. */
  readonly effects = new EffectCache();

  private nativeRoot: any;
  private dirty = new Set<RokuNode>();
  private flushTimer: any = null;
  private inAnimationFrame = false;
  private ticker = new FrameClock((elapsed) => {
    if (this.destroyed || this.animator.paused) return false;
    this.inAnimationFrame = true;
    try {
      this.animator.tick(elapsed);
      this.flushDirty();
    } finally {
      this.inAnimationFrame = false;
    }
    return this.animator.running;
  }, nowMs);
  private shaderTypes = new Map<string, any>();
  private destroyed = false;
  private fpsTimer: any = null;
  private frameCount = 0;
  private flushMsSum = 0;
  private flushMsMax = 0;
  private flushSamples = 0;
  private memMonitor: any = null;
  private lastStats = { visuals: 0, textures: 0, visibleTextures: 0 };
  private perfBox: RokuNode | null = null;
  private perfLabel: RokuNode | null = null;
  private routeLabel: RokuNode | null = null;
  private dirtyList: RokuNode[] = [];

  /** The fonts registered with this renderer. */
  readonly fonts: FontRegistry;

  constructor(settings: any, rootId: object, readonly host: SceneGraphHost = {}) {
    super();
    this.settings = settings;
    this.rootId = rootId;
    this.nativeRoot = rootId;
    this.effectTier = settings?.effectTier === 'native' || settings?.effectTier === 'assets' ? settings.effectTier : detectEffectTier();
    this.fonts = new FontRegistry(this.nativeRoot, () => this.onFontsChanged());
    // The renderer root is the app group. The host already inserted it into the
    // scene (usually inside a Scene with a solid background).
    this.root = new RokuNode(this, { w: settings?.appWidth ?? APP_W, h: settings?.appHeight ?? APP_H }, this.nativeRoot || undefined, false);
    this.root.parent = null;
    if (this.host.debug) {
      this.perfBox = new RokuNode(this, { w: 330, h: 66, x: 1580, y: 266, zIndex: 10001, color: 0x000000ff }, undefined, false);
      this.perfBox.parent = this.root;
      this.perfLabel = new RokuNode(this, {
        w: 320, h: 30, x: 0, y: 3, fontSize: 14, color: 0xffffffff,
        text: 'perf: waiting', contain: 'width',
      }, undefined, true);
      this.perfLabel.parent = this.perfBox;
      const initialRoute = (globalThis as any).location?.hash || '';
      this.routeLabel = new RokuNode(this, {
        w: 320, h: 26, x: 0, y: 35, fontSize: 12, color: 0xffffffff,
        text: 'route ' + (initialRoute || '?'), contain: 'width',
      }, undefined, true);
      this.routeLabel.parent = this.perfBox;
      this.fpsTimer = setInterval(() => {
      const updates = this.frameCount;
      const samples = this.flushSamples;
      const avgMs = samples > 0 ? this.flushMsSum / samples : 0;
      const maxMs = this.flushMsMax;
      const capacityFps = samples > 0 ? Math.max(1, Math.round(1000 / Math.max(0.1, avgMs))) : 0;
      this.frameCount = 0;
      this.flushMsSum = 0;
      this.flushMsMax = 0;
      this.flushSamples = 0;
      if (this.perfLabel) {
        this.perfLabel.text = updates > 0
          ? 'flush ' + avgMs.toFixed(2) + 'ms · head ' + capacityFps + ' · upd ' + updates + '/s'
          : 'idle · upd 0/s';
      }
      if (this.routeLabel) {
        const route = (globalThis as any).location?.hash || '?';
        this.routeLabel.text = 'route ' + route;
      }
      // The panel's FPS is the number of dirty frames actually produced this
      // second (0 is valid); frame-time headroom is carried separately.
      this.emit('fpsUpdate', { fps: updates, updates, avgFlushMs: avgMs, maxFlushMs: maxMs, capacityFps });
      if (updates > 0) {
        const stats = this.collectStats();
        this.lastStats = stats;
        this.emit('renderUpdate', { quads: stats.visuals, renderOps: stats.visuals });
        console.log(
          'ROKU_PERF updates=' + updates +
          ' avgFlushMs=' + avgMs.toFixed(2) +
          ' maxFlushMs=' + maxMs +
          ' capacityFps=' + capacityFps,
        );
      }
    }, 1000);
    }
    getAppMemoryMonitor()
      .then((monitor) => { this.memMonitor = monitor; })
      .catch((err) => { console.warn('ROKU_MEMORY_MONITOR unavailable: ' + err); });
    console.log('ROKU_RENDERER ready ' + APP_W + 'x' + APP_H + ' effects=' + this.effectTier);
  }

  resize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new RangeError('Invalid viewport size');
    if (this.root.w === width && this.root.h === height) return;
    this.root.w = width;
    this.root.h = height;
    this.requestRender();
  }

  markDirty(node: RokuNode) {
    if (this.destroyed) return;
    this.dirty.add(node);
    if (!this.inAnimationFrame) this.scheduleFlush();
  }

  requestRender() {
    this.scheduleFlush();
  }

  setRoute(route: string) {
    if (this.routeLabel) this.routeLabel.text = 'route ' + String(route || '?');
  }

  /**
   * The fonts changed (one was registered or failed, or the system font
   * became measurable): every text node is flushed, where it lays itself out
   * against the registry's new version.
   */
  private onFontsChanged() {
    // The first registrations come before the root exists.
    if (this.destroyed || !this.root) return;
    const walk = (node: RokuNode) => {
      if (node.destroyed) return;
      if (node.layout !== null) node.markVisual();
      const children = node.children;
      for (let i = 0; i < children.length; i++) walk(children[i]);
    };
    walk(this.root);
  }

  defer(fn: () => void) {
    setTimeout(fn, 0);
  }

  private scheduleFlush() {
    if (this.flushTimer !== null || this.destroyed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 0);
  }

  ensureTicker() {
    if (!this.destroyed && !this.animator.paused) this.ticker.start();
  }

  private flushDirty() {
    if (this.dirty.size === 0 && !this.host.hasNativeSync?.()) return;
    // Reuse the array: this runs on every frame, and Array.from allocated a
    // fresh array for each batch.
    const nodes = this.dirtyList;
    nodes.length = 0;
    this.dirty.forEach((node) => nodes.push(node));
    this.dirty.clear();
    const start = nowMs();
    // One frame = one batch of node writes, whether it came from the batched
    // flush() or from an animation tick. Counting only flush() made the FPS
    // panel under-report animations, which update through the ticker.
    this.frameCount++;
    // Large scenes can produce hundreds of dirty nodes in one tick (route
    // swaps, virtualized rows, font reflow). Never hold the UI thread for a
    // whole frame: write for at most flushBudgetMs, then requeue the rest.
    const budget = Math.max(1, Number(this.settings?.flushBudgetMs ?? 8));
    const deadline = start + budget;
    for (let i = 0; i < nodes.length; i++) {
      if (i > 0 && nowMs() - start >= budget) {
        for (let j = i; j < nodes.length; j++) {
          if (!nodes[j].destroyed) this.dirty.add(nodes[j]);
        }
        this.scheduleFlush();
        break;
      }
      const node = nodes[i];
      if (node.destroyed) continue;
      try {
        node.flush();
      } catch (error) {
        console.error('ROKU_FLUSH ' + node.id + ' ' + String((error as any)?.stack || error));
      }
    }
    try {
      if (this.host.syncOverlays?.(deadline)) this.scheduleFlush();
    } catch (error) {
      console.error('ROKU_OVERLAY_SYNC ' + String((error as any)?.stack || error));
    }
    const elapsed = nowMs() - start;
    this.flushMsSum += elapsed;
    if (elapsed > this.flushMsMax) this.flushMsMax = elapsed;
    this.flushSamples++;
  }

  flush() {
    if (this.destroyed) return;
    this.flushDirty();
    try {
      this.emit('idle');
    } catch (error) {
      console.error('ROKU_IDLE ' + String((error as any)?.stack || error));
    }
    if (this.dirty.size > 0) this.scheduleFlush();
    if (this.animator.running) this.ensureTicker();
  }

  // ---- renderer contract ------------------------------------------------

  createNode(props: RokuNodeProps = {}): RokuNode {
    const node = new RokuNode(this, props, undefined, false);
    return node;
  }

  createTextNode(props: RokuNodeProps = {}): RokuNode {
    const node = new RokuNode(this, props, undefined, true);
    return node;
  }

  /** Effect props (radius, border-*, shadow-*, gradient colors) under a kind name; see effects.ts for how each tier draws them. */
  createShader(name: string | { name?: unknown; shaderType?: unknown }, props: Record<string, any> = {}): ShaderHandle {
    const typeName = typeof name === 'string' ? name : String(name?.name || name?.shaderType || 'shader');
    return new ShaderHandle(typeName, props);
  }

  createTexture(type: string, props: Record<string, any> = {}): RokuTexture {
    return new RokuTexture(String(type), props);
  }

  registerShaderType(name: any, shaderType?: any) {
    const key = typeof name === 'string' ? name : String(name?.name || '');
    if (key) this.shaderTypes.set(key, shaderType || name);
  }

  registerShader(name: any, shaderType?: any) {
    this.registerShaderType(name, shaderType);
  }

  /**
   * The size a text node created with `props` reads as `w` and `h`, without
   * making one (the WebGL backend's measureText). Null while the text's font
   * cannot be measured: the system font, before the firmware has it.
   */
  measureText(props: RokuNodeProps): { w: number; h: number } | null {
    const face = this.fonts.acquire(String(props.fontFamily || ''), props.fontWeight, props.fontStyle, props.fontSize || 32);
    try {
      if (!face.measurable) return null;
      const layout = layoutText({
        text: String(props.text ?? ''),
        font: face.font,
        lineHeight: props.lineHeight || 1.2,
        maxWidth: props.maxWidth || 0,
        maxHeight: props.maxHeight || 0,
        maxLines: props.maxLines || 0,
        textAlign: (props.textAlign || 'left') as any,
        verticalAlign: 'top',
        contain: 'none',
        wordBreak: (props.wordBreak || 'break-word') as any,
        overflowSuffix: props.overflowSuffix ?? '...',
        letterSpacing: props.letterSpacing || 0,
        offsetY: 0,
        rtl: false,
      });
      return { w: layout.width, h: layout.height };
    } finally {
      this.fonts.release(face);
    }
  }

  getCapabilities() {
    return {
      renderMode: 'scenegraph',
      webGlVersion: 0,
      maxTextureSize: 2048,
      shaders: false,
      /** `native`: the Effect node. `assets`: generated images, square corners. */
      effects: this.effectTier,
      /** What was asked for and could not be drawn as asked, so far. */
      effectGaps: effectGaps(),
    };
  }

  private collectStats() {
    const stats = { visuals: 0, textures: 0, visibleTextures: 0 };
    const walk = (node: any) => {
      if (!node || (node as any)._destroyed) return;
      const visual = node.nativeVisual;
      if (visual) {
        stats.visuals++;
        if (visual.__type === 'poster') {
          stats.textures++;
          if ((node as any)._alpha > 0.001 && (node as any)._w > 0 && (node as any)._h > 0) {
            stats.visibleTextures++;
          }
        }
      }
      const kids = (node as any)._children || [];
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    walk(this.root);
    return stats;
  }

  memoryInfo() {
    let criticalThreshold = 0;
    let targetThreshold = 0;
    let renderableMemUsed = 0;
    let memUsed = 0;
    if (this.memMonitor) {
      try {
        const limit = this.memMonitor.getChannelMemoryLimit();
        const pct = this.memMonitor.getMemoryLimitPercent();
        let max = Number(limit?.maxForegroundMemory || 0);
        // Roku documents channel memory in KB; some runtimes/tests expose bytes.
        if (max > 0 && max < 10_000_000) max *= 1024;
        if (max > 0) {
          criticalThreshold = max * 0.8;
          targetThreshold = max * 0.64;
          memUsed = max * (Math.max(0, Math.min(100, pct)) / 100);
          renderableMemUsed = memUsed;
        }
      } catch (err) {
        // Leave the panel at zero rather than inventing a number.
      }
    }
    const stats = this.collectStats();
    this.lastStats = stats;
    return {
      renderBufferSize: 0,
      textureMemory: 0,
      usedTextureMemory: 0,
      totalTextureMemory: 0,
      jsHeapSizeLimit: 0,
      totalJSHeapSize: 0,
      usedJSHeapSize: 0,
      criticalThreshold,
      targetThreshold,
      renderableMemUsed,
      memUsed,
      renderableTexturesLoaded: stats.visibleTextures,
      loadedTextures: stats.textures,
    };
  }

  /** Registers a font file with its layout table; text naming the family lays out from it from now on. */
  registerFont(font: FontDescription): void {
    this.fonts.registerFont(font);
  }

  /**
   * Registers a font and loads its file (the scene contract's entry; the
   * 1.x form `loadFont(kind, options)` works too). Resolves when the firmware
   * has the font. Rejects when the file has no layout table (it was not
   * imported, so the build made none) or did not load within `timeout`;
   * the family's text then uses another weight of it or the system font.
   */
  loadFont(font: RokuFont | string, options?: object): Promise<void> {
    const given = (typeof font === 'string' ? options : font) as RokuFont | undefined;
    const names = ([] as string[]).concat(given?.fontFamily ?? [], given?.aliases ?? []);
    const uri = given?.fontUrl;
    if (!given || names.length === 0 || typeof uri !== 'string')
      return Promise.reject(new Error('loadFont needs fontFamily and fontUrl (an imported .ttf or .otf)'));
    let metrics = fontTable(uri);
    if (metrics === undefined)
      return Promise.reject(
        new Error('no layout table for ' + uri + ": import the font file (import url from './X.ttf') so the build makes one"),
      );
    if (given.metrics) {
      try {
        metrics = fontMetricsFor(uri)!.withLineMetrics(given.metrics);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.all(
      names.map((family) =>
        this.fonts.load({ family, weight: given.fontWeight, style: given.fontStyle, uri, metrics }, given.timeout),
      ),
    ).then(() => undefined);
  }

  loadFonts(fonts: RokuFont[] = []): Promise<void> {
    return Promise.all(fonts.map((font) => this.loadFont(font))).then(() => undefined);
  }

  pause() {
    this.animator.paused = true;
    this.ticker.stop();
  }

  resume() {
    this.animator.paused = false;
    this.requestRender();
  }

  reprocessUpdates(callback: () => void) {
    setTimeout(callback, 0);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.fpsTimer !== null) clearInterval(this.fpsTimer);
    this.fpsTimer = null;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.ticker.stop();
    this.flushTimer = null;
    this.animator.clear();
    try {
      this.root.destroy();
    } catch (error) {
      console.error('ROKU_DESTROY ' + String((error as any)?.message || error));
    }
    this.dirty.clear();
    this.removeAllListeners();
    this.fonts.destroy();
  }
}

export { RokuNode } from './node.js';
export { RokuTexture, ShaderHandle } from './node.js';
