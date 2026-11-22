/**
 * Touch scrolling for `Row` and `Column`.
 *
 * The physics live in one engine (`src/sdk/scroll.ts`). This module binds an
 * engine to a scene node, refreshes its bounds after layout, and routes a
 * pointer drag through nested scrollers: the innermost scroller on the
 * gesture's dominant axis claims it after a small slop, and the axis stays
 * locked for the rest of that drag. A horizontal rail inside a vertical page
 * therefore needs no per-screen code.
 */
import { supports, useCapabilities } from '../../sdk/capabilities.js';
import {
  AXIS_LOCK_SLOP,
  createScrollEngine,
  lockDragAxis,
  type ScrollEngine,
} from '../../sdk/scroll.js';
import type { ElementNode } from '../../core/elementNode.js';
import { contentExtent as contentExtentOf } from './contentExtent.js';

export interface TouchScrollOptions {
  axis: 'x' | 'y';
  /**
   * Snap slots in scene units, or a getter (a horizontal rail passes its item
   * width + gap). Omitted scrolls continuously.
   */
  snap?: number | (() => number);
}

export interface TouchScrollBinding {
  readonly axis: 'x' | 'y';
  readonly engine: ScrollEngine;
  /** A pointer drag from the scene's gesture recogniser. */
  drag(
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ): void;
  /** Re-read the content and viewport sizes after a layout pass. */
  layout(): void;
  /** Bring a child on the focus path into view, only as far as needed. */
  reveal(child: ElementNode | undefined, duration?: number): void;
  /**
   * Bring any descendant into view: a field, the editor that covers it, a
   * pressed row. `bottomInset` keeps it above the software keyboard.
   */
  revealElement(
    target: ElementNode,
    options?: { duration?: number; bottomInset?: number },
  ): void;
  /** Stop any fling or settle. */
  stop(): void;
  /** Move the content by a wheel delta (scene units, already normalised). */
  wheel(delta: number): void;
  /** Move the content by a wheel delta (scene units, already normalised). */
  wheel(delta: number): void;
  /** Adopt a position written by something else, before a drag claims it. */
  sync(): void;
  dispose(): void;
}

interface Point {
  x: number;
  y: number;
}

const bindings = new WeakMap<ElementNode, TouchScrollBinding>();

/** Targets where focus movement, not direct manipulation, is the model. */
const TELEVISION_TARGETS = new Set([
  'tizen',
  'webos',
  'vizio',
  'roku',
  'android-tv',
  'apple-tv',
  // The console's pointer is a remote: its UI is the television's, d-pad
  // first, so direct-manipulation scrolling is not bound there.
  'ps4',
]);

/**
 * Whether the current host should honour `scroll="touch"`: a pointer-touch
 * host (mobile, web touch, the PS4's pointer remote) and never a television,
 * where the focus model stays the default even if its browser reports a
 * mouse (webOS does).
 */
export function supportsTouchScroll(): boolean {
  if (TELEVISION_TARGETS.has(useCapabilities().target)) return false;
  return supports('touch') || supports('mouse');
}

/**
 * Whether a Row/Column with no `scroll` prop should bind direct manipulation
 * by default. A pure touch device (a phone or tablet) gets it; a host with a
 * mouse keeps focus/wheel scrolling unless the app opts in, because a mouse
 * drag is not the primary way a desktop page scrolls. TVs never get it.
 */
export function defaultTouchScroll(): boolean {
  const target = useCapabilities().target;
  if (TELEVISION_TARGETS.has(target)) return false;
  return supports('touch') && !supports('mouse');
}

