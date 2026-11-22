/**
 * Pointer and touch input.
 *
 * A host turns its platform's events into `down`/`move`/`up`/`wheel` calls in
 * scene coordinates (a {@link PointerSource} feeding a {@link PointerSink}).
 * The framework does the rest in one place, {@link createScenePointer}: it
 * finds the node under the pointer by walking the scene, and recognises
 * hover, press, click, hold, drag and scroll. `startApp` connects the two, so
 * an application registers nothing.
 *
 * Which nodes take a pointer (a "pointer target"): a rendered node with any of
 * `onEnter`, `onMouseClick`, `onPointerHold`, `onPointerDrag`,
 * `onPointerContext`, `onPointerEnter`, `onPointerLeave`, `onFocus`,
 * `cursorStyle`, or a style for the focus, hover or pressed state (`$focus`,
 * `$hover`, `$pressed`). `onPointerScroll` makes a node a target of the wheel
 * only: clicking a scroll container's empty space stays a click on nothing.
 *
 * Which target is under a point: the front-most one, where a node is in
 * front of its parent and of the siblings painted before it (higher `zIndex`,
 * then later in the child list). A node is only looked at where its ancestors
 * are: outside an ancestor's box it cannot be hit, which is also what
 * `clipping` shows. A touch scroller is the exception: its own box travels
 * with the content while the content paints across its clipping ancestor's
 * window, so it is looked at wherever that window is. `alpha` 0 and
 * `skipFocus` take a node and everything inside it out; nodes that are not
 * targets let the pointer through to what is behind them; a target with
 * `ariaDisabled` stops the pointer and does nothing. While a focus trap is
 * active (a modal), only the trap is searched.
 * The children of a flex container that is still waiting for a text to be
 * measured have no place yet and are not hit.
 *
 * Nothing here runs unless the host calls in: no listeners, no frame work and
 * no polling. The one timer is the hold timeout, set while a press is down on
 * a node with `onPointerHold`. A pointer move allocates nothing.
 */
import { getOwner, runWithOwner } from 'solid-js';
import { activeElement } from '../core/activeElement.js';

import { Config } from '../core/config.js';
import type { ElementNode } from '../core/elementNode.js';
import {
  currentFocusTrap,
  focusPath,
  hideFocusVisible,
  pressKey,
  type KeyEventLike,
} from '../core/focusManager.js';
import type { DollarString } from '../core/intrinsicTypes.js';
import { isElementNode, isElementText, isFunction } from '../core/utils.js';
import { cursorForElement, type CursorStyle } from './cursor.js';
import { normalizeWheelDelta } from './scroll.js';

