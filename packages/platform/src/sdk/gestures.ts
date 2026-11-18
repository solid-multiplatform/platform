import { createSignal, type Accessor } from 'solid-js';
import type { Point, Rect } from './input.js';
import type { Semantics } from './semantics.js';

export interface PinchPoint extends Point {
  /** Pointer id; the first two distinct ids form the gesture pair. */
  id: number;
}

export interface PinchState {
  active: boolean;
  /** Pointers currently tracked, in insertion order. */
  pointers: readonly PinchPoint[];
  initialDistance: number;
  distance: number;
  /** Current distance / initial distance. 1 when the gesture starts. */
  scale: number;
  initialAngle: number;
  /** Current angle between the pointer pair, radians. */
  angle: number;
  /**
   * Accumulated rotation in radians. Deltas are normalized and summed, so a
   * full turn does not jump at ±π.
   */
  rotation: number;
  center: Point;
  initialCenter: Point;
  /** Centre movement since the gesture started. */
  delta: Point;
}

export interface PinchGestureOptions {
  onStart?(state: PinchState): void;
  onUpdate?(state: PinchState): void;
  /** Called when the last tracked pointer lifts normally. */
  onEnd?(state: PinchState): void;
  /** Called when a pointer is cancelled or the gesture is reset. */
  onCancel?(state: PinchState): void;
}

export interface PinchGesture {
  state: Accessor<PinchState>;
  pointerDown(point: PinchPoint): void;
  pointerMove(point: PinchPoint): void;
  pointerUp(point: PinchPoint): void;
  /** Cancel one pointer, or every pointer when `id` is omitted. */
  pointerCancel(id?: number): void;
  reset(): void;
}

const idle = (): PinchState => ({
  active: false,
  pointers: [],
  initialDistance: 0,
  distance: 0,
  scale: 1,
  initialAngle: 0,
  angle: 0,
  rotation: 0,
  center: { x: 0, y: 0 },
  initialCenter: { x: 0, y: 0 },
  delta: { x: 0, y: 0 },
});

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
const center = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const normalizeAngle = (value: number): number => {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

/**
 * Two-pointer pinch/rotate recognizer. Feed it pointerdown/move/up/cancel
 * events from the host's pointer bridge; it tracks the first two pointers and
 * publishes scale, accumulated rotation and centre movement. This is the RN
 * `PinchGestureHandler` / browser two-pointer contract without a frame loop.
 */
export function createPinchGesture(
  options: PinchGestureOptions = {},
): PinchGesture {
  const [state, setState] = createSignal<PinchState>(idle());
  const pointers = new Map<number, Point>();
  let initialDistance = 0;
  let initialAngle = 0;
  let initialCenter: Point = { x: 0, y: 0 };
  let previousAngle = 0;
  let rotation = 0;

  const snapshotPointers = (): PinchPoint[] =>
    [...pointers].map(([id, point]) => ({ id, x: point.x, y: point.y }));

  const pair = (): [Point, Point] | undefined => {
    if (pointers.size < 2) return undefined;
    const values = [...pointers.values()];
    return [values[0]!, values[1]!];
  };

  const publish = (active: boolean) => {
    const currentPair = pair();
    if (!currentPair) {
      setState({
        ...state(),
        active,
        pointers: snapshotPointers(),
      });
      return;
    }
    const [a, b] = currentPair;
    const nextDistance = distance(a, b);
    const nextAngle = angle(a, b);
    const nextCenter = center(a, b);
    setState({
      active,
      pointers: snapshotPointers(),
      initialDistance,
      distance: nextDistance,
      scale: initialDistance > 0.0001 ? nextDistance / initialDistance : 1,
      initialAngle,
      angle: nextAngle,
      rotation,
      center: nextCenter,
      initialCenter,
      delta: {
        x: nextCenter.x - initialCenter.x,
        y: nextCenter.y - initialCenter.y,
      },
    });
  };

  const begin = () => {
    const currentPair = pair();
    if (!currentPair) return;
    const [a, b] = currentPair;
    initialDistance = distance(a, b);
    initialAngle = angle(a, b);
    previousAngle = initialAngle;
    initialCenter = center(a, b);
    rotation = 0;
    publish(true);
    options.onStart?.(state());
  };

  const end = (cancel: boolean) => {
    if (!state().active && pointers.size < 2) {
      setState(idle());
      return;
    }
    publish(false);
    if (cancel) options.onCancel?.(state());
    else options.onEnd?.(state());
  };

  return {
    state,
    pointerDown(point) {
      if (pointers.has(point.id) || pointers.size >= 2) return;
      pointers.set(point.id, { x: point.x, y: point.y });
      if (pointers.size === 2) begin();
      else publish(false);
    },
    pointerMove(point) {
      if (!pointers.has(point.id)) return;
      pointers.set(point.id, { x: point.x, y: point.y });
      if (!state().active) {
        publish(false);
        return;
      }
      const currentPair = pair();
      if (!currentPair) return;
      const nextAngle = angle(currentPair[0], currentPair[1]);
      rotation += normalizeAngle(nextAngle - previousAngle);
      previousAngle = nextAngle;
      publish(true);
      options.onUpdate?.(state());
    },
    pointerUp(point) {
      if (!pointers.has(point.id)) return;
      const wasActive = state().active;
      pointers.delete(point.id);
      if (wasActive) end(false);
      else if (pointers.size) publish(false);
      else setState(idle());
    },
    pointerCancel(id) {
      if (id === undefined) {
        const wasActive = state().active;
        pointers.clear();
        if (wasActive) end(true);
        else setState(idle());
        return;
      }
      if (!pointers.has(id)) return;
      const wasActive = state().active;
      pointers.delete(id);
      if (wasActive) end(true);
      else if (pointers.size) publish(false);
      else setState(idle());
    },
    reset() {
      const wasActive = state().active;
      pointers.clear();
      if (wasActive) end(true);
      else setState(idle());
    },
  };
}

export interface GestureAlternative {
  id: string;
  label: string;
  run(): void;
  disabled?: boolean | (() => boolean);
}

export interface GestureAlternatives {
  actions: Accessor<readonly GestureAlternative[]>;
  labels: Accessor<string[]>;
  isDisabled(action: GestureAlternative): boolean;
  /** Run one alternative by id. Returns false when missing or disabled. */
  run(id: string): boolean;
  /**
   * Semantics nodes for the alternatives, so a screen reader can activate
   * them instead of the gesture.
   */
  semantics(bounds: (index: number) => Rect): Semantics[];
}

/**
 * Pair gesture-only actions with explicit, labelled alternatives. The hidden
 * test is always true here: every action can be invoked without performing
 * the gesture, and the semantics list gives each one a button role.
 */
export function createGestureAlternatives(
  actions: readonly GestureAlternative[],
): GestureAlternatives {
  const isDisabled = (action: GestureAlternative) =>
    typeof action.disabled === 'function'
      ? action.disabled()
      : !!action.disabled;
  return {
    actions: () => actions,
    labels: () => actions.map((action) => action.label),
    isDisabled,
    run(id) {
      const action = actions.find((candidate) => candidate.id === id);
      if (!action || isDisabled(action)) return false;
      action.run();
      return true;
    },
    semantics(bounds) {
      return actions.map((action, index) => ({
        role: 'button' as const,
        label: action.label,
        disabled: isDisabled(action),
        bounds: () => bounds(index),
        activate: () => {
          if (!isDisabled(action)) action.run();
        },
      }));
    },
  };
}
