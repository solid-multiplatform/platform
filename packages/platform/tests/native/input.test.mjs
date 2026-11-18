import test from 'node:test';
import assert from 'node:assert/strict';
import { androidKey, createInputController } from '../../hosts/android-tv/input.mjs';

function fakeBridge() {
  const held = new Set(), events = [];
  return { events, isDown: k => held.has(k), down(k) { held.add(k); events.push(['down', k]); return false; }, up(k) { held.delete(k); events.push(['up', k]); }, tap(k) { events.push(['tap', k]); return false; }, releaseAll() { held.clear(); events.push(['release']); } };
}
test('maps TV keys and leaves system keys untouched', () => {
  assert.equal(androidKey(23), 'Enter'); assert.equal(androidKey(19), 'ArrowUp');
  assert.equal(androidKey(85), 'MediaPlayPause'); assert.equal(androidKey(3), undefined);
  assert.equal(androidKey(4), undefined);
});
test('suppresses Android repeat and balances release', () => {
  const b = fakeBridge(), c = createInputController(b);
  assert.equal(c.key(0, 22), true); assert.equal(c.key(0, 22, 1), true);
  assert.equal(c.key(1, 22), true);
  assert.deepEqual(b.events, [['down', 'ArrowRight'], ['up', 'ArrowRight']]);
});
test('Back consumption and suspension clear held keys', () => {
  const b = fakeBridge(), c = createInputController(b);
  assert.equal(c.back(), true); c.key(0, 19); c.release();
  assert.equal(b.isDown('ArrowUp'), false); assert.equal(c.key(1, 19), false);
});
test('a held media button produces one tap instead of repeat toggles', () => {
  const b = fakeBridge(), c = createInputController(b);
  c.key(0, 85); c.key(0, 85, 1); c.key(1, 85);
  assert.deepEqual(b.events, [['tap', 'MediaPlayPause'], ['up', 'MediaPlayPause']]);
});
