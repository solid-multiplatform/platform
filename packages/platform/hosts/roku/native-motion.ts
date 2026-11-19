/**
 * Runs `x`, `y` and `alpha` animations on SceneGraph's render thread.
 *
 * The renderer asks the host for an animation per property. This host hands
 * back a `CompositorAnimation` backed by the `SolidMotionGroup` component: one
 * `Animation` node per axis, with a `FloatFieldInterpolator` driving a float
 * field on the group, which the component copies to `translation`/`opacity`.
 * The JavaScript side never ticks those properties, so no frame timer runs
 * while they animate.
 *
 * Properties this cannot run natively (a colour, a delay, a loop, `scale`,
 * an unknown easing, a node that is not a motion root) return `undefined` and
 * the renderer falls back to its JavaScript clock.
 */
import { setProp } from '@roku-sdk/solid';
import {
  CompositorAnimation,
  compositorEasing,
  type MotionAction,
  type MotionFeedback,
  type MotionSink,
  type SceneGraphHost,
} from '@solid-multiplatform/renderer/roku';
import type { RokuNode } from '@solid-multiplatform/renderer/roku';

type MotionKey = 'x' | 'y' | 'alpha';

const isMotionKey = (key: string): key is MotionKey =>
  key === 'x' || key === 'y' || key === 'alpha';

/** The per-node routing the component's state callbacks use. */
interface NodeMotion {
  node: RokuNode;
  /** The animation that currently owns each axis, if any. */
  current: Partial<Record<MotionKey, RokuMotionSink>>;
  bound: Set<MotionKey>;
}

const motions = new WeakMap<object, NodeMotion>();

function motionFor(node: RokuNode): NodeMotion {
  let motion = motions.get(node.dom);
  if (!motion) {
    motion = { node, current: {}, bound: new Set() };
    motions.set(node.dom, motion);
  }
  return motion;
}

/** The JS-side name of a component output field (`xState` -> `onXState`). */
function outputHandler(key: MotionKey): string {
  const field = key + 'State';
  return 'on' + field.charAt(0).toUpperCase() + field.slice(1);
}

/**
 * Routes a component state write to the animation now driving that axis.
 * Bound once per node and axis; the component's callbacks fire only when the
 * render thread reports a state change, so binding one schedules nothing.
 */
function bindState(motion: NodeMotion, key: MotionKey): void {
  if (motion.bound.has(key)) return;
  motion.bound.add(key);
  setProp(motion.node.dom, outputHandler(key), (event: MotionFeedback) => {
    motion.current[key]?.feedback(event);
  });
}

class RokuMotionSink implements MotionSink {
  private reply: ((feedback: MotionFeedback) => void) | undefined;
  private serial = 0;

  constructor(
    private motion: NodeMotion,
    private key: MotionKey,
  ) {}

  prepare(): void {
    bindState(this.motion, this.key);
  }

  send(
    action: MotionAction,
    serial: number,
    target: number,
    duration: number,
    easing: string,
    reply: (feedback: MotionFeedback) => void,
  ): void {
    this.reply = reply;
    this.serial = serial;
    this.motion.current[this.key] = this;
    if (action === 'start') this.motion.node.holdNativeMotion(this.key);
    // The component takes seconds; the platform's durations are milliseconds.
    setProp(this.motion.node.dom, this.key + 'Request', {
      serial,
      action,
      to: target,
      duration: Math.max(0, duration) / 1000,
      easing,
    });
  }

  feedback(event: MotionFeedback): void {
    // A replaced run's late "stopped" is still routed here; it must not settle
    // or release the run that replaced it.
    if (event?.serial !== this.serial) return;
    this.reply?.(event);
    if (event?.state === 'stopped') this.release();
  }

  dispose(): void {
    this.release();
  }

  private release(): void {
    if (this.motion.current[this.key] === this)
      delete this.motion.current[this.key];
    this.motion.node.releaseNativeMotion(this.key);
  }
}

/**
 * The host hooks the SceneGraph backend consults for native animations.
 * Pass it to `new SceneGraphRenderer(settings, root, host)`.
 */
export function createRokuMotionHost(): SceneGraphHost {
  return {
    createNativeAnimation(node, key, target, settings) {
      if (!node.nativeMotionRoot || !isMotionKey(key)) return undefined;
      if (!Number.isFinite(target)) return undefined;
      // A delay, loop, repeat, stopMethod or remove needs the JS clock's
      // bookkeeping; an easing this firmware has no name for falls back too.
      const easing = compositorEasing(settings);
      if (!easing) return undefined;
      const value =
        key === 'alpha' ? node.alpha : key === 'x' ? node.x : node.y;
      return new CompositorAnimation(
        value,
        target,
        Math.max(0, settings.duration ?? 0),
        easing,
        (next) => {
          (node as any)[key] = next;
          node.requestRender();
        },
        new RokuMotionSink(motionFor(node), key),
      );
    },
  };
}