declare module '../core/elementNode.js' {
  interface ElementNode {
    /**
     * Called for a secondary click (right click, Control-click, a trackpad's
     * secondary click) on this element or anything inside it. A handler here
     * makes the element a pointer target; the nearest handler out from the
     * point opens the menu. Desktop and iPadOS: a context menu is the
     * pointer's counterpart of a long press.
     */
    onPointerContext?: (
      this: ElementNode,
      point: Point,
      node: ElementNode,
    ) => void;
    /** The pointer came over this element; the outermost state owner when one forwards states. */
    onPointerEnter?: (this: ElementNode, node: ElementNode) => void;
    /** The pointer left this element, or the scene. */
    onPointerLeave?: (this: ElementNode, node: ElementNode) => void;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/** What a host calls with pointer input. Points are in scene coordinates. */
export interface PointerSink {
  /** A pointer went down. True when it landed on something. */
  down(id: number, point: Point): boolean;
  /** A pointer moved. `canHover` is false for touch, which does not hover. */
  move(id: number, point: Point, canHover?: boolean): void;
  /** A pointer went up: a click, unless it was a hold or a drag. */
  up(id: number, point: Point): void;
  /** The platform took one pointer away, or all of them: no click. */
  cancel(id: number): void;
  cancelAll(): void;
  /** The pointer left the surface. */
  leave(): void;
  /** A wheel or trackpad scroll. True when the scene used it. */
  wheel(point: Point, x: number, y: number): boolean;
  /**
   * A secondary click: a context menu request. True when a node handled it.
   * A host that cannot report one leaves this out.
   */
  context?(point: Point): boolean;
}

/** A host's pointer input: mouse, touch, pen, a pointer remote. */
export interface PointerSource {
  /**
   * Starts delivering pointer input to `sink` and returns how to stop. A
   * host listens for nothing before this is called.
   */
  connect(sink: PointerSink): () => void;
  /** Shows the cursor of the hovered node; `undefined` puts the default back. */
  setCursor?(style: CursorStyle | undefined): void;
}

export interface ScenePointerOptions {
  /** Milliseconds a press stays down before `onPointerHold`. Defaults to 550. */
  holdMs?: number;
  /**
   * How far a press may move, in scene units, before it drags what can be
   * dragged. Defaults to 8.
   */
  slop?: number;
  /** State of the hovered node. Defaults to `$hover`. */
  hoverState?: DollarString;
  /** State of a pressed node. Defaults to `$pressed`. */
  pressedState?: DollarString;
  /**
   * Focus what the pointer hovers, as a pointer remote does on a TV. Off by
   * default: a click focuses.
   */
  hoverFocus?: boolean;
  /** Shows a cursor; `undefined` puts the platform's own back. */
  cursor?(style: CursorStyle | undefined): void;
}

export interface ScenePointer extends PointerSink {
  /**
   * Moves focus to the next node a click could focus, in tree order, and
   * around at the ends: Tab on a keyboard. False when there is none.
   */
  focusNext(reverse?: boolean): boolean;
  /**
   * Turns focus-on-hover on or off for this scene. A host whose pointer is
   * its only input (the PS4 browser) turns it on when it connects, so that
   * moving the pointer focuses what it is over. Nothing else changes: the
   * hover state, cursor and click path stay as they are.
   */
  setHoverFocus(enabled: boolean): void;
  dispose(): void;
}

interface Press {
  node: ElementNode;
  /** The node that shows the pressed state: `node`, or who forwards states to it. */
  shown: ElementNode;
  /** The node being dragged, once the press has become a drag. */
  dragged: ElementNode | undefined;
  /** The press left the slop and nothing around it can be dragged. */
  fixed: boolean;
  /** Another finger already owns a drag: this press is ignored. */
  multi: boolean;
  held: boolean;
  origin: Point;
  point: Point;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// A key event for input that is not a key. Handlers written for a browser
// may call these two methods.
const keyEvent = (key: string, keyCode: number): KeyEventLike =>
  Object.freeze({
    key,
    keyCode,
    which: keyCode,
    repeat: false,
    preventDefault() {},
    stopPropagation() {},
  });
const ENTER = keyEvent('Enter', 13);
const ARROW_UP = keyEvent('ArrowUp', 38);
const ARROW_DOWN = keyEvent('ArrowDown', 40);

/** Milliseconds between two focus steps made by a wheel nothing scrolled with. */
const WHEEL_STEP_MS = 250;

/** The node that shows a state for `node`: the outermost that forwards its states to it. */
function stateOwner(node: ElementNode): ElementNode {
  let parent = node.parent;
  while (parent !== undefined && parent.forwardStates) {
    node = parent;
    parent = parent.parent;
  }
  return node;
}

/** Keeps a `Row` or `Column` pointing at the child that is about to be focused. */
function selectInParent(node: ElementNode): void {
  const parent = node.parent;
  if (parent !== undefined && parent.selected !== undefined) {
    parent.selected = parent.children.indexOf(node);
  }
}

/**
 * Activates `node` the way a remote's OK key does: focuses it, then presses
 * Enter on the focus path (`onEnter`). Nothing is pressed when focus could
 * not go there, as with a node outside a modal's focus trap.
 */
export function activateNode(node: ElementNode): void {
  selectInParent(node);
  node.setFocus();
  // setFocus applies in the post-mutation microtask queued before this one.
  queueMicrotask(() => {
    if (focusPath().indexOf(node) !== -1) pressKey('Enter', ENTER);
  });
}

const attached = new Set<ElementNode>();

/** Whether a scene pointer is hit-testing `root`. */
export function hasScenePointer(root: ElementNode): boolean {
  return attached.has(root);
}

/**
 * The scene's pointer handling for the tree under `root`: the hit test and
 * the gesture recogniser. A host's {@link PointerSource} feeds it.
 */
export function createScenePointer(
  root: ElementNode,
  options: ScenePointerOptions = {},
): ScenePointer {
  const holdMs = options.holdMs ?? 550;
  const slop = options.slop ?? 8;
  const hoverState = options.hoverState ?? '$hover';
  const pressedState = options.pressedState ?? '$pressed';
  let hoverFocus = options.hoverFocus === true;
  const showCursor = options.cursor;
  const owner = getOwner();
  const presses = new Map<number, Press>();
  let hovered: ElementNode | undefined;
  /** The node the pointer is actually over, for enter/leave handlers. */
  let hoverTarget: ElementNode | undefined;
  let cursor: CursorStyle | undefined;
  /** The pointer presses that have become drags; Escape cancels them. */
  const dragging = new Set<number>();
  let escapeBound = false;
  let lastWheelStep = -WHEEL_STEP_MS;
  attached.add(root);

  // ---- Hit test. The point is kept here so that the walk takes no
  // arguments and builds nothing.
  let px = 0;
  let py = 0;
  // The wheel also searches for a node that only handles scrolling. A
  // scroll container is not a click target: clicking its empty space must
  // not focus or activate anything.
  let forScroll = false;

  const isTarget = (node: ElementNode): boolean =>
    !!(
      node.onEnter ||
      node.onMouseClick ||
      node.onPointerHold ||
      node.onPointerDrag ||
      node.onPointerContext ||
      node.onPointerEnter ||
      node.onPointerLeave ||
      node.onFocus ||
      node.cursorStyle ||
      node[Config.focusStateKey] ||
      node[hoverState] ||
      node[pressedState] ||
      (forScroll && node.onPointerScroll)
    );

  const inside = (node: ElementNode): boolean => {
    const x = node.absX || 0;
    const y = node.absY || 0;
    return (
      px >= x &&
      py >= y &&
      px < x + (node.width || 0) &&
      py < y + (node.height || 0)
    );
  };

  /**
   * Whether `node` is a flex container that has not placed its children yet.
   * Flex lays nothing out while a text child is unmeasured (`calculateFlex`
   * returns early), and a text is measured in a frame of the renderer: until
   * then the children are where they were created, on top of each other, and
   * the one under a point is whichever was added last. None of them is hit.
   */
  const unplaced = (node: ElementNode): boolean => {
    if (node.display !== 'flex') return false;
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isElementText(child) && child.text && !(child.width || child.height))
        return true;
    }
    return false;
  };

