import * as v from 'vitest';
import { scrollAxis, dragToScroll, wheelToScroll } from '../src/sdk/scroll.js';

v.describe('dragToScroll', () => {
  v.it('follows a pointer drag on the vertical axis', () => {
    const scroll = scrollAxis();
    scroll.layout(1000, 200);
    const drag = dragToScroll(scroll);
    drag('start', { x: 0, y: 500 }, { x: 0, y: 500 });
    drag('move', { x: 0, y: 460 }, { x: 0, y: 500 });
    v.expect(scroll.offset()).toBe(40);
    drag('move', { x: 0, y: 420 }, { x: 0, y: 500 });
    v.expect(scroll.offset()).toBe(80);
    drag('end', { x: 0, y: 420 }, { x: 0, y: 500 });
    v.expect(scroll.offset()).toBe(80);
  });

  v.it('supports the horizontal axis, inversion and cancellation', () => {
    const scroll = scrollAxis();
    scroll.layout(1000, 200);
    const drag = dragToScroll(scroll, { axis: 'x', direction: -1 });
    drag('start', { x: 200, y: 0 }, { x: 200, y: 0 });
    drag('move', { x: 160, y: 0 }, { x: 200, y: 0 });
    // A rightward finger move scrolls back, as with `direction: -1`.
    v.expect(scroll.offset()).toBe(0);
    drag('move', { x: 180, y: 0 }, { x: 200, y: 0 });
    // The content follows the pointer: 180 -> 160 is +20.
    drag('cancel', { x: 0, y: 0 }, { x: 200, y: 0 });
    drag('move', { x: 140, y: 0 }, { x: 200, y: 0 });
    v.expect(scroll.offset()).toBe(0);
  });
});

v.describe('wheelToScroll', () => {
  v.it('maps wheel deltas to the chosen axis and clamps at the ends', () => {
    const scroll = scrollAxis();
    scroll.layout(600, 200);
    const wheel = wheelToScroll(scroll);
    wheel({ deltaX: 0, deltaY: 120 });
    v.expect(scroll.offset()).toBe(120);
    wheel({ deltaX: 0, deltaY: 400 });
    v.expect(scroll.offset()).toBe(400);

    const horizontalScroll = scrollAxis();
    horizontalScroll.layout(600, 200);
    const horizontal = wheelToScroll(horizontalScroll, { axis: 'x' });
    horizontal({ deltaX: 80, deltaY: 999 });
    v.expect(horizontalScroll.offset()).toBe(80);
  });
});
