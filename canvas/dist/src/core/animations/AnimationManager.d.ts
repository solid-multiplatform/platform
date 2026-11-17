import type { CoreNode } from '../CoreNode.js';
import type { IAnimationController, AnimationControllerState } from '../../common/IAnimationController.js';
import { type TimingFunction } from '../utils.js';
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
    propKeys: string[] | null;
    propList: PropValues[] | null;
    shaderPropKeys: string[] | null;
    shaderPropList: PropValues[] | null;
    stoppedResolve: (() => void) | null;
    stoppedPromise: Promise<void> | null;
}
export declare class AnimationManager {
    activeAnimations: AnimationConfig[];
    registerAnimation(animation: AnimationConfig): void;
    unregisterAnimation(animation: AnimationConfig): void;
    update(dt: number): void;
    private applyValues;
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
    private writeValues;
    private reverseValues;
}