  /** The front-most target under the point in `node`, which the point is in. */
  function probe(node: ElementNode): ElementNode | undefined {
    if (unplaced(node)) return isTarget(node) ? node : undefined;
    const children = node.children;
    const count = children.length;
    // Front to back. Usually every child has the same zIndex, and that is
    // last to first.
    let top = -Infinity;
    let mixed = false;
    for (let i = 0; i < count; i++) {
      const z = (children[i]!.zIndex as number | undefined) || 0;
      if (z !== top) {
        if (top !== -Infinity) mixed = true;
        if (z > top) top = z;
      }
    }
    if (!mixed) {
      for (let i = count - 1; i >= 0; i--) {
        const hit = probeChild(children[i]!);
        if (hit !== undefined) return hit;
      }
    } else {
      // Next lower (zIndex, index) each round: no sorted copy of the list.
      let lastZ = Infinity;
      let lastIndex = count;
      for (;;) {
        let pick = -1;
        let pickZ = -Infinity;
        for (let i = 0; i < count; i++) {
          const z = (children[i]!.zIndex as number | undefined) || 0;
          if ((z < lastZ || (z === lastZ && i < lastIndex)) && z >= pickZ) {
            pick = i;
            pickZ = z;
          }
        }
        if (pick === -1) break;
        lastZ = pickZ;
        lastIndex = pick;
        const hit = probeChild(children[pick]!);
        if (hit !== undefined) return hit;
      }
    }
    return isTarget(node) ? node : undefined;
  }

