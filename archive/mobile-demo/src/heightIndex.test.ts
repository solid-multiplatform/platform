/**
 * Geometry tests for the measured-height index:
 *
 *   node --test src/heightIndex.test.ts
 *
 * Append, update, prefix offset, total and offset-to-item lookup, including
 * exact boundaries, growth past the initial capacity, and a deterministic
 * cross-check against a naive array.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { HeightIndex } from './heightIndex.ts';

test('append, total and prefix offsets', () => {
  const index = new HeightIndex();
  index.append(10);
  index.append(25);
  index.append(5);
  assert.equal(index.length, 3);
  assert.equal(index.total(), 40);
  assert.equal(index.offsetOf(0), 0);
  assert.equal(index.offsetOf(1), 10);
  assert.equal(index.offsetOf(2), 35);
  assert.equal(index.offsetOf(3), 40);
  assert.equal(index.get(1), 25);
});

test('indexAt finds the item containing an offset, on both sides of a boundary', () => {
  const index = new HeightIndex([10, 25, 5, 60]);
  assert.equal(index.indexAt(-20), 0);
  assert.equal(index.indexAt(0), 0);
  assert.equal(index.indexAt(9.99), 0);
  assert.equal(index.indexAt(10), 1);
  assert.equal(index.indexAt(34.99), 1);
  assert.equal(index.indexAt(35), 2);
  assert.equal(index.indexAt(39.99), 2);
  assert.equal(index.indexAt(40), 3);
  assert.equal(index.indexAt(99), 3);
  assert.equal(index.indexAt(1000), 3);
});

test('set updates the total and every offset after it', () => {
  const index = new HeightIndex([10, 20, 30]);
  assert.equal(index.set(1, 50), true);
  assert.equal(index.total(), 90);
  assert.equal(index.offsetOf(2), 60);
  assert.equal(index.indexAt(9), 0);
  assert.equal(index.indexAt(59), 1);
  assert.equal(index.indexAt(60), 2);

  // The same value is a no-op, so a re-layout cannot churn the index.
  assert.equal(index.set(1, 50), false);
});

test('appending past the initial capacity keeps the tree valid', () => {
  const index = new HeightIndex();
  let expected = 0;
  for (let i = 0; i < 200; i++) {
    const height = 1 + (i % 17);
    index.append(height);
    expected += height;
  }
  assert.equal(index.length, 200);
  assert.equal(index.total(), expected);
  assert.equal(index.offsetOf(199), expected - (1 + (199 % 17)));
  assert.equal(index.indexAt(0), 0);
  assert.equal(index.indexAt(expected), 199);
});

test('a random walk matches a naive prefix sum', () => {
  let state = 0x5eed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const heights: number[] = [];
  const index = new HeightIndex();
  for (let i = 0; i < 257; i++) {
    const height = 20 + next() * 300;
    heights.push(height);
    index.append(height);
  }
  // A few updates exercise set() at every alignment.
  for (const at of [0, 1, 2, 63, 64, 65, 127, 255, 256]) {
    const height = 1 + next() * 500;
    heights[at] = height;
    assert.equal(index.set(at, height), true);
  }
  let total = 0;
  for (let i = 0; i < heights.length; i++) {
    assert.ok(Math.abs(index.offsetOf(i) - total) < 1e-6, `offset ${i}`);
    total += heights[i]!;
    const middle = total - heights[i]! / 2;
    assert.equal(index.indexAt(middle), i);
  }
  assert.ok(Math.abs(index.total() - total) < 1e-6);
});
