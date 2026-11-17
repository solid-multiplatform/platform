import { Node, type NodeExtras } from '../core/nodes/Node.js';
import type { NodeStore } from '../core/nodes/NodeStore.js';
import type { TextNode } from '../core/nodes/TextNode.js';
import type { PassHooks } from '../core/scene/ScenePass.js';
import type { TextureStore } from '../core/textures/TextureStore.js';
import {
  KIND_COLOR,
  KIND_NOISE,
  KIND_SUB,
  TX_DECODED,
  TX_UPLOADED,
} from '../core/textures/TextureStore.js';
import { TEXTURE_STATE_NAMES } from '../core/textures/Texture.js';
import { TextureErrorCode } from '../core/textures/TextureError.js';
import type { SubRegion } from '../core/textures/uvRect.js';
import type { AnimationManager } from '../core/animation/AnimationManager.js';
import type { Animation } from '../core/animation/Animation.js';
import type { AnimationControllerState } from '../common/types.js';
import {
  DIRTY_ALPHA,
  DIRTY_CLIP,
  DIRTY_COLOR,
  DIRTY_DIRECTION,
  DIRTY_INHERITED,
  DIRTY_LAYOUT,
  DIRTY_LOCAL,
  DIRTY_SHADER,
  DIRTY_TEXTURE,
  NULL,
  ST_RTL,
  ST_TEXT,
  ST_WANT,
  VIS_IN_VIEWPORT,
  VIS_INIT,
  VIS_OUT,
  visibilityOf,
} from '../core/nodes/NodeFlags.js';
import {
  F_ALPHA,
  F_MOUNT_X,
  F_MOUNT_Y,
  F_ROTATION,
  F_SCALE_X,
  F_SCALE_Y,
  F_STRIDE,
  F_W,
  F_X,
  F_Y,
  F_Z_INDEX,
  I_COLOR_TL,
  I_FIRST_CHILD,
  I_OWNER_NEXT,
  I_PARENT,
  I_SOURCE_TEXTURE,
  I_STATE,
  I_STRIDE,
  I_UID,
} from '../core/nodes/NodeLayout.js';

/**
 * Inspector options (1.10's), read at construction: a change through
 * `setOptions({ inspectorOptions })` builds the inspector anew.
 */
export interface InspectorOptions {
  /**
   * Count, per node, the frames it changed in, and warn when a node
   * changes in `excessiveCallThreshold` frames within `resetInterval` ms
   * (1.10 counted setter calls: v2 has no hook per call, spec 12.4).
   *
   * @defaultValue false
   */
  enablePerformanceMonitoring: boolean;
  /** @defaultValue 100 */
  excessiveCallThreshold: number;
  /** @defaultValue 5000 */
  resetInterval: number;
  /**
   * Record animation starts and stops (see `getActiveAnimations` and
   * `getAnimationStats`).
   *
   * @defaultValue false
   */
  enableAnimationMonitoring: boolean;
  /** @defaultValue 1000 */
  maxAnimationHistory: number;
  /**
   * Log the animation statistics every this many seconds; 0 never.
   *
   * @defaultValue 0
   */
  animationStatsInterval: number;
}

/** One node's changes (`Inspector.getPerformanceStats`). */
export interface InspectorChangeStats {
  /** The node's uid. */
  nodeId: number;
  /** Frames it changed in since `timeWindow` ms ago. */
  count: number;
  timeWindow: number;
}

/** An animation running or paused (`Inspector.getActiveAnimations`). */
export interface InspectorAnimation {
  /** The animated node's uid. */
  nodeId: number;
  animationId: string;
  startTime: number;
  duration: number;
  elapsedTime: number;
  state: AnimationControllerState;
}

/** An animation that ended. */
interface AnimationRecord {
  nodeId: number;
  animationId: string;
  startTime: number;
  endTime: number;
  duration: number;
  actualDuration: number;
  completionType: 'finished' | 'stopped';
}

/** The settings the inspector reads (the renderer's). */
export interface InspectorSettings {
  appWidth: number;
  appHeight: number;
  deviceLogicalPixelRatio: number;
  inspectorOptions: Partial<InspectorOptions>;
}

/** What the inspector reads and chains on its renderer (RendererCore has it all). */
export interface InspectorOwner {
  readonly nodes: NodeStore;
  readonly root: Node;
  readonly hooks: PassHooks;
  readonly textures: TextureStore;
  readonly animationManager: AnimationManager;
  requestRender(): void;
}

// Feed bits beside the dirty bits (0 to 9) a write raises.
/** The node is in the changed list. */
const M_LISTED = 1 << 30;
/** data, componentName or componentLocation written (no dirty bit). */
const M_META = 1 << 28;
/** Its visibility changed (the render state attribute). */
const M_STATE = 1 << 27;
/** Its text was laid out (the element takes the layout's size). */
const M_LAYOUT = 1 << 26;
/**
 * A write that raised no state bit (zIndex, a child leaving or destroyed)
 * moved or reordered the node: the placement covers it.
 */
const M_ORDER = 1 << 25;
/** Every change: what a new element is synced with. */
const M_ALL = ~M_LISTED;
const M_PLACE =
  DIRTY_LOCAL | DIRTY_SHADER | DIRTY_INHERITED | M_LAYOUT | M_ORDER;
const M_TEXT = DIRTY_LAYOUT | M_LAYOUT;

/** 1.10 cut a data string past this many characters (santizeCustomDataMap). */
const MAX_DATA_LENGTH = 2048;

const KIND_NAMES = ['image', 'color', 'noise', 'subTexture'];