  /**
   * A touch scroller is a window, not a box. The scroll engine translates the
   * node itself (`scrollAxis` marks one), so after a drag its own box sits
   * part way up the screen while its content paints across the window its
   * clipping ancestor shows. A point claims the scroller only where that
   * content can be: inside the window, and inside the union of the node's
   * own box and its children's boxes — so a scroller never shadows a sibling
   * that shares its window (a header above a page column, a second pane
   * beside it).
   */
  function scrollerWindow(child: ElementNode, x: number, y: number): boolean {
    if ((child as { scrollAxis?: 'x' | 'y' }).scrollAxis === undefined)
      return false;
    let clip: ElementNode | undefined = child.parent;
    while (clip !== undefined && !clip.clipping) clip = clip.parent;
    const box = clip ?? root;
    const bx = (box.absX || 0) as number;
    const by = (box.absY || 0) as number;
    if (
      x < bx ||
      y < by ||
      x >= bx + (box.width || 0) ||
      y >= by + (box.height || 0)
    )
      return false;
    // Inside the window. Inside the scroller's own box, or inside the span
    // its content paints across: the union of the children's boxes, as one
    // region — a scroll view owns the gaps between its content too, so a
    // finger between two sections still claims it. The children's boxes are
    // live, so a translated scroller claims exactly where it shows.
    const cx = (child.absX || 0) as number;
    const cy = (child.absY || 0) as number;
    let x0 = cx;
    let y0 = cy;
    let x1 = cx + (child.width || 0);
    let y1 = cy + (child.height || 0);
    const children = child.children;
    if (children && typeof children[Symbol.iterator] === 'function') {
      for (const item of children) {
        if (typeof item !== 'object' || item === null) continue;
        const node = item as ElementNode;
        const nx = (node.absX || 0) as number;
        const ny = (node.absY || 0) as number;
        if (nx < x0) x0 = nx;
        if (ny < y0) y0 = ny;
        const nx1 = nx + (node.width || 0);
        const ny1 = ny + (node.height || 0);
        if (nx1 > x1) x1 = nx1;
        if (ny1 > y1) y1 = ny1;
      }
    }
    return x >= x0 && y >= y0 && x < x1 && y < y1;
  }

  function probeChild(child: ElementNode['children'][number]) {
    if (
      !isElementNode(child) ||
      !child.rendered ||
      child.alpha === 0 ||
      child.skipFocus
    )
      return undefined;
    const sx = (child.scaleX ?? child.scale ?? 1) as number;
    const sy = (child.scaleY ?? child.scale ?? 1) as number;
    if ((sx === 1 && sy === 1) || !sx || !sy)
      return inside(child) || scrollerWindow(child, px, py)
        ? probe(child)
        : undefined;
    // `absX`/`absY` add up `x`/`y` and know no scale: they place a scaled
    // node and its subtree where they would be drawn unscaled. Undo the
    // scale on the point, about the node's pivot, while searching in it.
    const x = px;
    const y = py;
    const cx =
      (child.absX || 0) +
      (child.width || 0) * ((child.pivotX ?? child.pivot ?? 0.5) as number);
    const cy =
      (child.absY || 0) +
      (child.height || 0) * ((child.pivotY ?? child.pivot ?? 0.5) as number);
    px = cx + (x - cx) / sx;
    py = cy + (y - cy) / sy;
    const found =
      inside(child) || scrollerWindow(child, x, y) ? probe(child) : undefined;
    px = x;
    py = y;
    return found;
  }

  /** The target under a point, disabled or not. */
  function hit(
    x: number,
    y: number,
    scrollTargets = false,
  ): ElementNode | undefined {
    px = x;
    py = y;
    forScroll = scrollTargets;
    const start = currentFocusTrap() ?? root;
    let found: ElementNode | undefined;
    if (start.rendered && start.alpha !== 0) {
      // The root need not contain the point for its children to be searched.
      found = probe(start);
      if (found === start && !inside(start)) found = undefined;
    }
    forScroll = false;
    return found;
  }

