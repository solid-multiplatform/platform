import type { AnimationControllerState, AnimationSettings, IAnimationController } from '../../common/types.js';
import type { NodeStore } from '../nodes/NodeStore.js';
import type { AnimationManager } from './AnimationManager.js';
/**
 * What `animate` takes: a number per node prop, and under `shaderProps` a
 * value per shader prop (a number interpolates; anything else, such as a
 * radius array, is written when the run ends).
 */
export type AnimateProps = Record<string, number | Record<string, unknown>>;
/** The shape of a node an animation needs; `Node` satisfies it. */
export interface AnimatedNode {
    id: number;
    readonly renderer: {
        readonly nodes: NodeStore;
    };
    shader: object | null;
}
/**
 * One animation: the controller object plus its tracks. Tracks are parallel
 * arrays so `step` allocates nothing, four of them (`starts`, `targets`,
 * `ints` and `refs`) so that starting an animation allocates little. A
 * "fast" track writes the prop's slot
 * in a store buffer (`id * stride + field`) and marks dirty bits; a "setter" track writes `object[key]` through a
 * setter (zIndex, text w/h); a shaderProps track writes through the
 * accessors of the node's current shader.
 */
export declare class Animation implements IAnimationController {
    state: AnimationControllerState;
    progress: number;
    duration: number;
    readonly delay: number;
    delayFor: number;
    loop: boolean;
    readonly repeat: number;
    readonly repeatDelay: number;
    /** `repeatsLeft` is reset to this by `stop()`; see the constructor. */
    private readonly repeatsTotal;
    repeatsLeft: number;
    stopMethod: 'reverse' | false;
    /**
     * Whether this animation was constructed with `stopMethod: 'reverse'`.
     * `stopMethod` itself is mutated during a run (cleared after a one-shot
     * reverse, see `reverse()`), so a repeat that should play forward-then-back
     * again needs the original intent preserved separately.
     */
    private readonly reverses;
    /**
     * Whether `starts`/`targets` are currently swapped relative to their
     * construction-time orientation (toggled by `reverse()`). `stop()` uses
     * this to always leave a stopped animation resting in its original,
     * forward orientation.
     */
    private reversed;
    /** A custom easing function; null for a built-in easing (a name). */
    private readonly timing;
    /**
     * How `ease` evaluates the easing (EASE_*, common/easing.ts): a built-in
     * one in place, a custom TimingFunction through `timing`.
     */
    private easeKind;
    /** A cubic bezier's coefficients, x(t) and y(t) (`EasingCurve`). */
    private xa;
    private xb;
    private xc;
    private ya;
    private yb;
    private yc;
    /**
     * The eased progress the next `write` applies. `ease` writes it and
     * `write` reads it, and `progress`, from the instance: a double passed to
     * or returned from a call V8 does not inline is boxed, a heap number per
     * animation per frame each.
     */
    private eased;
    lastRunTime: number;
    /** Position in the manager's active list, -1 when inactive. */
    index: number;
    /**
     * The manager's frame counter as of this animation's last `step()` this
     * frame, -1 when never stepped. Lets the manager's loop skip an animation
     * a re-entrant unregister already moved into an index it has not visited
     * yet this frame, so it is never stepped twice in one frame.
     */
    stepFrame: number;
    /**
     * The next step is the run's first: `start()` (from stopped or paused)
     * or `retarget()` armed it, and `step` limits it to one frame.
     */
    private firstStep;
    readonly manager: AnimationManager;
    readonly node: AnimatedNode;
    readonly count: number;
    private readonly starts;
    private readonly targets;
    /**
     * TRACK entries per track (T_*). Uint16, not Int32: eight tracks' entries
     * fit in 64 bytes, as their `starts` and `targets` do, V8's limit for a
     * typed array kept on its heap; a larger one is allocated off the heap,
     * at about six times the cost.
     */
    private readonly ints;
    /** TRACK entries per track (R_*). */
    private readonly refs;
    /** `NodeStore.generation` when the arrays were last bound; see `rebind`. */
    private gen;
    /**
     * Per track: 0, or SHADER_TRACK or RAW_TRACK for a shaderProps track; null
     * without one. A shaderProps track writes into the node's shader as of
     * the write, not the one it had when the animation was made (1.10 read
     * `node.shader` every frame): a shader replaced mid-run is animated in
     * its place, and a node without one skips the write.
     */
    private readonly shaderTracks;
    /**
     * A RAW_TRACK's target is not a number (a radius array, a string) and
     * cannot be interpolated: the track writes its raw target when the run
     * ends and its raw start at progress 0 (restore()), nothing in between
     * (1.10 wrote NaN in between). Null without such a track.
     */
    private rawStarts;
    private rawTargets;
    /**
     * Null while stopped; from `start()` until `stop()`, `noWaiter` or the
     * resolve of the run's promise. The promise is made at the run's first
     * `waitUntilStopped()` call, not at `start()`: most runs have no waiter.
     */
    private stoppedResolve;
    private stoppedPromise;
    constructor(manager: AnimationManager, node: AnimatedNode, props: AnimateProps, settings: Partial<AnimationSettings>);
    /**
     * A built-in easing by name, for `ease` to evaluate in place: its kind
     * and a cubic bezier's coefficients, resolved as getTimingFunction
     * resolves them (common/easing.ts: a built-in name from its table, a
     * cubic-bezier string from a bounded cache, parsed on a miss). A name
     * that resolves to nothing (warned there) eases linearly, as
     * getTimingFunction falls back.
     */
    private setBuiltInEasing;
    private fillTrack;
    /**
     * The shaderProps tracks `sp`, from index `i`, starting from `current`
     * (the node's shader props as the animation is made); returns the next
     * index. A number interpolates, as a colour when the prop's name holds
     * `color` (1.10) or its type declares it one (`colorProps`).
     */
    private fillShaderTracks;
    /**
     * A shaderProps track whose target is not a number. An array start is
     * copied: it is the shader's own array, which an alias write such as
     * `top-left` changes in place.
     */
    private setRawTrack;
    /** `target` is null for a shaderProps track (see `shaderTracks`). */
    private setSetterTrack;
    start(): Animation;
    stop(): Animation;
    pause(): Animation;
    restore(): Animation;
    waitUntilStopped(): Promise<void>;
    /**
     * Re-read every fast track's array from the store by name, when the store
     * has grown (and replaced every typed array) since the last bind. Setter
     * tracks have no array to rebind (a null R_NAME). Called at the start of
     * `write` and `retarget`, the only places that touch the arrays.
     */
    private rebind;
    /** Re-read every track's start from the current value and set a new target. */
    retarget(target: number): void;
    /** Advance by `dt` ms. Called by the manager. */
    step(dt: number): void;
    /**
     * `eased` from `progress`, for every easing but linear (`step` applies
     * it): a built-in easing in place, its doubles in locals and fields; a
     * custom TimingFunction through its call, which boxes the progress it
     * takes and the value it returns unless V8 inlines it (an app's own
     * function).
     */
    private ease;
    /** Apply `progress` and `eased` to every track. */
    private write;
    private reverse;
}
