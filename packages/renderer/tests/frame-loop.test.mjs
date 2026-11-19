// The uncapped WebGL frame loop's arming and disarming: one animation frame
// while a frame is needed, none once the scene is idle, and the display's
// frame period as the wake frame's nominal step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameLoop } from '../dist/webgl/src/core/loop.js';

const NOMINAL_60 = 100 / 6;

/** A platform with a controllable animation-frame queue and timers. */
class FakePlatform {
  raf = [];
  timers = [];
  nextId = 1;
  clock = 0;
  requestAnimationFrame(callback) {
    const id = this.nextId++;
    this.raf.push({ id, callback });
    return id;
  }
  cancelAnimationFrame(id) {
    this.raf = this.raf.filter((entry) => entry.id !== id);
  }
  setTimeout(callback, ms) {
    this.timers.push({ callback, ms });
    return this.timers.length;
  }
  now() {
    return this.clock;
  }
  hidden() {
    return false;
  }
  runNext(time) {
    const entry = this.raf.shift();
    assert.ok(entry, 'an animation frame was requested');
    entry.callback(time);
  }
  runTimers() {
    const timers = this.timers;
    this.timers = [];
    for (const timer of timers) timer.callback();
  }
}

function scene({ needs = true, stayNeeds = false } = {}) {
  const frames = [];
  const state = { needs, idle: 0, paused: 0, maintenance: 0 };
  const host = {
    needsFrame: () => state.needs,
    animating: () => false,
    frame(time, dt, nominal) {
      frames.push({ time, dt, nominal });
      // The scene drew everything it had: nothing else asks for a frame.
      state.needs = stayNeeds;
    },
    idle: () => state.idle++,
    paused: () => state.paused++,
    maintain: () => state.maintenance++,
    error: (error) => {
      throw error;
    },
  };
  const platform = new FakePlatform();
  const loop = new FrameLoop(platform, host);
  loop.wakeFallbackDelay = 0;
  return { platform, loop, host, frames, state };
}

test('a frame request arms one animation frame', () => {
  const { platform, loop } = scene();
  loop.schedule();
  assert.equal(platform.raf.length, 1);
  loop.schedule();
  assert.equal(platform.raf.length, 1, 'a pending frame is not requested twice');
});

test('an idle scene schedules nothing: no frame, no timer', () => {
  const { platform, loop, frames, state } = scene();
  loop.schedule();
  platform.runNext(0);
  assert.equal(frames.length, 1);
  assert.equal(state.idle, 1);
  assert.equal(platform.raf.length, 0, 'no animation frame while idle');
  // One maintenance timer runs once after the idle transition, then nothing.
  assert.equal(platform.timers.length, 1);
  assert.equal(platform.timers[0].ms, 0);
  platform.runTimers();
  assert.equal(state.maintenance, 1);
  assert.equal(platform.raf.length, 0, 'still no animation frame');
  assert.equal(platform.timers.length, 0, 'still no timer');
});

test('a wake after idle arms exactly one frame and one fallback timer', () => {
  const { platform, loop, state } = scene();
  loop.wakeFallbackDelay = 50;
  loop.schedule();
  platform.runNext(0);
  assert.equal(state.idle, 1);
  platform.timers = [];
  state.needs = true;
  loop.schedule();
  assert.equal(platform.raf.length, 1);
  assert.equal(platform.timers.length, 1);
  assert.equal(platform.timers[0].ms, 50);
});

test('the wake frame steps by the display frame period, not 60 fps', () => {
  const { platform, loop, frames } = scene();
  loop.nominalFrameTime = 1000 / 120;
  loop.schedule();
  platform.runNext(0);
  assert.equal(frames[0].nominal, 1000 / 120);
  assert.equal(frames[0].dt, 1000 / 120);
});

test('the default nominal step is one 60 fps frame', () => {
  const { platform, loop, frames } = scene();
  loop.schedule();
  platform.runNext(0);
  assert.equal(frames[0].nominal, NOMINAL_60);
  assert.equal(frames[0].dt, NOMINAL_60);
});

test('a later frame steps by the measured delta', () => {
  const { platform, loop, frames } = scene({ stayNeeds: true });
  loop.schedule();
  platform.runNext(100);
  platform.runNext(108.33);
  assert.equal(Math.round(frames[1].dt * 100) / 100, 8.33);
});

test('a capped loop waits for the cap instead of drawing on the next vsync', () => {
  const { platform, loop, frames } = scene();
  loop.targetFrameTime = 1000 / 30;
  loop.schedule();
  platform.runNext(0);
  assert.equal(frames.length, 0, 'too early for the cap');
  assert.equal(platform.timers.length, 1, 'a timer asks again near the deadline');
  assert.equal(platform.raf.length, 0);
});

test('stop() cancels the pending frame and schedules nothing more', () => {
  const { platform, loop } = scene();
  loop.schedule();
  loop.stop();
  assert.equal(platform.raf.length, 0);
  loop.schedule();
  assert.equal(platform.raf.length, 0);
});