  // ---- Hover and cursor.
  function setCursor(style: CursorStyle | undefined) {
    if (style !== cursor) {
      cursor = style;
      showCursor?.(style);
    }
  }

  function setHover(node: ElementNode | undefined) {
    // Enter/leave follow the node under the pointer, not the one that shows
    // the state: a control that forwards states still wants its own handlers.
    const targetChanged = node !== hoverTarget;
    if (targetChanged) {
      const leaving = hoverTarget;
      hoverTarget = node;
      leaving?.onPointerLeave?.call(leaving, leaving);
    }
    const shown = node === undefined ? undefined : stateOwner(node);
    if (shown === hovered) {
      // A pointer-only host keeps focus under the pointer even when the
      // hovered node did not change: a click elsewhere moved focus away, and
      // the next move over the same node must bring it back.
      if (hoverFocus && shown !== undefined) {
        selectInParent(shown);
        shown.setFocus();
      }
      if (targetChanged && node !== undefined)
        node.onPointerEnter?.call(node, node);
      return;
    }
    hovered?.states.remove(hoverState);
    hovered = shown;
    if (shown === undefined) return;
    shown.states.add(hoverState);
    if (hoverFocus) {
      selectInParent(shown);
      shown.setFocus();
    }
    if (node !== undefined) node.onPointerEnter?.call(node, node);
  }

  function hoverAt(x: number, y: number) {
    const node = hit(x, y);
    if (node === undefined) {
      setHover(undefined);
      setCursor(undefined);
    } else if (node.ariaDisabled === true) {
      setHover(undefined);
      setCursor(node.cursorStyle);
    } else {
      setHover(node);
      setCursor(cursorForElement(node));
    }
  }

  // ---- Presses.
  function release(press: Press) {
    clearTimeout(press.timer);
    press.timer = undefined;
    press.shown.states.remove(pressedState);
  }

  // Escape cancels a drag while one is in progress. The listener exists only
  // between a drag's start and its end: an idle scene has none.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    for (const id of [...dragging]) cancel(id);
  };
  function bindEscape() {
    if (escapeBound || typeof document === 'undefined') return;
    escapeBound = true;
    document.addEventListener('keydown', onEscape, true);
  }
  function unbindEscape() {
    if (!escapeBound || dragging.size !== 0) return;
    escapeBound = false;
    if (typeof document !== 'undefined')
      document.removeEventListener('keydown', onEscape, true);
  }

  function cancel(id: number) {
    const press = presses.get(id);
    if (press === undefined) return;
    presses.delete(id);
    release(press);
    const dragged = press.dragged;
    if (dragged !== undefined) {
      dragging.delete(id);
      dragged.onPointerDrag!('cancel', press.point, press.origin, dragged);
      unbindEscape();
    }
  }

  function begin(id: number, node: ElementNode, x: number, y: number) {
    cancel(id);
    // A press catches every flying scroller it lands in, as UIScrollView
    // stops a deceleration the moment a touch comes down. A finger that
    // holds still never crosses the drag slop, so the catch has to happen
    // here, not in the drag: without it a resting finger cannot stop a
    // fling, and the flight runs on under it to its own settle.
    for (
      let scroller: ElementNode | undefined = node;
      scroller !== undefined;
      scroller = scroller.parent
    ) {
      const catchOne = (scroller as { scrollCatch?: () => void }).scrollCatch;
      if (catchOne !== undefined) catchOne.call(scroller);
    }
    const press: Press = {
      node,
      shown: stateOwner(node),
      dragged: undefined,
      fixed: false,
      multi: false,
      held: false,
      origin: { x, y },
      point: { x, y },
      timer: undefined,
    };
    presses.set(id, press);
    press.shown.states.add(pressedState);
    if (isFunction(node.onPointerHold)) {
      press.timer = setTimeout(() => {
        press.timer = undefined;
        if (presses.get(id) !== press) return;
        // The screen changed under the held finger: the node it pressed is
        // gone, and a hold must not fire into a dead node's handler.
        if (node.destroyed === true) {
          cancel(id);
          return;
        }
        // A touch that lands while another finger owns a drag does not
        // long-press (UIKit holds it out of the pan); it may still lift as
        // a tap if the drag has ended by then.
        if (dragging.size > 0) return;
        if (node.ariaDisabled === true) {
          cancel(id);
          return;
        }
        press.held = true;
        runWithOwner(owner, () => node.onPointerHold!(node, press.point));
      }, holdMs);
    }
  }