/** The `data-texture-*` attributes, removed together from a node without a texture. */
const TEXTURE_ATTRIBUTES = [
  'state',
  'type',
  'width',
  'height',
  'owners',
  'retry-count',
  'max-retry-count',
  'previous-state',
  'loaded-count',
  'failed-count',
  'freed-count',
  'error',
];

/** A custom element name (ASCII): a lowercase letter first, and a hyphen. */
const ELEMENT_NAME = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

/** What setAttribute takes after `data-` (others throw: a space, a quote). */
const DATA_KEY = /^[A-Za-z0-9_.:-]+$/;

/** Per texture record: what its attributes last showed, and its events. */
interface TextureMetrics {
  gen: number;
  state: string;
  previous: string;
  loaded: number;
  failed: number;
  freed: number;
  /**
   * Held for room (onHeld) and shown so: its owners are listed when it is
   * first held, and a sync that finds it no longer decoded clears it.
   */
  held: boolean;
}

/** Per node uid: frames with a change in the current window (shared, as in 1.10). */
const changeCounts = new Map<number, { count: number; since: number }>();
/** Animations running or paused, by controller (shared, as in 1.10). */
const activeAnimations = new Map<Animation, InspectorAnimation>();
/** Ended animations, newest first. */
const animationHistory: AnimationRecord[] = [];
let animationIds = 0;

/** The inspector attached to each renderer (node.div and the meta setters look it up). */
const attached = new WeakMap<object, Inspector>();

/** The setters the meta wrappers replace (a write to them marks nothing dirty). */
const META_NAMES = ['data', 'componentName', 'componentLocation'];

/** Inspectors attached now: the meta wrappers are installed while one is. */
let attachedCount = 0;

/** Node's own meta descriptors, while the wrappers replace them. */
let metaDescriptors: PropertyDescriptor[] | null = null;

/**
 * With the first inspector attached: the writes of `data`, `componentName`
 * and `componentLocation`, which raise no dirty bit, reach their node's
 * inspector, through prototype accessors (a handle gains no field), and
 * `node.div` reads the node's element. A renderer without an inspector
 * pays a map lookup on those three setters only while some inspector is
 * attached; the last one to go puts Node's own setters back (spec 12.4:
 * setters store and mark, nothing else). The `div` getter stays: it reads
 * undefined without an inspector, and costs nothing unless read.
 */
function patchNodePrototype(): void {
  attachedCount++;
  if (metaDescriptors !== null) {
    return;
  }
  const proto = Node.prototype as unknown as Record<string, unknown>;
  const saved: PropertyDescriptor[] = [];
  for (let i = 0; i < META_NAMES.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(proto, META_NAMES[i]!)!;
    saved.push(desc);
    const set = desc.set!;
    Object.defineProperty(proto, META_NAMES[i]!, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(this: Node, value: unknown) {
        set.call(this, value);
        const inspector = attached.get(this.renderer);
        if (inspector !== undefined && this.id !== NULL) {
          inspector.meta(this.id);
        }
      },
    });
  }
  metaDescriptors = saved;
  Object.defineProperty(proto, 'div', {
    configurable: true,
    get(this: Node) {
      const inspector = attached.get(this.renderer);
      return inspector === undefined ? undefined : inspector.elementOf(this);
    },
  });
}

/** An inspector detached: the last one puts Node's meta setters back. */
function unpatchNodePrototype(): void {
  attachedCount--;
  const saved = metaDescriptors;
  if (attachedCount > 0 || saved === null) {
    return;
  }
  const proto = Node.prototype as unknown as Record<string, unknown>;
  for (let i = 0; i < META_NAMES.length; i++) {
    Object.defineProperty(proto, META_NAMES[i]!, saved[i]!);
  }
  metaDescriptors = null;
}

/**
 * `MyButton` names the custom element `my-button-x` (1.10): DevTools shows
 * the component's name in the Elements panel.
 */
function customElementTag(componentName: string): string {
  const kebab = componentName
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
  return `${kebab}-x`;
}

