import test from 'node:test';
import assert from 'node:assert/strict';
import { tvBackingScale } from '../../hosts/android-tv/scale.mjs';
test('TV framebuffer matches measured presentation pixels independent of Android density', () => {
  assert.equal(tvBackingScale(1920, 1080), 1);
  assert.equal(tvBackingScale(3840, 2160), 2);
  assert.equal(tvBackingScale(1280, 720, 1920, 1080, 2 / 3), 1);
  assert.equal(tvBackingScale(0, 0), 1);
});