  /** The nearest node from `node` out that can be dragged. */
  function draggable(node: ElementNode | undefined): ElementNode | undefined {
    while (node !== undefined && !isFunction(node.onPointerDrag)) {
      node = node.parent;
    }
    return node;
  }

  // ---- The sink. Each call's arguments are parked in these so that it can
  // run in the app's owner (handlers may create computations) without a
  // closure per event.
  let argId = 0;
  let argX = 0;
  let argY = 0;
  let argHover = true;
  let argDeltaX = 0;
  let argDeltaY = 0;
  let result = false;
  const wheelEvent = { deltaX: 0, deltaY: 0 };

  const onDown = () => {
    // A pointer press is not a navigation interaction: focus it reaches is
    // drawn without a ring on a pointer-first host.
    hideFocusVisible();
    const node = hit(argX, argY);
    result = node !== undefined && node.ariaDisabled !== true;
    if (result) begin(argId, node!, argX, argY);
  };

  const onMove = () => {
    const press = presses.get(argId);
    if (press === undefined) {
      if (argHover) hoverAt(argX, argY);
      return;
    }
    press.point.x = argX;
    press.point.y = argY;
    if (press.node.ariaDisabled === true) {
      cancel(argId);
      return;
    }
    let dragged = press.dragged;
    if (dragged === undefined && !press.held && !press.fixed) {
      const dx = argX - press.origin.x;
      const dy = argY - press.origin.y;
      if (dx * dx + dy * dy > slop * slop) {
        // One finger owns a drag. A second one landing mid-scroll would
        // otherwise restart the gesture from its own position and throw the
        // content across the screen; a scroll view ignores extra touches
        // until the first lifts, and so does this.
        if (dragging.size > 0) {
          // This finger is not part of the gesture: it may not scroll, and
          // it may not turn into a click when it lifts — so the pressed look
          // it arrived with goes too.
          release(press);
          press.multi = true;
          return;
        }
        dragged = draggable(press.node);
        if (dragged === undefined) {
          press.fixed = true;
        } else {
          // The press is a drag now: no hold, no pressed look, no click.
          release(press);
          press.dragged = dragged;
          dragging.add(argId);
          bindEscape();
          dragged.onPointerDrag!('start', press.point, press.origin, dragged);
        }
      }
    }
    if (dragged !== undefined) {
      dragged.onPointerDrag!('move', press.point, press.origin, dragged);
    }
  };

  const onUp = () => {
    const press = presses.get(argId);
    if (press === undefined) return;
    presses.delete(argId);
    release(press);
    press.point.x = argX;
    press.point.y = argY;
    const node = press.node;
    const dragged = press.dragged;
    if (dragged !== undefined) {
      dragging.delete(argId);
      dragged.onPointerDrag!('end', press.point, press.origin, dragged);
      unbindEscape();
    } else if (
      !press.held &&
      !press.multi &&
      // A tap that lands while another finger scrolls is not a tap.
      dragging.size === 0 &&
      node.ariaDisabled !== true &&
      hit(argX, argY) === node
    ) {
      if (isFunction(node.onMouseClick)) {
        node.onMouseClick(press.point, node);
      } else {
        activateNode(node);
      }
    }
  };

  const onWheel = () => {
    wheelEvent.deltaX = argDeltaX;
    wheelEvent.deltaY = argDeltaY;
    let node = hit(argX, argY, true);
    while (node !== undefined) {
      const scroll = node.onPointerScroll;
      if (isFunction(scroll) && scroll.call(node, wheelEvent, node) !== false) {
        result = true;
        return;
      }
      node = node.parent;
    }
    // Nothing scrolls here: step focus up or down, as the arrow keys would.
    if (argDeltaY === 0) {
      result = false;
      return;
    }
    const now = performance.now();
    if (now - lastWheelStep < WHEEL_STEP_MS) {
      result = true;
      return;
    }
    lastWheelStep = now;
    result =
      argDeltaY < 0 ? pressKey('Up', ARROW_UP) : pressKey('Down', ARROW_DOWN);
  };