/** 0xRRGGBBAA as a CSS rgba(). */
function rgba(color: number): string {
  const a = (color & 0xff) / 255;
  const b = (color >>> 8) & 0xff;
  const g = (color >>> 16) & 0xff;
  const r = (color >>> 24) & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * The inspector (spec 12.4, exported from `@solidtv/renderer/inspector`):
 * a DOM mirror of the scene for DevTools and Playwright, one element per
 * node over the canvas. It wraps no setter that marks dirty: attached, it
 * chains the renderer's store and scene pass hooks, collects the nodes written since
 * the last frame with their dirty masks (as the writes land, before the
 * walk clears them) and the nodes created and destroyed, and applies them
 * to the mirror once per frame. Built only when the renderer's `inspector`
 * setting names it in a build with `__enableInspector__` on; nothing of it
 * runs, or ships, otherwise.
 *
 * The DOM contract (1.10's): an element per node, its `id` the node's
 * `uid` (and the renderer root's the overlay, `id="root"`); `node.div` and
 * `element.node`; position, size, opacity, colour, transform, z-index and
 * clipping as CSS; `data` as `data-*` attributes; `src` as `data-src`;
 * `data-texture-*` attributes; text as content (opacity 0.001, so
 * Playwright still finds it); `state` (`inViewport`, `outOfViewport`); a
 * custom element named after `componentName` where the browser has them.
 */
export class Inspector {
  private readonly canvas: HTMLCanvasElement;
  private readonly doc: Document;
  private readonly win: Window | null;
  private readonly root: HTMLElement;
  private readonly options: InspectorOptions;
  private readonly onResize = (): void => {
    this.setRootPosition();
  };
  private readonly observers: { disconnect(): void }[] = [];
  private owner: InspectorOwner | null = null;
  /** Elements by node uid. */
  private readonly elements = new Map<number, HTMLElement>();
  /** Feed bits by node slot (M_LISTED when the slot is in `changed`). */
  private marks = new Uint32Array(64);
  private changed = new Int32Array(64);
  private changedCount = 0;
  /** By node slot: its last index in `changed` (a parent change lists it again). */
  private entries = new Int32Array(64);
  private destroyedUids: number[] = [];
  private readonly metrics = new Map<number, TextureMetrics>();
  /** Owner counts by texture record, for one frame's sync (a shared texture is walked once). */
  private readonly ownerCounts = new Map<number, number>();
  /** In frame()'s sync: owner counts are cached (node.div between frames counts afresh). */
  private framing = false;
  /** Unregistered since the last frame, with whether each ran to its end. */
  private readonly ended: Animation[] = [];
  private readonly endedFinished: boolean[] = [];
  private statsTimer = 0;
  /** What attach() replaced, for destroy() to put back. */
  private restore: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, settings: InspectorSettings) {
    const options = settings.inspectorOptions;
    this.options = {
      enablePerformanceMonitoring: options.enablePerformanceMonitoring ?? false,
      excessiveCallThreshold: options.excessiveCallThreshold ?? 100,
      resetInterval: options.resetInterval ?? 5000,
      enableAnimationMonitoring: options.enableAnimationMonitoring ?? false,
      maxAnimationHistory: options.maxAnimationHistory ?? 1000,
      animationStatsInterval: options.animationStatsInterval ?? 0,
    };
    this.canvas = canvas;
    const doc = canvas.ownerDocument;
    this.doc = doc;
    const win = doc.defaultView;
    this.win = win;
    // The overlay mirrors the app in logical pixels, scaled to the canvas;
    // app size and pixel ratio are fixed at construction.
    const root = doc.createElement('div');
    this.root = root;
    const scale = settings.deviceLogicalPixelRatio;
    const style = root.style;
    root.id = 'root';
    style.setProperty('width', `${Math.ceil(settings.appWidth)}px`);
    style.setProperty('height', `${Math.ceil(settings.appHeight)}px`);
    style.setProperty('position', 'absolute');
    style.setProperty('transform-origin', '0 0 0');
    style.setProperty('transform', `scale(${scale}, ${scale})`);
    style.setProperty('overflow', 'hidden');
    style.setProperty('z-index', '65534');
    this.setRootPosition();
    doc.body.appendChild(root);
    if (win !== null) {
      win.addEventListener('resize', this.onResize);
      // Feature-detected: MutationObserver is Chrome 26, ResizeObserver 64.
      const view = win as unknown as Record<string, unknown>;
      const Mutation = view.MutationObserver as
        | (new (callback: () => void) => MutationObserver)
        | undefined;
      if (typeof Mutation === 'function') {
        const observer = new Mutation(this.onResize);
        observer.observe(canvas, { attributes: true });
        this.observers.push(observer);
      }
      const Resize = view.ResizeObserver as
        | (new (callback: () => void) => {
            observe(target: Element): void;
            disconnect(): void;
          })
        | undefined;
      if (typeof Resize === 'function') {
        const observer = new Resize(this.onResize);
        observer.observe(canvas);
        this.observers.push(observer);
      }
    }
    const interval = this.options.animationStatsInterval;
    if (interval > 0 && win !== null) {
      this.statsTimer = win.setInterval(() => {
        const stats = Inspector.getAnimationStats();
        console.log(
          `Inspector animations: ${stats.activeCount} active, ${
            stats.totalAnimations
          } completed, ${Math.round(stats.averageDuration)} ms average`,
        );
      }, interval * 1000);
    }
    console.warn('Inspector is enabled, this will impact performance');
  }

  /**
   * Per node, the frames it changed in within the current window, most
   * first (with `enablePerformanceMonitoring`).
   */
  static getPerformanceStats(): InspectorChangeStats[] {
    const now = Date.now();
    const stats: InspectorChangeStats[] = [];
    changeCounts.forEach((c, nodeId) => {
      stats.push({ nodeId, count: c.count, timeWindow: now - c.since });
    });
    return stats.sort((a, b) => b.count - a.count);
  }

  static clearPerformanceStats(): void {
    changeCounts.clear();
  }

  /** Animations running or paused, newest first (with `enableAnimationMonitoring`). */
  static getActiveAnimations(): InspectorAnimation[] {
    const now = Date.now();
    const list: InspectorAnimation[] = [];
    // Copies, as 1.10 returned: a caller cannot change the records.
    activeAnimations.forEach((a) => {
      list.push({
        nodeId: a.nodeId,
        animationId: a.animationId,
        startTime: a.startTime,
        duration: a.duration,
        elapsedTime: now - a.startTime,
        state: a.state,
      });
    });
    return list.sort((a, b) => b.startTime - a.startTime);
  }

  /** The animations recorded: ended, active, and the mean duration of those that finished. */
  static getAnimationStats(): {
    totalAnimations: number;
    activeCount: number;
    averageDuration: number;
  } {
    let finished = 0;
    let sum = 0;
    for (let i = 0; i < animationHistory.length; i++) {
      const record = animationHistory[i]!;
      if (record.completionType === 'finished') {
        finished++;
        sum += record.actualDuration;
      }
    }
    return {
      totalAnimations: animationHistory.length,
      activeCount: activeAnimations.size,
      averageDuration: finished > 0 ? sum / finished : 0,
    };
  }

  static clearAnimationStats(): void {
    activeAnimations.clear();
    animationHistory.length = 0;
  }

  /** Keep the overlay on the canvas as the page scrolls or the canvas moves. */
  setRootPosition(): void {
    const rect = this.canvas.getBoundingClientRect();
    // The window's offsets: documentElement.scrollTop reads 0 on a
    // scrolled page below Chrome 61, where the body scrolls.
    const win = this.win;
    const x = win === null ? 0 : win.pageXOffset;
    const y = win === null ? 0 : win.pageYOffset;
    const style = this.root.style;
    style.setProperty('left', `${x + rect.left}px`);
    style.setProperty('top', `${y + rect.top}px`);
  }

  /**
   * Mirror `owner`'s scene and follow it: its store's writes, creations
   * and destructions, its visibility and text layout hooks and its texture
   * events, each chained (never replaced) until destroy().
   */
  attach(owner: InspectorOwner): void {
    this.owner = owner;
    attached.set(owner, this);
    patchNodePrototype();
    const nodes = owner.nodes;
    const hooks = owner.hooks;
    const textures = owner.textures;
    const markDirty = nodes.markDirty;
    const alloc = nodes.alloc;
    const free = nodes.free;
    nodes.markDirty = (id: number, bits: number): void => {
      markDirty.call(nodes, id, bits);
      if (id !== NULL) {
        this.log(id, bits === 0 ? M_ORDER : bits);
      }
    };
    nodes.alloc = (): number => {
      const id = alloc.call(nodes);
      // Listed, so that the frame builds its element (unless node.div has).
      this.log(id, 0);
      return id;
    };
    nodes.free = (id: number): void => {
      this.destroyedUids.push(nodes.i32[id * I_STRIDE + I_UID]!);
      free.call(nodes, id);
    };
    const onVisibility = hooks.onVisibility;
    const layoutText = hooks.layoutText;
    hooks.onVisibility = (id, prev, next) => {
      onVisibility(id, prev, next);
      // Into bounds, its texture resolves, maybe to a record loaded already
      // (a cache hit marks nothing): its attributes follow, for a node with
      // a src, a texture or the record of one (a src cleared while it was
      // out resolves now). Without, it has none to write.
      const entering =
        next !== VIS_OUT &&
        (prev === VIS_OUT || prev === VIS_INIT) &&
        (nodes.srcs[id] !== null ||
          nodes.textureRefs[id] !== null ||
          nodes.i32[id * I_STRIDE + I_SOURCE_TEXTURE] !== NULL);
      this.log(id, entering === true ? M_STATE | DIRTY_TEXTURE : M_STATE);
    };
    hooks.layoutText = (id) => {
      const raised = layoutText(id);
      this.log(id, M_LAYOUT);
      return raised;
    };
    const onUploaded = textures.onUploaded;
    const onFailed = textures.onFailed;
    const onFreed = textures.onFreed;
    textures.onUploaded = (rec) => {
      onUploaded(rec);
      this.metricsOf(rec).loaded++;
    };
    textures.onFailed = (rec, final) => {
      onFailed(rec, final);
      this.metricsOf(rec).failed++;
    };
    textures.onFreed = (rec) => {
      onFreed(rec);
      this.metricsOf(rec).freed++;
    };
    // An upload held for room (doNotExceedCriticalThreshold) changes none
    // of its owners: list them (a SubTexture's too) the first time, so that
    // they show the wait. It is called for every held upload pass.
    const onHeld = textures.onHeld;
    textures.onHeld = (rec) => {
      onHeld(rec);
      const m = this.metricsOf(rec);
      if (m.held === true) {
        return;
      }
      m.held = true;
      this.logOwners(rec);
      const subs = textures.subs[rec]!;
      if (subs !== null) {
        for (let i = 0; i < subs.length; i++) {
          this.logOwners(subs[i]!);
        }
      }
    };
    const manager = owner.animationManager;
    const register = manager.register;
    const unregister = manager.unregister;
    if (this.options.enableAnimationMonitoring === true) {
      manager.register = (a: Animation): void => {
        const before = a.index;
        register.call(manager, a);
        if (before === -1 && a.index !== -1) {
          this.animationStarted(a);
        }
      };
      manager.unregister = (a: Animation): void => {
        const before = a.index;
        // Read before stop() resets it: an animation stopped at its end.
        const finished = a.progress >= 1;
        unregister.call(manager, a);
        // stop() unregisters a paused animation too, which is out already.
        if (before !== -1 || activeAnimations.has(a) === true) {
          this.ended.push(a);
          this.endedFinished.push(finished);
          // Recorded at the next drawn frame, which a stop() or a pause()
          // on an idle renderer would not bring (1.10 recorded it at once).
          owner.requestRender();
        }
      };
    }
    this.restore = () => {
      if (this.options.enableAnimationMonitoring === true) {
        manager.register = register;
        manager.unregister = unregister;
      }
      nodes.markDirty = markDirty;
      nodes.alloc = alloc;
      nodes.free = free;
      hooks.onVisibility = onVisibility;
      hooks.layoutText = layoutText;
      textures.onUploaded = onUploaded;
      textures.onFailed = onFailed;
      textures.onFreed = onFreed;
      textures.onHeld = onHeld;
    };
    // The scene there is now, parents before children.
    this.elements.set(owner.root.uid, this.root);
    (this.root as unknown as { node: Node }).node = owner.root;
    this.mirror(owner.root.id);
  }

  /**
   * Apply the frame's changes to the mirror: the Renderer calls it after
   * each drawn frame. Removed elements first, then new ones (each with its
   * whole state), then what changed on the others.
   */
  frame(): void {
    const owner = this.owner;
    if (owner === null) {
      return;
    }
    const destroyed = this.destroyedUids;
    // A paused animation is out of the manager, so a destroy that stops the
    // node's animations never unregisters it again: its record goes here.
    const pruning = destroyed.length > 0 && activeAnimations.size > 0;
    for (let i = 0; i < destroyed.length; i++) {
      const el = this.elements.get(destroyed[i]!);
      if (el !== undefined) {
        el.remove();
        this.elements.delete(destroyed[i]!);
      }
    }
    destroyed.length = 0;
    const nodes = owner.nodes;
    const marks = this.marks;
    this.ownerCounts.clear();
    this.framing = true;
    const counting = this.options.enablePerformanceMonitoring;
    const now =
      counting === true || this.ended.length > 0 || pruning === true
        ? Date.now()
        : 0;
    // The count is read each pass and cleared after the loop: a throw from
    // the DOM leaves the slots after it listed for the next frame instead
    // of marked as listed with no entry (never synced again).
    for (let i = 0; i < this.changedCount; i++) {
      const id = this.changed[i]!;
      // Listed again later, by a parent change: synced there.
      if (this.entries[id] !== i) {
        continue;
      }
      const mask = marks[id]!;
      marks[id] = 0;
      if (nodes.i32[id * I_STRIDE + I_UID] === 0) {
        continue;
      }
      if (counting === true) {
        this.countChange(nodes.i32[id * I_STRIDE + I_UID]!, now);
      }
      // A node created this frame may have its element already: a child
      // created earlier in the frame built its parent's (place()), and
      // node.div builds it on demand.
      const el = this.elements.get(nodes.i32[id * I_STRIDE + I_UID]!);
      if (el === undefined) {
        this.create(id);
      } else if (el !== this.root) {
        // Never the overlay: the root is mirrored by the overlay itself,
        // whose place is the canvas, not the root's x, y and transform
        // (destroying or moving a root child marks the root; 1.10 never
        // mirrored root writes).
        this.sync(el, id, mask);
      } else if ((mask & DIRTY_DIRECTION) !== 0) {
        // The one root write the mirror follows: renderer.root.rtl moves
        // every element under the overlay.
        this.directionChanged(el, id);
      }
    }
    this.changedCount = 0;
    this.framing = false;
    if (this.ended.length > 0) {
      this.animationsEnded(now);
    }
    if (pruning === true) {
      this.pruneAnimations(now);
    }
  }

  /**
   * The element mirroring `node` (`node.div`), built now when it has none
   * yet: Solid reads `node.div` right after createNode (1.10 built the
   * element there). The node stays listed, so the frame's sync takes the
   * writes that follow.
   */
  elementOf(node: Node): HTMLElement | undefined {
    const el = this.elements.get(node.uid);
    if (el !== undefined || node.id === NULL || this.owner === null) {
      return el;
    }
    return this.create(node.id);
  }

  /**
   * A meta write (data, componentName, componentLocation) on slot `id`: it
   * raises no dirty bit, so it asks for the frame that flushes it.
   */
  meta(id: number): void {
    this.log(id, M_META);
    const owner = this.owner;
    if (owner !== null) {
      owner.requestRender();
    }
  }

  /** Stop following the renderer and remove the overlay. */
  destroy(): void {
    const owner = this.owner;
    if (owner !== null) {
      attached.delete(owner);
      this.owner = null;
      unpatchNodePrototype();
    }
    const restore = this.restore;
    if (restore !== null) {
      restore();
      this.restore = null;
    }
    const observers = this.observers;
    for (let i = 0; i < observers.length; i++) {
      observers[i]!.disconnect();
    }
    observers.length = 0;
    if (this.win !== null) {
      this.win.removeEventListener('resize', this.onResize);
      if (this.statsTimer !== 0) {
        this.win.clearInterval(this.statsTimer);
        this.statsTimer = 0;
      }
    }
    Inspector.clearAnimationStats();
    this.root.remove();
    this.elements.clear();
    this.metrics.clear();
  }

  /**
   * A frame `uid` changed in: counted in the window, with a warning when
   * the count reaches the threshold and every 50 frames after (1.10).
   */
  private countChange(uid: number, now: number): void {
    const options = this.options;
    const c = changeCounts.get(uid);
    if (c === undefined) {
      changeCounts.set(uid, { count: 1, since: now });
      return;
    }
    if (now - c.since > options.resetInterval) {
      c.count = 1;
      c.since = now;
      return;
    }
    c.count++;
    const threshold = options.excessiveCallThreshold;
    if (c.count === threshold || (c.count > threshold && c.count % 50 === 0)) {
      console.warn(
        `Inspector: node ${uid} changed in ${c.count} frames within ${options.resetInterval} ms`,
      );
    }
  }

  private animationStarted(a: Animation): void {
    const record = activeAnimations.get(a);
    if (record !== undefined) {
      // A paused animation started again.
      record.state = 'running';
      return;
    }
    activeAnimations.set(a, {
      nodeId: (a.node as Node).uid,
      animationId: `anim_${++animationIds}`,
      startTime: Date.now(),
      duration: a.duration,
      elapsedTime: 0,
      state: 'running',
    });
  }

  /** The animations unregistered since the last frame: paused, or ended. */
  private animationsEnded(now: number): void {
    const ended = this.ended;
    const finished = this.endedFinished;
    const max = this.options.maxAnimationHistory;
    for (let i = 0; i < ended.length; i++) {
      const a = ended[i]!;
      const record = activeAnimations.get(a);
      if (record === undefined) {
        continue;
      }
      // Started again within the frame (stop() or pause(), then start()):
      // still running.
      if (a.index !== -1) {
        record.state = 'running';
        continue;
      }
      if (a.state === 'paused') {
        record.state = 'paused';
        continue;
      }
      activeAnimations.delete(a);
      this.recordEnd(record, now, finished[i] === true);
    }
    ended.length = 0;
    finished.length = 0;
    if (animationHistory.length > max) {
      animationHistory.length = max;
    }
  }

  /**
   * The records of animations whose node was destroyed, recorded as
   * stopped (1.10 recorded them as cancelled; neither counts in
   * averageDuration).
   */
  private pruneAnimations(now: number): void {
    activeAnimations.forEach((record, a) => {
      if ((a.node as Node).id === NULL) {
        activeAnimations.delete(a);
        this.recordEnd(record, now, false);
      }
    });
    const max = this.options.maxAnimationHistory;
    if (animationHistory.length > max) {
      animationHistory.length = max;
    }
  }

  private recordEnd(
    record: InspectorAnimation,
    now: number,
    finished: boolean,
  ): void {
    animationHistory.unshift({
      nodeId: record.nodeId,
      animationId: record.animationId,
      startTime: record.startTime,
      endTime: now,
      duration: record.duration,
      actualDuration: now - record.startTime,
      completionType: finished === true ? 'finished' : 'stopped',
    });
  }

  /** Add `bits` to slot `id`'s feed, listing it on its first change of the frame. */
  private log(id: number, bits: number): void {
    let marks = this.marks;
    if (id >= marks.length) {
      let n = marks.length * 2;
      while (n <= id) {
        n *= 2;
      }
      const grown = new Uint32Array(n);
      grown.set(marks);
      this.marks = marks = grown;
      const entries = new Int32Array(n);
      entries.set(this.entries);
      this.entries = entries;
    }
    const mark = marks[id]!;
    if ((mark & M_LISTED) === 0) {
      marks[id] = mark | bits | M_LISTED;
    } else {
      marks[id] = mark | bits;
      // A parent change lists the node again, so that the frame places it
      // after the siblings given that parent before it (1.10 appended its
      // element at the write): the DOM keeps parent-assignment order.
      if ((bits & DIRTY_INHERITED) === 0) {
        return;
      }
    }
    const n = this.changedCount;
    if (n === this.changed.length) {
      const grown = new Int32Array(n * 2);
      grown.set(this.changed);
      this.changed = grown;
    }
    this.changed[n] = id;
    this.entries[id] = n;
    this.changedCount = n + 1;
  }

  /**
   * The node's resolved direction changed (DIRTY_DIRECTION on it, derived
   * by the walk before this frame): mark its element and re-place its
   * whole subtree. Its children's `left` reads this node's bit, and its
   * inheriting descendants changed with it, none of them dirty themselves,
   * and which of them an own value stopped is not worth telling apart: a
   * dev tool, at a language switch.
   */
  private directionChanged(el: HTMLElement, id: number): void {
    const nodes = this.owner!.nodes;
    if ((nodes.u32[id * I_STRIDE + I_STATE]! & ST_RTL) !== 0) {
      el.setAttribute('data-rtl', 'true');
    } else {
      el.removeAttribute('data-rtl');
    }
    let c = nodes.i32[id * I_STRIDE + I_FIRST_CHILD]!;
    while (c !== NULL) {
      const childEl = this.elements.get(nodes.i32[c * I_STRIDE + I_UID]!);
      if (childEl !== undefined) {
        this.place(childEl, c, nodes.handles[c] as Node, false);
        this.directionChanged(childEl, c);
      }
      c = nodes.next[c]!;
    }
  }

  /** Build the elements of `id`'s subtree (attach), parents first. */
  private mirror(id: number): void {
    const nodes = this.owner!.nodes;
    let c = nodes.i32[id * I_STRIDE + I_FIRST_CHILD]!;
    while (c !== NULL) {
      this.create(c);
      this.mirror(c);
      c = nodes.next[c]!;
    }
  }

  /** A new element for slot `id`, placed under its parent's and synced whole. */
  private create(id: number): HTMLElement {
    const nodes = this.owner!.nodes;
    const node = nodes.handles[id] as Node;
    const extras = nodes.extras[id] as NodeExtras | null;
    const name = extras === null ? undefined : extras.componentName;
    let el: HTMLElement;
    const tag = name === undefined || name === '' ? '' : customElementTag(name);
    // A name the browser would refuse (customElements.define throws on
    // `_-item-x`) keeps the plain div.
    if (ELEMENT_NAME.test(tag) === true && this.defineElement(tag) === true) {
      el = this.doc.createElement(tag);
    } else {
      el = this.doc.createElement('div');
    }
    el.style.setProperty('position', 'absolute');
    el.id = String(node.uid);
    (el as unknown as { node: Node }).node = node;
    this.elements.set(node.uid, el);
    this.sync(el, id, M_ALL);
    return el;
  }

  /** Register the custom element `tag`; false where the browser has none (Chrome 54). */
  private defineElement(tag: string): boolean {
    const win = this.win as unknown as {
      customElements?: {
        get(name: string): unknown;
        define(name: string, element: unknown): void;
      };
      HTMLElement?: new () => HTMLElement;
    } | null;
    if (win === null || win.customElements === undefined) {
      return false;
    }
    const registry = win.customElements;
    if (registry.get(tag) === undefined) {
      const Base = win.HTMLElement;
      registry.define(
        tag,
        Base === undefined ? class {} : class extends Base {},
      );
    }
    return true;
  }

  /** Write what `mask` says changed on slot `id` to its element. */
  private sync(el: HTMLElement, id: number, mask: number): void {
    const nodes = this.owner!.nodes;
    const node = nodes.handles[id] as Node;
    const style = el.style;
    const text = (nodes.u32[id * I_STRIDE + I_STATE]! & ST_TEXT) !== 0;
    if ((mask & M_PLACE) !== 0) {
      this.place(el, id, node, (mask & DIRTY_INHERITED) !== 0);
    }
    if ((mask & DIRTY_DIRECTION) !== 0) {
      this.directionChanged(el, id);
    }
    if ((mask & DIRTY_ALPHA) !== 0 && text === false) {
      const alpha = nodes.f64[id * F_STRIDE + F_ALPHA]!;
      if (alpha === 1) {
        style.removeProperty('opacity');
      } else {
        style.setProperty('opacity', String(alpha));
      }
    }
    if ((mask & DIRTY_COLOR) !== 0) {
      const color = nodes.u32[id * I_STRIDE + I_COLOR_TL]!;
      if (color === 0) {
        style.removeProperty('color');
      } else {
        style.setProperty('color', rgba(color));
      }
    }
    if ((mask & DIRTY_CLIP) !== 0) {
      if (node.clipping === false) {
        style.removeProperty('overflow');
      } else {
        style.setProperty('overflow', 'hidden');
      }
    }
    if ((mask & DIRTY_TEXTURE) !== 0) {
      this.textureAttributes(el, id);
    }
    if (text === true && (mask & M_TEXT) !== 0) {
      this.textContent(el, node as TextNode);
    }
    if ((mask & M_META) !== 0) {
      this.dataAttributes(el, nodes.data[id] as Record<string, unknown> | null);
    }
    if ((mask & M_STATE) !== 0) {
      const vis = visibilityOf(nodes.u32[id * I_STRIDE + I_STATE]!);
      if (vis === VIS_IN_VIEWPORT) {
        el.setAttribute('state', 'inViewport');
      } else if (el.getAttribute('state') === 'inViewport') {
        el.setAttribute('state', 'outOfViewport');
      }
    }
  }

  /**
   * Position, size, transform and z-index; and under its parent's element,
   * appended there again when `reparented` (its parent assigned this
   * frame), so that it follows the siblings assigned before it.
   */
  private place(
    el: HTMLElement,
    id: number,
    node: Node,
    reparented: boolean,
  ): void {
    const nodes = this.owner!.nodes;
    const style = el.style;
    const w = node.w;
    const h = node.h;
    const parent = nodes.i32[id * I_STRIDE + I_PARENT]!;
    const x = nodes.f64[id * F_STRIDE + F_X]!;
    const mountX = nodes.f64[id * F_STRIDE + F_MOUNT_X]!;
    let left = x - w * mountX;
    if (
      parent !== NULL &&
      (nodes.u32[parent * I_STRIDE + I_STATE]! & ST_RTL) !== 0
    ) {
      // The mirror image within the parent, as composeWorld places it.
      left = nodes.f64[parent * F_STRIDE + F_W]! - x - (1 - mountX) * w;
    }
    style.setProperty('left', `${left}px`);
    style.setProperty(
      'top',
      `${
        nodes.f64[id * F_STRIDE + F_Y]! -
        h * nodes.f64[id * F_STRIDE + F_MOUNT_Y]!
      }px`,
    );
    style.setProperty('width', w === 0 ? 'auto' : `${w}px`);
    style.setProperty('height', h === 0 ? 'auto' : `${h}px`);
    const rotation = nodes.f64[id * F_STRIDE + F_ROTATION]!;
    const sx = nodes.f64[id * F_STRIDE + F_SCALE_X]!;
    const sy = nodes.f64[id * F_STRIDE + F_SCALE_Y]!;
    if (rotation === 0 && sx === 1 && sy === 1) {
      style.removeProperty('transform');
    } else {
      style.setProperty(
        'transform',
        `rotate(${rotation}rad) scale(${sx}, ${sy})`,
      );
    }
    // Written at 0 too, as 1.10 wrote it on every element: each element
    // stacks its children within it, as the scene draws them.
    style.setProperty('z-index', String(nodes.f64[id * F_STRIDE + F_Z_INDEX]!));
    // Detached (parent = null): out of the mirror until it has a parent.
    if (parent === NULL) {
      el.remove();
      return;
    }
    // A parent created later in the frame than its child gets its element
    // now, ancestors first (the root's, the overlay, always exists).
    let parentEl = this.elements.get(nodes.i32[parent * I_STRIDE + I_UID]!);
    if (parentEl === undefined) {
      parentEl = this.create(parent);
    }
    // Under its parent's already, it may stand before a sibling assigned
    // after it: an element built earlier in the frame (by a child's place(),
    // by node.div) or a node moved away and back.
    if (el.parentNode !== parentEl || reparented === true) {
      parentEl.appendChild(el);
    }
  }

  /** The text, invisible but findable, its font as CSS, and its layout's size. */
  private textContent(el: HTMLElement, node: TextNode): void {
    const style = el.style;
    el.textContent = node.text;
    // 0.001, not 0: Playwright's visibility checks still find it.
    style.setProperty('opacity', '0.001');
    style.setProperty('pointer-events', 'none');
    // Prefixed too: user-select is unprefixed from Chrome 54 only.
    style.setProperty('-webkit-user-select', 'none');
    style.setProperty('user-select', 'none');
    style.setProperty('font-size', `${node.fontSize}px`);
    style.setProperty('font-family', node.fontFamily);
    style.setProperty('font-style', node.fontStyle);
    style.setProperty('text-align', node.textAlign);
    style.setProperty('letter-spacing', `${node.letterSpacing}px`);
    const lineHeight = node.lineHeight;
    if (lineHeight === 0) {
      style.removeProperty('line-height');
    } else {
      style.setProperty('line-height', `${lineHeight}px`);
    }
  }

  /**
   * `data` as `data-*` attributes: a string past 2048 characters is cut, a
   * value that is not a string, number or boolean is left out, and an
   * undefined one removes its attribute (1.10). `data` itself is untouched.
   */
  private dataAttributes(
    el: HTMLElement,
    data: Record<string, unknown> | null,
  ): void {
    if (data === null) {
      return;
    }
    for (const key in data) {
      // A key setAttribute would refuse (a space, a quote) is left out.
      if (DATA_KEY.test(key) === false) {
        continue;
      }
      const value = data[key];
      const type = typeof value;
      if (value === undefined) {
        el.removeAttribute(`data-${key}`);
      } else if (type === 'string') {
        const s = value as string;
        el.setAttribute(
          `data-${key}`,
          s.length > MAX_DATA_LENGTH ? s.substring(0, MAX_DATA_LENGTH) : s,
        );
      } else if (type === 'number' || type === 'boolean') {
        el.setAttribute(`data-${key}`, String(value));
      }
    }
  }

  /** List the owners of `rec` for their texture attributes. */
  private logOwners(rec: number): void {
    const owner = this.owner!;
    const nodes = owner.nodes;
    let o = owner.textures.ownerHead[rec]!;
    while (o !== NULL) {
      this.log(o, DIRTY_TEXTURE);
      o = nodes.i32[o * I_STRIDE + I_OWNER_NEXT]!;
    }
  }

  private metricsOf(rec: number): TextureMetrics {
    const textures = this.owner!.textures;
    const gen = textures.gen[rec]!;
    let m = this.metrics.get(rec);
    if (m === undefined || m.gen !== gen) {
      m = {
        gen,
        state: '',
        previous: '',
        loaded: 0,
        failed: 0,
        freed: 0,
        held: false,
      };
      this.metrics.set(rec, m);
    }
    return m;
  }

  /**
   * `data-src` and the `data-texture-*` attributes of the texture a node
   * takes: its source's type, size and owners (a SubTexture's own, its
   * region's size), and the state, retries, error and load counts of the
   * pixels (a SubTexture's sheet), as 1.10's SubTexture reported them.
   */
  private textureAttributes(el: HTMLElement, id: number): void {
    const owner = this.owner!;
    const nodes = owner.nodes;
    const src = nodes.srcs[id];
    if (src === null || src === undefined) {
      el.removeAttribute('data-src');
    } else {
      el.setAttribute('data-src', src);
    }
    const rec = nodes.i32[id * I_STRIDE + I_SOURCE_TEXTURE]!;
    if (rec === NULL) {
      for (let i = 0; i < TEXTURE_ATTRIBUTES.length; i++) {
        el.removeAttribute(`data-texture-${TEXTURE_ATTRIBUTES[i]!}`);
      }
      return;
    }
    const textures = owner.textures;
    const pixels = textures.pixelsOf(rec);
    const state = TEXTURE_STATE_NAMES[textures.state[pixels]!]!;
    const m = this.metricsOf(pixels);
    // Uploaded, dropped or failed: the wait for room is over.
    if (textures.state[pixels] !== TX_DECODED) {
      m.held = false;
    }
    if (m.state !== state) {
      if (m.state !== '') {
        m.previous = m.state;
      }
      m.state = state;
    }
    el.setAttribute('data-texture-state', state);
    const kind = textures.kind[rec]!;
    el.setAttribute(
      'data-texture-type',
      KIND_NAMES[
        kind === KIND_COLOR || kind === KIND_NOISE || kind === KIND_SUB
          ? kind
          : 0
      ]!,
    );
    if (textures.state[pixels] === TX_UPLOADED) {
      let w = textures.w[rec]!;
      let h = textures.h[rec]!;
      if (kind === KIND_SUB) {
        const region = textures.props[rec] as SubRegion;
        w = region.w;
        h = region.h;
      }
      el.setAttribute('data-texture-width', String(w));
      el.setAttribute('data-texture-height', String(h));
    } else {
      el.removeAttribute('data-texture-width');
      el.removeAttribute('data-texture-height');
    }
    // 1.10's renderableOwners: the nodes taking it in bounds. Counted once
    // per record and frame: every owner of a shared texture (a placeholder)
    // is synced when it uploads.
    let owners = this.framing === true ? this.ownerCounts.get(rec) : undefined;
    if (owners === undefined) {
      owners = 0;
      let o = textures.ownerHead[rec]!;
      while (o !== NULL) {
        if ((nodes.u32[o * I_STRIDE + I_STATE]! & ST_WANT) !== 0) {
          owners++;
        }
        o = nodes.i32[o * I_STRIDE + I_OWNER_NEXT]!;
      }
      this.ownerCounts.set(rec, owners);
    }
    el.setAttribute('data-texture-owners', String(owners));
    el.setAttribute(
      'data-texture-retry-count',
      String(textures.retryCount[pixels]),
    );
    el.setAttribute(
      'data-texture-max-retry-count',
      String(textures.maxRetryCount[pixels]),
    );
    if (m.previous === '') {
      el.removeAttribute('data-texture-previous-state');
    } else {
      el.setAttribute('data-texture-previous-state', m.previous);
    }
    el.setAttribute('data-texture-loaded-count', String(m.loaded));
    el.setAttribute('data-texture-failed-count', String(m.failed));
    el.setAttribute('data-texture-freed-count', String(m.freed));
    const error = textures.errors[pixels];
    if (m.held === true) {
      // Waiting for room: 1.10 failed it with this code.
      el.setAttribute(
        'data-texture-error',
        TextureErrorCode.MEMORY_THRESHOLD_EXCEEDED,
      );
    } else if (error === null || error === undefined) {
      el.removeAttribute('data-texture-error');
    } else {
      const code = (error as Error & { code?: string }).code;
      el.setAttribute('data-texture-error', code ?? error.message);
    }
  }
}
