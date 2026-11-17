import type { Animation } from './Animation.js';
import { NULL } from '../nodes/NodeFlags.js';

/**
 * Active animations in a dense array with O(1) swap-remove. `step(dt)` is
 * called once per frame by the loop with the frame delta in ms.
 */
export class AnimationManager {
  readonly active: Animation[] = [];
  /** Frame clock in ms, written by the loop before `step`. */
  now = 0;
  /**
   * The most a run's first step advances, in ms (`Animation.step`): one
   * frame at the loop's pace, written by the loop before `step` (the cap's
   * period, or one 60 fps frame uncapped). Unlimited for a manager stepped
   * by hand.
   */
  maxFirstStep = Infinity;
  /**
   * The current time for `adaptiveDuration`, in the same ms as `now`. `now`
   * stands still while the loop sleeps, so a press, an idle pause and a
   * second press would measure no time between the presses; the Renderer
   * points this at `platform.now()`. The headless default reads `now`.
   */
  clock: () => number = () => this.now;
  /**
   * Called whenever an animation is newly added to the active list (mirrors
   * `NodeStore.onDirty`). Reaches `RendererCore.requestRender()`, which
   * calls the frame-request funnel (`onFrameRequest()`); `requestRender()`
   * is idempotent, so unlike `onDirty` this fires on every register(), not
   * just the empty-to-nonempty transition.
   */
  onActive: (() => void) | null = null;
  /**
   * Bumped at the start of every `step()`. Paired with `Animation.stepFrame`
   * so a re-entrant unregister mid-loop (a setter track's write stopping
   * other animations) can move an animation into an index this loop has
   * not visited yet without stepping it a second time this frame.
   */
  private frame = 0;

  get hasActive(): boolean {
    return this.active.length > 0;
  }

  register(a: Animation): void {
    if (a.index !== -1) {
      return;
    }
    a.index = this.active.length;
    this.active.push(a);
    if (this.onActive !== null) {
      this.onActive();
    }
  }

  unregister(a: Animation): void {
    const i = a.index;
    if (i === -1) {
      return;
    }
    const active = this.active;
    const last = active.pop()!;
    if (last !== a) {
      active[i] = last;
      last.index = i;
    }
    a.index = -1;
  }

  step(dt: number): void {
    this.frame++;
    const frame = this.frame;
    const active = this.active;
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i];
      // A re-entrant unregister (e.g. a user setter triggered from this
      // frame's own writes) can swap-remove entries and shrink `active`
      // while this loop is still walking its original, longer length.
      if (a === undefined) {
        continue;
      }
      if (a.node.id === NULL) {
        a.stop();
        continue;
      }
      // The same swap-remove can instead move an animation into an index
      // this loop has not reached yet, stepping it twice in one frame;
      // stepFrame makes the second visit a no-op.
      if (a.stepFrame === frame) {
        continue;
      }
      a.stepFrame = frame;
      a.step(dt);
    }
  }
}