  const onContext = () => {
    let node = hit(argX, argY);
    result = false;
    while (node !== undefined) {
      // A disabled control stops the search: nothing around it handles the
      // secondary click for it.
      if (node.ariaDisabled === true) return;
      const handler = node.onPointerContext;
      if (isFunction(handler)) {
        result = true;
        handler.call(node, { x: argX, y: argY }, node);
        return;
      }
      node = node.parent;
    }
  };

  const onCancelAll = () => {
    for (const id of [...presses.keys()]) cancel(id);
    setHover(undefined);
    setCursor(undefined);
  };

  const onLeave = () => {
    setHover(undefined);
    setCursor(undefined);
  };

  const onCancel = () => cancel(argId);

  return {
    down(id, point) {
      argId = id;
      argX = point.x;
      argY = point.y;
      runWithOwner(owner, onDown);
      return result;
    },
    move(id, point, canHover = true) {
      argId = id;
      argX = point.x;
      argY = point.y;
      argHover = canHover;
      runWithOwner(owner, onMove);
    },
    up(id, point) {
      argId = id;
      argX = point.x;
      argY = point.y;
      runWithOwner(owner, onUp);
    },
    cancel(id) {
      argId = id;
      runWithOwner(owner, onCancel);
    },
    cancelAll() {
      runWithOwner(owner, onCancelAll);
    },
    leave() {
      runWithOwner(owner, onLeave);
    },
    wheel(point, x, y) {
      argX = point.x;
      argY = point.y;
      argDeltaX = x;
      argDeltaY = y;
      runWithOwner(owner, onWheel);
      return result;
    },
    context(point) {
      argX = point.x;
      argY = point.y;
      runWithOwner(owner, onContext);
      return result;
    },
    focusNext(reverse = false) {
      const stops: ElementNode[] = [];
      const collect = (node: ElementNode) => {
        if (
          (node.onEnter || node.onFocus || node[Config.focusStateKey]) &&
          node.ariaDisabled !== true
        ) {
          stops.push(node);
        }
        for (const child of node.children) {
          if (
            isElementNode(child) &&
            child.rendered &&
            child.alpha !== 0 &&
            !child.skipFocus
          ) {
            collect(child);
          }
        }
      };
      collect(currentFocusTrap() ?? root);
      if (stops.length === 0) return false;
      const path = focusPath();
      let index = stops.indexOf(activeElement()!);
      // Focus inside a stop counts as being on it.
      for (let i = 0; index === -1 && i < path.length; i++) {
        index = stops.indexOf(path[i]!);
      }
      const next =
        index === -1
          ? reverse
            ? stops.length - 1
            : 0
          : (index + (reverse ? -1 : 1) + stops.length) % stops.length;
      selectInParent(stops[next]!);
      stops[next]!.setFocus();
      return true;
    },
    setHoverFocus(enabled: boolean) {
      hoverFocus = enabled;
    },
    dispose() {
      onCancelAll();
      attached.delete(root);
    },
  };
}

/**
 * For a host that pushes pointer input by hand and has not moved to
 * `startApp`: native touch, the desktop window, browser TVs. The host calls
 * `down`/`move`/`up`/`wheel` on it as it did; it is also the
 * {@link PointerSource} the app is mounted with, and input reaches the scene
 * once that connects it. Nothing is registered on it any more.
 */
