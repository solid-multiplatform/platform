/**
 * Physics tests for the iOS-model scroller, run on a virtual clock:
 *
 *   node --test src/scroller.test.ts
 *
 * They check the researched constants themselves: the release-velocity
 * blends, the exponential decay's total distance against
 * `v * rate / (1 - rate)`, the rubber-band formula, the snap target
 * selection, the bounce return, and the idle rule (no frames at rest).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createScroller, type Scroller } from './scroller.ts';

/** A deterministic clock: `advance` runs every scheduled frame at dt. */
class Clock {
  t = 0;
  private nextId = 1;
  private frames = new Map<number, (now: number) => void>();
  scheduled = 0;

  now = () => this.t;

  schedule = (step: (now: number) => void) => {
    const id = this.nextId++;
    this.frames.set(id, step);
    this.scheduled++;
    return id;
  };

  unschedule = (id: number) => {
    this.frames.delete(id);
  };

  pending() {
    return this.frames.size;
  }

  /** Runs frames until `ms` have passed; returns the frames run. */
  advance(ms: number, dt = 16.667) {
    const end = this.t + ms;
    let run = 0;
    while (this.t < end) {
      this.t = Math.min(end, this.t + dt);
      const due = [...this.frames.values()];
      this.frames.clear();
      if (due.length === 0) break;
      for (const step of due) {
        step(this.t);
        run++;
      }
    }
    return run;
  }
}

interface Rig {
  clock: Clock;
  scroller: Scroller;
}

/** A scroller laid out as `content` x `visible`, on a fresh clock. */
function rig(
  options: { content?: number; visible?: number; snap?: number } = {},
): Rig {
  const clock = new Clock();
  const scroller = createScroller({
    axis: 'y',
    now: clock.now,
    schedule: clock.schedule,
    unschedule: clock.unschedule,
    snap: options.snap,
  });
  scroller.layout(options.content ?? 10000, options.visible ?? 500);
  return { clock, scroller };
}

/**
 * Drags the pointer by `deltas`, one move every `dt` ms, then releases.
 * A negative delta moves the finger up, so the offset grows.
 */
function drag(
  { clock, scroller }: Rig,
  deltas: number[],
  dt = 16,
  startAt = 1000,
): void {
  scroller.dragAxis('start', startAt);
  let p = startAt;
  for (const delta of deltas) {
    p += delta;
    clock.t += dt;
    scroller.dragAxis('move', p);
  }
  scroller.dragAxis('end', p);
}

test('release velocity blends the last samples like UIPanGestureRecognizer', () => {
  // Constant 1 px/ms: every blend is 1, so the release velocity is 1.
  const a = rig();
  drag(a, [-16, -16, -16, -16]);
  // 64 px of drag, then 1 px/ms travels v*rate/(1-rate) = 499 px more.
  a.clock.advance(4000);
  assert.ok(
    Math.abs(a.scroller.offset() - (64 + 499)) < 12,
    `constant 1px/ms travels ~499px past the drag, got ${a.scroller.offset()}`,
  );

  // Variable per-sample velocities 0.5, 1, 2: the recognizer blends are
  // b1=0.5, b2=0.2*1+0.8*0.5=0.6, b3=0.2*2+0.8*1=1.2; the release low-pass
  // is 0.75*0.6 + 0.25*1.2 = 0.75.
  const b = rig();
  b.scroller.dragAxis('start', 1000);
  let p = 1000;
  for (const delta of [-8, -16, -32]) {
    p += delta;
    b.clock.t += 16;
    b.scroller.dragAxis('move', p);
  }
  b.scroller.dragAxis('end', p);
  // 56 px of drag, then 0.75 px/ms travels ~374px more.
  b.clock.advance(4000);
  assert.ok(
    Math.abs(b.scroller.offset() - (56 + 374.25)) < 12,
    `blended 0.75px/ms travels ~374px past the drag, got ${b.scroller.offset()}`,
  );
});

test('a drag that stops before release has no fling', () => {
  const r = rig();
  r.scroller.dragAxis('start', 1000);
  let p = 1000;
  for (let i = 0; i < 6; i++) {
    p -= 32; // 2 px/ms...
    r.clock.t += 16;
    r.scroller.dragAxis('move', p);
  }
  const stopped = p;
  // ...then the finger sits still for 150 ms before lifting.
  for (let i = 0; i < 10; i++) {
    r.clock.t += 15;
    r.scroller.dragAxis('move', p);
  }
  r.scroller.dragAxis('end', p);
  assert.equal(r.clock.pending(), 0, 'no frames scheduled');
  assert.equal(r.scroller.settled(), true);
  assert.equal(
    r.scroller.offset(),
    6 * 32,
    'offset stays where the finger stopped',
  );
  assert.equal(stopped, p);
});

test('decay distance matches v * rate / (1 - rate)', () => {
  const r = rig();
  drag(r, [-32, -32, -32, -32]); // 2 px/ms
  r.clock.advance(4000);
  const expected = 128 + (2 * 0.998) / (1 - 0.998); // drag, then decay
  assert.ok(
    Math.abs(r.scroller.offset() - expected) < 25,
    `2px/ms should travel ${expected}, got ${r.scroller.offset()}`,
  );
  assert.equal(r.scroller.settled(), true);
});

test('a slow release below 0.25 px/ms does not decelerate', () => {
  const r = rig();
  drag(r, [-3, -3, -3]); // 3px per 16ms = 0.1875 px/ms
  assert.equal(r.clock.pending(), 0);
  assert.equal(r.scroller.offset(), 9);
  assert.equal(r.scroller.settled(), true);
});

