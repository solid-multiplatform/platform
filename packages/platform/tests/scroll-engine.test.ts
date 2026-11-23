// The touch scroll engine: release velocity, exponential decay, the rubber
// band, snapping, axis locking, and the promise that a resting engine has no
// frame scheduled. A fake clock and frame scheduler make the physics exact.
import { describe, expect, test } from 'vitest';
import {
  AXIS_LOCK_SLOP,
  chooseDragAxis,
  createScrollEngine,
  flingDistance,
  lockDragAxis,
  rubberBandDistance,
  TOUCH_DECELERATION_RATE,
} from '../src/sdk/scroll.js';

function fakeClock() {
  let time = 0;
  let next = 1;
  let frames = new Map<number, () => void>();
  return {
    now: () => time,
    raf: (callback: () => void) => {
      const id = next++;
      frames.set(id, callback);
      return id;
    },
    cancelRaf: (id: number) => {
      frames.delete(id);
    },
    advance(ms: number) {
      time += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback();
    },
    pending: () => frames.size,
    time: () => time,
  };
}

function engineAt(clock: ReturnType<typeof fakeClock>, snap?: number) {
  return createScrollEngine({
    axis: 'x',
    snap,
    now: clock.now,
    raf: clock.raf,
    cancelRaf: clock.cancelRaf,
  });
}

function runToRest(clock: ReturnType<typeof fakeClock>) {
  let frames = 0;
  while (clock.pending() > 0 && frames++ < 1000) clock.advance(16);
  expect(frames, 'the engine never settled').toBeLessThan(1000);
  expect(clock.pending(), 'a settled engine scheduled a frame').toBe(0);
}