export function createInputScope(options: { hoverFocus?: boolean } = {}) {
  let sink: PointerSink | undefined;
  const cancelAll = () => sink?.cancelAll();
  return {
    connect(next: PointerSink) {
      sink = next;
      // A pointer-only host asks for focus on movement; a click and a key
      // host do not. The scene owns the setting, so this changes nothing
      // until input actually arrives.
      if (options.hoverFocus === true)
        (next as Partial<ScenePointer>).setHoverFocus?.(true);
      return () => {
        if (sink === next) sink = undefined;
      };
    },
    down: (id: number, point: Point) => sink?.down(id, point) ?? false,
    move: (id: number, point: Point, canHover = true) =>
      sink?.move(id, point, canHover),
    up: (id: number, point: Point) => sink?.up(id, point),
    leave: () => sink?.leave(),
    cancel: (id: number) => sink?.cancel(id),
    cancelAll,
    wheel: (point: Point, x: number, y: number) =>
      sink?.wheel(point, x, y) ?? false,
    context: (point: Point) => sink?.context?.(point) ?? false,
    /** Tab and Shift+Tab move focus through the scene; other keys are the focus manager's. */
    key(key: string, down: boolean, _repeat = false, shift = false) {
      if (key !== 'Tab' || !down) return false;
      return (
        (sink as Partial<ScenePointer> | undefined)?.focusNext?.(shift) ?? false
      );
    },
    dispose() {
      cancelAll();
      sink = undefined;
    },
  };
}
export type InputScope = ReturnType<typeof createInputScope>;

/**
 * Feeds a page element's pointer events to `sink`. `project` turns client
 * coordinates into scene coordinates.
 */
export function bindPointerEvents(
  element: HTMLElement,
  sink: PointerSink,
  project: (x: number, y: number) => Point,
) {
  const events = new AbortController();
  const opts = { signal: events.signal };
  element.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      if (sink.down(e.pointerId, project(e.clientX, e.clientY))) {
        element.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    opts,
  );
  element.addEventListener(
    'pointermove',
    (e) =>
      sink.move(
        e.pointerId,
        project(e.clientX, e.clientY),
        e.pointerType !== 'touch',
      ),
    opts,
  );
  element.addEventListener(
    'pointerup',
    (e) => sink.up(e.pointerId, project(e.clientX, e.clientY)),
    opts,
  );
  element.addEventListener(
    'pointercancel',
    (e) => sink.cancel(e.pointerId),
    opts,
  );
  element.addEventListener(
    'lostpointercapture',
    (e) => sink.cancel(e.pointerId),
    opts,
  );
  element.addEventListener('pointerleave', () => sink.leave(), opts);
  // A secondary click opens the context menu of the node under the pointer.
  // The browser's own menu is for the page, not an app drawn in a canvas.
  element.addEventListener(
    'contextmenu',
    (e) => {
      // A host editor's <input> owns its platform menu; a scene needs to
      // suppress the canvas's document menu.
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        target !== element &&
        typeof target.closest === 'function' &&
        target.closest('input, textarea, [contenteditable]') !== null
      ) {
        return;
      }
      e.preventDefault();
      sink.context?.(project(e.clientX, e.clientY));
    },
    opts,
  );
  // The keyboard's context-menu key, and Shift+F10 as on Windows and Linux
  // (macOS's Full Keyboard Access), opens the menu of the focused control:
  // a context menu must not be reachable only with a mouse.
  element.ownerDocument?.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      // A native editor's own menu key belongs to the editor.
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        typeof target.closest === 'function' &&
        target.closest('input, textarea, [contenteditable]') !== null
      ) {
        return;
      }
      const node = activeElement();
      if (node === undefined) return;
      e.preventDefault();
      sink.context?.({
        x: (node.absX || 0) + (node.width || 0) / 2,
        y: (node.absY || 0) + (node.height || 0) / 2,
      });
    },
    opts,
  );
  element.addEventListener(
    'wheel',
    (e) => {
      // Pixel, line and page deltas arrive in different units; one wheel
      // notch is one line where the platform says so.
      const delta = normalizeWheelDelta(e, element.clientHeight || 800);
      if (sink.wheel(project(e.clientX, e.clientY), delta.x, delta.y))
        e.preventDefault();
    },
    { ...opts, passive: false },
  );
  const cancelAll = () => sink.cancelAll();
  window.addEventListener('blur', cancelAll, opts);
  return () => {
    events.abort();
    sink.cancelAll();
  };
}