test('rubber band follows (1 - 1/(x*c/d + 1)) * d with c = 0.55', () => {
  const bottom = rig({ content: 1500, visible: 500 });
  bottom.scroller.to(1000, 0); // max() = 1000
  const rubber = (over: number) =>
    1000 + 500 * (1 - 1 / ((over * 0.55) / 500 + 1));
  bottom.scroller.dragAxis('start', 1000);
  let p = 1000;
  for (let i = 0; i < 10; i++) {
    p -= 20;
    bottom.scroller.dragAxis('move', p);
  }
  // The finger is 200 px past the bottom edge: raw = 1200.
  assert.ok(
    Math.abs(bottom.scroller.offset() - rubber(200)) < 0.01,
    `bottom rubber band, got ${bottom.scroller.offset()}`,
  );

  const top = rig({ content: 1500, visible: 500 });
  top.scroller.to(1000, 0);
  top.scroller.dragAxis('start', 1000);
  let q = 1000;
  for (let i = 0; i < 70; i++) {
    q += 20;
    top.scroller.dragAxis('move', q);
  }
  // The finger is 400 px above the top edge: raw = -400.
  const expectedTop = -500 * (1 - 1 / ((400 * 0.55) / 500 + 1));
  assert.ok(
    Math.abs(top.scroller.offset() - expectedTop) < 0.01,
    `top rubber band, got ${top.scroller.offset()}`,
  );
});

test('release from overscroll bounces back to the edge', () => {
  const r = rig({ content: 1500, visible: 500 });
  r.scroller.to(1000, 0);
  r.scroller.dragAxis('start', 1000);
  let p = 1000;
  for (let i = 0; i < 5; i++) {
    p -= 24;
    r.clock.t += 16;
    r.scroller.dragAxis('move', p);
  }
  for (let i = 0; i < 12; i++) {
    r.clock.t += 16;
    r.scroller.dragAxis('move', p); // the finger holds, so the velocity dies
  }
  r.scroller.dragAxis('end', p);
  assert.ok(r.scroller.offset() > 1000, 'still overscrolled at release');
  const frames = r.clock.advance(3000);
  assert.ok(frames > 10, `the bounce takes real time, got ${frames} frames`);
  assert.ok(
    Math.abs(r.scroller.offset() - 1000) < 1,
    `bounces back to the edge, got ${r.scroller.offset()}`,
  );
  assert.equal(r.clock.pending(), 0);
});

test('a fling into the edge bounces off it and stops at the bound', () => {
  const r = rig({ content: 1500, visible: 500 });
  // From the top, 2 px/ms toward the top edge: it crosses, bounces, settles.
  drag(r, [32, 32, 32, 32], 16, 0);
  const frames = r.clock.advance(3000);
  assert.ok(frames > 30, `the bounce takes real time, got ${frames} frames`);
  assert.ok(
    Math.abs(r.scroller.offset()) < 1,
    `settles at the top bound, got ${r.scroller.offset()}`,
  );
  assert.equal(r.clock.pending(), 0);
});

test('a snap fling lands exactly on the nearest slot to its projection', () => {
  const r = rig({ content: 2508, visible: 500, snap: 210 });
  // 2 px/ms from 0: projected landing 998 -> nearest slot 5*210 = 1050.
  drag(r, [-32, -32, -32, -32], 16, 500);
  r.clock.advance(4000);
  assert.ok(
    Math.abs(r.scroller.offset() - 1050) < 0.5,
    `lands on slot 1050, got ${r.scroller.offset()}`,
  );
  assert.equal(r.scroller.settled(), true);
  assert.equal(r.clock.pending(), 0);
});

test('the snap target can be the content end', () => {
  const r = rig({ content: 2508, visible: 500, snap: 210 });
  r.scroller.to(1890, 0);
  // From 1890, 2 px/ms projects to 2888, clamped past the end: the end
  // (2008) is nearer than the last slot (1890).
  drag(r, [-32, -32, -32, -32], 16, 500);
  r.clock.advance(4000);
  assert.ok(
    Math.abs(r.scroller.offset() - 2008) < 0.5,
    `the content end is a snap target, got ${r.scroller.offset()}`,
  );
});

test('a slow release settles into the nearest slot', () => {
  const r = rig({ content: 2508, visible: 500, snap: 210 });
  r.scroller.to(400, 0);
  // 0.1875 px/ms: below the fling threshold; the glide takes it to 420.
  drag(r, [-3, -3, -3], 16, 600);
  r.clock.advance(2000);
  assert.ok(
    Math.abs(r.scroller.offset() - 420) < 0.5,
    `settles into slot 420, got ${r.scroller.offset()}`,
  );
  assert.equal(r.scroller.settled(), true);
});

test('no frames are scheduled at rest', () => {
  const r = rig();
  drag(r, [-32, -32, -32, -32]);
  r.clock.advance(5000);
  assert.equal(r.clock.pending(), 0);
  assert.equal(r.scroller.settled(), true);
  const before = r.clock.scheduled;
  r.clock.advance(2000);
  assert.equal(r.clock.scheduled, before, 'an idle scroller schedules nothing');
});

test('layout keeps the chat pinned to the bottom', () => {
  const r = rig({ content: 5000, visible: 500 });
  r.scroller.to(4500, 0);
  r.scroller.layout(5200, 500, 'bottom');
  assert.equal(r.scroller.offset(), 4700);
  r.scroller.layout(5200, 500);
  assert.equal(r.scroller.offset(), 4700, 'an interior offset is kept');
});
