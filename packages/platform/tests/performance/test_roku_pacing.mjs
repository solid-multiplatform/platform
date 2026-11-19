// Unit tests for the Roku frame-pacing analyser. Synthetic samples only: this
// runs in CI without a device.
//
//   node --test tests/performance/test_roku_pacing.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePacing,
  PERIOD_MS,
  BUDGET_MS,
  WHAT_THIS_DOES_NOT_MEASURE,
} from './analyze-roku-pacing.mjs';

/** Timestamps at an exact 60 Hz cadence. */
function clean(count, period = PERIOD_MS) {
  return Array.from({ length: count }, (_, i) => i * period);
}

test('a clean 60 Hz series has no interval over budget', () => {
  const summary = analyzePacing({ case: 'clean', frames: clean(600) });
  assert.equal(summary.appFrames, 600);
  assert.equal(summary.intervals, 599);
  assert.equal(summary.overBudget, 0);
  assert.equal(summary.misses, 0);
  assert.equal(summary.missedFramesEstimate, 0);
  assert.equal(summary.proxyBudgetPass, true);
  assert.ok(Math.abs(summary.p50Ms - PERIOD_MS) < 0.02);
  assert.ok(summary.p95Ms <= BUDGET_MS);
});

test('the 1 ms tolerance admits a 17.5 ms interval and rejects 18 ms', () => {
  const admitted = analyzePacing({ frames: [0, 17.5] });
  assert.equal(admitted.overBudget, 0);
  assert.equal(admitted.misses, 0);
  const rejected = analyzePacing({ frames: [0, 18] });
  assert.equal(rejected.overBudget, 1);
  assert.equal(rejected.misses, 1);
});

test('N double-length gaps count as N missed frames', () => {
  // Five separate two-refresh intervals at an otherwise clean cadence.
  const frames = [];
  let t = 0;
  for (let i = 0; i < 100; i++) {
    frames.push(t);
    t += i % 20 === 10 ? PERIOD_MS * 2 : PERIOD_MS;
  }
  const summary = analyzePacing({ frames });
  assert.equal(summary.overBudget, 5);
  assert.equal(summary.missedFramesEstimate, 5);
  assert.equal(summary.intervals25To100ms, 5);
  assert.ok(Math.abs(summary.worstMs - PERIOD_MS * 2) < 0.02);
});

test('a 1000 ms JS block is one large gap, and outside-block stats isolate it', () => {
  const frames = [];
  // 300 frames at 60 Hz, then the block, then 300 more.
  for (let i = 0; i < 300; i++) frames.push(i * PERIOD_MS);
  const before = 299 * PERIOD_MS;
  const blockStart = before;
  const blockEnd = blockStart + 1000;
  for (let i = 0; i < 300; i++) frames.push(blockEnd + i * PERIOD_MS);
  const summary = analyzePacing({
    case: 'block',
    frames,
    blocks: [{ start: blockStart, end: blockEnd }],
  });
  assert.ok(Math.abs(summary.worstMs - 1000) < 0.02);
  // round(1000 / 16.6667) - 1 = 59 refresh periods with no JS frame callback.
  assert.equal(summary.missedFramesEstimate, 59);
  assert.equal(summary.deliberateBlocks[0].ms, 1000);
  assert.equal(summary.withoutDeliberateBlocks.overBudget, 0);
  assert.equal(summary.withoutDeliberateBlocks.missedFramesEstimate, 0);
  assert.equal(before, blockStart);
});

test('percentiles use the nearest rank', () => {
  const frames = [];
  // 99 intervals at 16.67 and one at 50: p95 is 16.67, p99 is 16.67, worst 50.
  for (let i = 0; i < 100; i++) frames.push(i * PERIOD_MS);
  frames.push(100 * PERIOD_MS + (50 - PERIOD_MS));
  const summary = analyzePacing({ frames });
  assert.ok(Math.abs(summary.p95Ms - PERIOD_MS) < 0.02);
  assert.ok(Math.abs(summary.p99Ms - PERIOD_MS) < 0.02);
  assert.ok(Math.abs(summary.worstMs - 50) < 0.02);
});

test('the summary states it is a proxy and what it does not measure', () => {
  const summary = analyzePacing({ frames: clean(60) });
  assert.equal(summary.proxy, true);
  assert.equal(summary.kind, 'roku-pacing-proxy');
  assert.equal(summary.whatThisDoesNotMeasure, WHAT_THIS_DOES_NOT_MEASURE);
  assert.match(summary.whatThisDoesNotMeasure, /GPU and compositor timing/);
});