describe('scroll engine physics', () => {
  test('release velocity is the recognizer low-pass, not one raw sample', () => {
    const clock = fakeClock();
    const engine = engineAt(clock);
    engine.layout(10_000, 1_000);
    engine.dragAxis('start', 0);
    clock.advance(50);
    engine.dragAxis('move', -50);
    clock.advance(50);
    engine.dragAxis('move', -100);
    clock.advance(50);
    // The finger stops: the latest sample is 0, the previous blend is 1.
    engine.dragAxis('move', -100);
    // 0.75 * previous (1) + 0.25 * current (0.8) = 0.95.
    expect(engine.velocity()).toBeCloseTo(0.95, 2);
    engine.dragAxis('end', -100);
  });

  test('exponential decay travels about (|v| - 0.01) / |ln(rate)|', () => {
    const clock = fakeClock();
    const engine = engineAt(clock);
    engine.layout(10_000, 1_000);
    engine.dragAxis('start', 0);
    clock.advance(50);
    engine.dragAxis('move', -50);
    clock.advance(50);
    engine.dragAxis('move', -100);
    expect(engine.velocity()).toBeCloseTo(1, 1);

    engine.dragAxis('end', -100);
    runToRest(clock);

    // 100 dragged + (1 - 0.01) / |ln(0.998)| integrated down to the floor.
    expect(engine.offset()).toBeGreaterThan(580);
    expect(engine.offset()).toBeLessThan(605);
    expect(engine.settled()).toBe(true);
    expect(flingDistance(1)).toBeCloseTo(494.5, 0);
    expect(TOUCH_DECELERATION_RATE).toBe(0.998);
  });

  test('a drag past either edge stretches with the rubber band', () => {
    const clock = fakeClock();
    const engine = engineAt(clock);
    engine.layout(1_000, 200); // max 800
    expect(engine.max()).toBe(800);

    engine.dragAxis('start', 0);
    engine.dragAxis('move', 100);
    // f(100, 200, 0.55) = (100 * 200 * 0.55) / (200 + 55) = 43.14.
    expect(engine.offset()).toBeCloseTo(-rubberBandDistance(100, 200), 2);
    expect(engine.offset()).toBeGreaterThan(-100);

    engine.dragAxis('move', -900);
    expect(engine.offset()).toBeGreaterThan(800);
    expect(engine.offset()).toBeLessThan(900);

    engine.dragAxis('end', -900);
    runToRest(clock);
    expect(engine.offset()).toBe(800);
  });

  test('a rail release snaps to the nearest slot', () => {
    const clock = fakeClock();
    const engine = engineAt(clock, 120);
    engine.layout(5_000, 1_000); // max 4000

    engine.dragAxis('start', 0);
    clock.advance(100);
    engine.dragAxis('move', -130);
    // Held still: the low-pass decays to zero over the zero-move samples,
    // so the release is a slot settle, not a fling.
    for (let i = 0; i < 3; i++) {
      clock.advance(100);
      engine.dragAxis('move', -130);
    }
    expect(engine.velocity()).toBeCloseTo(0, 2);
    engine.dragAxis('end', -130);
    runToRest(clock);

    expect(engine.offset()).toBeCloseTo(120, 1);
    expect(engine.settled()).toBe(true);
  });

  test('a snap flight eases onto its slot without a landing teleport', () => {
    const clock = fakeClock();
    const engine = engineAt(clock, 200);
    engine.layout(10_000, 1_000); // max 9000

    // A weak fling, just above the release threshold, toward a slot 200
    // away: the flight crawls at the floor velocity for its last stretch,
    // which once landed as `distance * 0.01 / |v|` in a single frame.
    engine.dragAxis('start', 0);
    for (let i = 0; i < 6; i++) {
      clock.advance(16);
      engine.dragAxis('move', -4.2 * (i + 1));
    }
    expect(engine.velocity()).toBeGreaterThan(0.25);
    engine.dragAxis('end', -25.2);

    // Step to rest, watching the step sizes as the flight closes on the
    // slot. The glide-in covers the floor-crawl tail smoothly; the old
    // one-frame apply of the target jumped ~7.7 units here.
    let last = engine.offset();
    let landingStep = 0;
    let frames = 0;
    while (clock.pending() > 0 && frames++ < 4000) {
      clock.advance(16);
      const step = Math.abs(engine.offset() - last);
      if (Math.abs(engine.offset() - 200) < 40) {
        if (step > landingStep) landingStep = step;
      }
      last = engine.offset();
    }
    expect(engine.settled()).toBe(true);
    expect(engine.offset()).toBeCloseTo(200, 1);
    expect(landingStep).toBeLessThanOrEqual(2);
  });

  test('samples bursting in one instant do not throw the release velocity', () => {
    const clock = fakeClock();
    const engine = engineAt(clock);
    engine.layout(5_000, 500);

    engine.dragAxis('start', 100);
    clock.advance(16);
    engine.dragAxis('move', 98);
    clock.advance(16);
    engine.dragAxis('move', 96);
    // A host replaying coalesced history delivers real deltas a few
    // hundredths of a millisecond apart: dividing movement by that dt read
    // as tens of units per millisecond and multiplied the fling ~20x.
    clock.advance(0.05);
    engine.dragAxis('move', 94.5);
    clock.advance(0.05);
    engine.dragAxis('move', 93);
    clock.advance(16);
    engine.dragAxis('move', 91);
    engine.dragAxis('end', 91);

    // The honest samples say ~0.12 units/ms; the burst must not lift it.
    expect(engine.velocity()).toBeLessThan(0.5);
  });

  test('a settled engine schedules nothing', () => {
    const clock = fakeClock();
    const engine = engineAt(clock);
    engine.layout(1_000, 300);
    engine.dragAxis('start', 0);
    clock.advance(50);
    engine.dragAxis('move', -80);
    engine.dragAxis('end', -80);
    runToRest(clock);

    const settledAt = engine.offset();
    const before = clock.pending();
    clock.advance(2_000);
    expect(clock.pending()).toBe(before);
    expect(engine.offset()).toBe(settledAt);
  });
});

describe('nested gestures lock to one axis', () => {
  test('the dominant direction picks the axis', () => {
    expect(chooseDragAxis(20, 5)).toBe('x');
    expect(chooseDragAxis(5, 20)).toBe('y');
    expect(chooseDragAxis(AXIS_LOCK_SLOP, 0)).toBe('x');
    expect(chooseDragAxis(0, AXIS_LOCK_SLOP)).toBe('y');
    // Diagonal, outside the slop: horizontal wins the tie.
    expect(chooseDragAxis(8, 8)).toBe('x');
    // Below the slop the gesture has not locked yet.
    expect(chooseDragAxis(AXIS_LOCK_SLOP - 1, 0)).toBeUndefined();
    expect(chooseDragAxis(0, AXIS_LOCK_SLOP - 1)).toBeUndefined();
  });

  test('the innermost scroller on that axis wins; no match swallows', () => {
    // A horizontal rail inside a vertical page.
    expect(lockDragAxis(['x', 'y'], 40, 10)).toBe(0);
    expect(lockDragAxis(['x', 'y'], 10, 40)).toBe(1);
    // Same-axis nesting: the innermost scroller takes it (discouraged by the
    // HIG, but unambiguous).
    expect(lockDragAxis(['y', 'y'], 0, 40)).toBe(0);
    // A vertical drag with only a horizontal scroller: nothing moves.
    expect(lockDragAxis(['x'], 0, 40)).toBe(-1);
    // Nothing locks below the slop.
    expect(lockDragAxis(['x', 'y'], 4, 4)).toBe(-1);
    expect(lockDragAxis([], 40, 40)).toBe(-1);
  });
});
