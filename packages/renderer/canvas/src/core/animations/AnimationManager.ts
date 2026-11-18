import type { CoreNode } from '../CoreNode.js';
import type {
  IAnimationController,
  AnimationControllerState,
} from '../../common/IAnimationController.js';
import { type TimingFunction } from '../utils.js';
import { mergeColorProgress } from '../../utils.js';

export interface PropValues {
  start: number;
  target: number;
  isColor: boolean;
}

export interface AnimationConfig extends IAnimationController {
  manager: AnimationManager;
  node: CoreNode;
  duration: number;
  lastRunTime: number;
  delayFor: number;
  delay: number;
  progress: number;
  loop: boolean;
  repeat: number;
  stopMethod: 'reverse' | false;
  timingFunction: TimingFunction;
  state: AnimationControllerState;
  props: Record<string, PropValues> | null;
  shaderProps: Record<string, PropValues> | null;
  // Flattened views of `props` / `shaderProps`, built once in
  // `createAnimation` and index-aligned with each other. `applyValues` runs
  // per animation per frame and both records are dictionary-mode objects
  // (they are built key by key from user input), so a `for...in` there
  // re-enumerates their keys every frame instead of hitting an enum cache.
  // The entries are the same `PropValues` objects the records hold, by
  // reference, so `reverseValues` and `restore()` keep working through
  // either view. Nothing adds or removes keys after creation.
  propKeys: string[] | null;
  propList: PropValues[] | null;
  shaderPropKeys: string[] | null;
  shaderPropList: PropValues[] | null;
  stoppedResolve: (() => void) | null;
  stoppedPromise: Promise<void> | null;
}

export class AnimationManager {
  activeAnimations: AnimationConfig[] = [];

  registerAnimation(animation: AnimationConfig) {
    if (!this.activeAnimations.includes(animation)) {
      this.activeAnimations.push(animation);
    }
  }

  unregisterAnimation(animation: AnimationConfig) {
    const idx = this.activeAnimations.indexOf(animation);
    if (idx !== -1) {
      this.activeAnimations.splice(idx, 1);
    }
  }

  update(dt: number) {
    for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
      const anim = this.activeAnimations[i];
      if (!anim) continue;

      if (anim.node.destroyed) {
        anim.stop();
        continue;
      }

      const { duration, loop } = anim;
      let remainingDt = dt;

      if (anim.delayFor > 0) {
        anim.delayFor -= remainingDt;
        if (anim.delayFor >= 0) {
          continue;
        } else {
          remainingDt = -anim.delayFor;
          anim.delayFor = 0;
        }
      }

      if (anim.progress === 0 && anim.state === 'scheduled') {
        anim.state = 'running';
      }

      if (duration === 0) {
        anim.progress = 1;
      } else {
        anim.progress += remainingDt / duration;
      }

      let isFinished = false;
      if (anim.progress >= 1) {
        if (loop) {
          anim.progress = anim.progress % 1;
          anim.delayFor = anim.delay;
        } else {
          anim.progress = 1;
          isFinished = true;
        }
      }

      this.applyValues(anim);

      if (isFinished) {
        if (anim.stopMethod === 'reverse') {
          this.reverseValues(anim);
          anim.progress = 0;
          anim.delayFor = anim.delay;
        } else {
          anim.stop();
        }
      }
    }
  }

  private applyValues(anim: AnimationConfig) {
    const progress = anim.progress;
    const easedProgress = anim.timingFunction(progress);

    const propKeys = anim.propKeys;
    if (propKeys !== null) {
      this.writeValues(
        anim.node as unknown as Record<string, number>,
        propKeys,
        anim.propList!,
        progress,
        easedProgress,
      );
    }

    const shaderPropKeys = anim.shaderPropKeys;
    if (shaderPropKeys !== null && anim.node.shader !== null) {
      // No update flag is raised here: `shader.props` is the defineProperty
      // facade, whose setter already raises RecalcUniforms on the owning node
      // (or requests a render when the shader has no updater).
      this.writeValues(
        anim.node.shader.props as unknown as Record<string, number>,
        shaderPropKeys,
        anim.shaderPropList!,
        progress,
        easedProgress,
      );
    }
  }

  /**
   * Interpolate one flattened prop set onto `target`.
   *
   * @remarks
   * `progress` is loop-invariant, so the two endpoint cases are resolved once
   * outside the loop rather than re-tested per key. They snap to the exact
   * `start` / `target` values instead of trusting the easing to land on 0 and
   * 1, which is why they cannot be folded into the interpolation below.
   *
   * `keys` and `values` are index-aligned (see `createAnimation`).
   */
  private writeValues(
    target: Record<string, number>,
    keys: string[],
    values: PropValues[],
    progress: number,
    easedProgress: number,
  ) {
    const len = keys.length;

    if (progress === 1) {
      for (let i = 0; i < len; i++) {
        target[keys[i]!] = values[i]!.target;
      }
      return;
    }

    if (progress === 0) {
      for (let i = 0; i < len; i++) {
        target[keys[i]!] = values[i]!.start;
      }
      return;
    }

    for (let i = 0; i < len; i++) {
      const value = values[i]!;
      const start = value.start;
      if (value.isColor === true) {
        target[keys[i]!] = mergeColorProgress(
          start,
          value.target,
          easedProgress,
        );
      } else {
        target[keys[i]!] = start + (value.target - start) * easedProgress;
      }
    }
  }

  private reverseValues(anim: AnimationConfig) {
    if (anim.props) {
      for (const key in anim.props) {
        const v = anim.props[key]!;
        const t = v.start;
        v.start = v.target;
        v.target = t;
      }
    }
    if (anim.shaderProps) {
      for (const key in anim.shaderProps) {
        const v = anim.shaderProps[key]!;
        const t = v.start;
        v.start = v.target;
        v.target = t;
      }
    }
    if (!anim.loop) {
      anim.stopMethod = false;
    }
  }
}
