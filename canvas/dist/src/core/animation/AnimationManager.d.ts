import type { Animation } from './Animation.js';
/**
 * Active animations in a dense array with O(1) swap-remove. `step(dt)` is
 * called once per frame by the loop with the frame delta in ms.
 */
export declare class AnimationManager {
    readonly active: Animation[];
    /** Frame clock in ms, written by the loop before `step`. */
    now: number;
    /**
     * The most a run's first step advances, in ms (`Animation.step`): one
     * frame at the loop's pace, written by the loop before `step` (the cap's
     * period, or one 60 fps frame uncapped). Unlimited for a manager stepped
     * by hand.
     */
    maxFirstStep: number;
    /**
     * The current time for `adaptiveDuration`, in the same ms as `now`. `now`
     * stands still while the loop sleeps, so a press, an idle pause and a
     * second press would measure no time between the presses; the Renderer
     * points this at `platform.now()`. The headless default reads `now`.
     */
    clock: () => number;
    /**
     * Called whenever an animation is newly added to the active list (mirrors
     * `NodeStore.onDirty`). Reaches `RendererCore.requestRender()`, which
     * calls the frame-request funnel (`onFrameRequest()`); `requestRender()`
     * is idempotent, so unlike `onDirty` this fires on every register(), not
     * just the empty-to-nonempty transition.
     */
    onActive: (() => void) | null;
    /**
     * Bumped at the start of every `step()`. Paired with `Animation.stepFrame`
     * so a re-entrant unregister mid-loop (a setter track's write stopping
     * other animations) can move an animation into an index this loop has
     * not visited yet without stepping it a second time this frame.
     */
    private frame;
    get hasActive(): boolean;
    register(a: Animation): void;
    unregister(a: Animation): void;
    step(dt: number): void;
}
