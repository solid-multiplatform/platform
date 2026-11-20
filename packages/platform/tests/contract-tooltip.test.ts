// Tooltip show/dismiss rules: a hover waits for the delay, keyboard focus
// shows at once, leaving hides, and Escape dismisses. The delay is one
// one-shot timer; once it has fired nothing is scheduled while the tooltip
// is visible (Apple HIG: offering help, tooltips; pointing devices).
import * as v from 'vitest';
import { createRoot } from 'solid-js';
import { createTooltip } from '../src/primitives/Tooltip.jsx';

v.describe('createTooltip', () => {
  v.beforeEach(() => v.vi.useFakeTimers());
  v.afterEach(() => v.vi.useRealTimers());

  v.it('waits for hover, shows at once on focus, hides and dismisses', () => {
    createRoot((dispose) => {
      const tip = createTooltip({ delay: 400 });
      v.expect(tip.visible()).toBe(false);

      tip.trigger.onPointerEnter();
      v.expect(tip.visible()).toBe(false);
      v.vi.advanceTimersByTime(399);
      v.expect(tip.visible()).toBe(false);
      v.vi.advanceTimersByTime(1);
      v.expect(tip.visible()).toBe(true);
      // The delay is a single timer: nothing is left while it is visible.
      v.expect(v.vi.getTimerCount()).toBe(0);

      tip.trigger.onPointerLeave();
      v.expect(tip.visible()).toBe(false);

      // Keyboard focus does not wait.
      tip.trigger.onFocus();
      v.expect(tip.visible()).toBe(true);
      v.expect(tip.trigger.onKeyPress({ key: 'Escape' })).toBe(true);
      v.expect(tip.visible()).toBe(false);
      // Any other key is not the tooltip's.
      v.expect(tip.trigger.onKeyPress({ key: 'a' })).toBe(false);

      // Leaving before the delay cancels the pending show.
      tip.trigger.onPointerEnter();
      tip.trigger.onPointerLeave();
      v.vi.advanceTimersByTime(1000);
      v.expect(tip.visible()).toBe(false);
      v.expect(v.vi.getTimerCount()).toBe(0);
      dispose();
    });
  });
});
