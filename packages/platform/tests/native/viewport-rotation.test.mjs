// The host viewport binding republishes the Solid viewport signal when the
// window rotates, so the scene and every native control bounded from it follow
// the new logical size. A rotation is a size change on both axes plus an inset
// change (the status bar moves from the top to the side).
//
// Runs after `pnpm build` (see .github/workflows/test.yml), like the other
// tests in this directory, and imports the built module. `viewport()` is the
// same signal Solid tracks, so reading it here observes what a component sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateViewport, viewport } from '../../dist/src/sdk/viewport.js';

const portrait = {
  width: 390,
  height: 844,
  scale: 2,
  safeArea: { top: 48, right: 0, bottom: 24, left: 0 },
  keyboardInset: 0,
  reducedMotion: false,
};

const landscape = {
  width: 844,
  height: 390,
  scale: 2,
  safeArea: { top: 0, right: 0, bottom: 24, left: 48 },
  keyboardInset: 0,
  reducedMotion: false,
};

const size = () => ({ width: viewport().width, height: viewport().height });

test('rotation republishes the viewport and resizes the scene', () => {
  const resized = [];
  const scene = {
    resize(width, height, scale) {
      resized.push({ width, height, scale });
    },
  };

  updateViewport(portrait, scene);
  assert.deepEqual(size(), { width: 390, height: 844 });
  assert.deepEqual(resized.at(-1), { width: 390, height: 844, scale: 2 });
  assert.equal(viewport().framebufferWidth, 780);
  assert.equal(viewport().framebufferHeight, 1688);

  updateViewport(landscape, scene);
  assert.deepEqual(
    size(),
    { width: 844, height: 390 },
    'the signal must carry the rotated logical size',
  );
  assert.deepEqual(
    resized.at(-1),
    { width: 844, height: 390, scale: 2 },
    'the scene must be resized to the rotated logical size',
  );
  assert.deepEqual(viewport().safeArea, landscape.safeArea);
  assert.equal(viewport().framebufferWidth, 1688);
  assert.equal(viewport().framebufferHeight, 780);

  updateViewport(portrait, scene);
  assert.deepEqual(size(), { width: 390, height: 844 });
  assert.deepEqual(resized.at(-1), { width: 390, height: 844, scale: 2 });
});

test('an inset-only change republishes without resizing the scene', () => {
  const resized = [];
  const scene = {
    resize(width, height) {
      resized.push({ width, height });
    },
  };

  updateViewport(portrait, scene);
  const count = resized.length;

  // The status bar is hidden while the keyboard is up, then shown again.
  updateViewport(
    { ...portrait, safeArea: { ...portrait.safeArea, top: 0 } },
    scene,
  );
  assert.equal(resized.length, count, 'no size change means no scene resize');
  assert.deepEqual(viewport().safeArea, {
    top: 0,
    right: 0,
    bottom: 24,
    left: 0,
  });
});

test('a layout pass with no measured size keeps the published viewport', () => {
  updateViewport(landscape);
  for (const width of [0, -1, Number.NaN, undefined]) {
    updateViewport({ ...landscape, width });
  }
  assert.deepEqual(size(), { width: 844, height: 390 });
});