function clippingAncestor(node: ElementNode): ElementNode | undefined {
  let parent = node.parent;
  while (parent !== undefined) {
    if (parent.clipping) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function treeRoot(node: ElementNode): ElementNode {
  let root = node;
  while (root.parent !== undefined) root = root.parent;
  return root;
}

function childScale(child: ElementNode): number {
  const focus = (child as unknown as { $focus?: { scale?: number } }).$focus;
  return (child.scale as number | undefined) ?? focus?.scale ?? 1;
}

/**
 * Bind a scroll engine to `node`. The caller wires `binding.drag` to the
 * node's `onPointerDrag` and calls `layout` from `onLayout`.
 */
export function bindTouchScroll(
  node: ElementNode,
  options: TouchScrollOptions,
): TouchScrollBinding {
  const { axis } = options;
  const dimension = axis === 'x' ? 'width' : 'height';
  let base = 0;
  let inset = 0;
  let viewportSize = 0;
  let ready = false;

  // Direct manipulation writes the position every frame. A transition on the
  // node (focus navigation sets one for x/y) would make the renderer chase
  // each write with a 180 ms ease, lagging the finger and the settle; bypass
  // it for the engine's own writes and put it back for everything else.
  function writeAxis(value: number) {
    const transition = node.transition;
    if (transition === undefined) {
      node[axis] = value;
      return;
    }
    node.transition = undefined;
    node[axis] = value;
    node.transition = transition;
  }

  const engine = createScrollEngine({
    axis,
    snap: options.snap,
    onOffset(value) {
      if (ready) writeAxis(base - value);
    },
  });

  function sync() {
    if (ready) engine.sync(base - (node[axis] || 0));
  }

  function layout() {
    if (!ready) {
      base = node[axis] || 0;
      ready = true;
    }
    const clip = clippingAncestor(node);
    const root = treeRoot(node);
    const viewport = clip ?? root;
    const visible = viewport[dimension] || 0;
    const content = contentExtentOf(node, axis);
    const parent = node.parent;
    const parentStart = parent
      ? ((axis === 'x' ? parent.absX : parent.absY) as number) || 0
      : 0;
    const clipStart = clip
      ? ((axis === 'x' ? clip.absX : clip.absY) as number) || 0
      : 0;
    inset = parentStart - clipStart + base;
    viewportSize = visible;
    engine.layout(content, visible, inset);
    // Adopt the node's position only while the engine rests. A layout pass
    // runs whenever children mount or unmount — mid-drag, mid-fling, on a
    // page that grows as it loads — and an unconditional sync() there would
    // kill the gesture under the finger's hands. Mid-flight, the engine's
    // own `layout` already clamps what it must, at rest only.
    if (engine.settled()) sync();
  }

  function reveal(child: ElementNode | undefined, duration = 180) {
    if (!ready || child === undefined) return;
    const start = inset + ((child[axis] as number) || 0);
    const end = start + ((child[dimension] as number) || 0) * childScale(child);
    engine.reveal(start, end, viewportSize, duration);
  }

  /**
   * The absolute offset from the scroller's own origin is the descendant's
   * local position, including every intermediate parent, which is exactly
   * what the engine's reveal takes. The keyboard inset shortens the visible
   * band rather than moving the content.
   */
  function revealElement(
    target: ElementNode,
    options: { duration?: number; bottomInset?: number } = {},
  ) {
    if (!ready || target.destroyed === true) return;
    const targetStart = axis === 'x' ? target.absX : target.absY;
    const origin = axis === 'x' ? node.absX : node.absY;
    const start = inset + ((targetStart as number) - (origin as number));
    const size = (target[dimension] as number) || 0;
    const visible = Math.max(0, viewportSize - (options.bottomInset ?? 0));
    engine.reveal(start, start + size, visible, options.duration ?? 180);
  }

  // ---- Nested routing. The scene's pointer hands the drag to the nearest
  // node with `onPointerDrag`; this router walks out to the scrollers around
  // it and lets the gesture's dominant axis choose one. The lock lasts for
  // the drag, so a vertical page cannot steal a horizontal rail mid-gesture.
  let active: TouchScrollBinding | undefined;
  let origin: Point | undefined;
  let decided = false;

  function valueOf(target: TouchScrollBinding, point: Point): number {
    return target.axis === 'x' ? point.x : point.y;
  }

  function chainFrom(start: ElementNode): TouchScrollBinding[] {
    const chain: TouchScrollBinding[] = [];
    let current: ElementNode | undefined = start;
    while (current !== undefined) {
      const binding = bindings.get(current);
      if (binding !== undefined) chain.push(binding);
      current = current.parent;
    }
    return chain;
  }

  function decide(point: Point) {
    if (decided || origin === undefined) return;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (dx * dx + dy * dy < AXIS_LOCK_SLOP * AXIS_LOCK_SLOP) return;
    const chain = chainFrom(node);
    const index = lockDragAxis(
      chain.map((binding) => binding.axis),
      dx,
      dy,
      AXIS_LOCK_SLOP,
    );
    decided = true;
    if (index < 0) return;
    active = chain[index];
    if (active === undefined) return;
    // Take the current position from the view: focus scrolling may have
    // moved it since the engine last wrote it.
    active.sync();
    active.engine.dragAxis('start', valueOf(active, point));
  }

  function drag(
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: Point,
    at: Point,
  ) {
    if (phase === 'start') {
      active = undefined;
      decided = false;
      origin = { x: at.x, y: at.y };
      decide(point);
      return;
    }
    if (phase === 'move') {
      if (!decided) decide(point);
      if (active !== undefined)
        active.engine.dragAxis('move', valueOf(active, point));
      return;
    }
    if (active !== undefined)
      active.engine.dragAxis(phase, valueOf(active, point));
    active = undefined;
    decided = false;
    origin = undefined;
  }

  const binding: TouchScrollBinding = {
    axis,
    engine,
    drag,
    layout,
    reveal,
    revealElement,
    stop: () => engine.stop(),
    wheel(delta) {
      if (delta === 0) return;
      // A wheel is direct manipulation, like a finger: the content moves at
      // once, and the platform's own momentum is the event stream that
      // follows. No animation of our own.
      engine.stop();
      engine.to(engine.offset() + delta, 0);
    },
    sync,
    dispose() {
      if (bindings.get(node) === binding) bindings.delete(node);
      (node as unknown as { scrollCatch?: () => void }).scrollCatch = undefined;
      engine.stop();
      active = undefined;
    },
  };
  // A press anywhere on a flying scroller catches it, as UIScrollView stops a
  // deceleration on touch-down. The scene pointer calls this from press-begin
  // for every scroller on the press node's ancestry, so a finger that holds
  // still stops the flight even below the drag slop, and a nested page claim
  // leaves no rail flying under the gesture.
  (node as unknown as { scrollCatch?: () => void }).scrollCatch = () => {
    // One finger owns a drag: another press landing mid-drag must not stop
    // it. A flight (fling, snap, rubber-band return) has no owner, so it is
    // caught.
    if (!engine.dragging()) engine.stop();
  };
  bindings.set(node, binding);
  return binding;
}
