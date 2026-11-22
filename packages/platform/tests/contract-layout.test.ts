// The layout helpers an app uses to size itself: the safe content box, the
// clamps that keep a dialog inside the room, and the screen-space rectangle
// that follows a scaled design space.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import {
  contentBoxFor,
  fitSize,
  clampSize,
  centerIn,
} from '../src/sdk/layout.js';

const insets = (top = 0, right = 0, bottom = 0, left = 0) => ({
  safeArea: { top, right, bottom, left },
  ime: { top: 0, right: 0, bottom: 0, left: 0 },
});

v.describe('content box', () => {
  v.test('a phone keeps its gutter on both sides', () => {
    const box = contentBoxFor(
      { width: 412, height: 892, insets: insets(24, 0, 16, 0) },
      { gutter: 16 },
    );
    v.expect(box).toMatchObject({ x: 16, y: 24, width: 380, height: 852 });
  });

  v.test('a wide window caps the column and centres it', () => {
    const box = contentBoxFor(
      { width: 1920, height: 1080, insets: insets() },
      { maxWidth: 1680, gutter: 80 },
    );
    v.expect(box.x).toBe(120);
    v.expect(box.width).toBe(1680);
    v.expect(box.height).toBe(1080);
  });

  v.test(
    'a gutter shrinks rather than pushing content off a tiny window',
    () => {
      const box = contentBoxFor(
        { width: 240, height: 320, insets: insets() },
        { gutter: 40 },
      );
      v.expect(box.width).toBeGreaterThan(0);
      v.expect(box.x + box.width).toBeLessThanOrEqual(240);
    },
  );

  v.test('the keyboard shrinks the box from the bottom', () => {
    const withKeyboard = contentBoxFor(
      {
        width: 412,
        height: 892,
        insets: {
          safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
          ime: { top: 0, right: 0, bottom: 300, left: 0 },
        },
      },
      { gutter: 16 },
    );
    // The IME is larger than the safe bottom, so it is the bottom edge.
    v.expect(withKeyboard.height).toBe(892 - 24 - 300);
  });
});

v.describe('size clamps', () => {
  v.test('a fixed panel fits the smaller phone', () => {
    v.expect(fitSize(420, 412, 16)).toBe(380);
    v.expect(fitSize(360, 412, 16)).toBe(360);
    v.expect(fitSize(420, 320, 8)).toBe(304);
  });

  v.test('a clamp keeps a floor when the room allows it', () => {
    v.expect(clampSize(420, 260, 412, 16)).toBe(380);
    v.expect(clampSize(200, 260, 412, 16)).toBe(260);
    v.expect(clampSize(200, 260, 240, 8)).toBe(224);
  });

  v.test('centring never goes negative', () => {
    v.expect(centerIn(380, 412)).toBe(16);
    v.expect(centerIn(420, 412)).toBe(0);
  });
});

v.describe('screenRect follows a scaled design space', () => {
  v.test('a child in a 0.5-scaled column lands in screen units', () => {
    const root = new lng.ElementNode('App');
    const column = new lng.ElementNode('view');
    column.x = 50;
    column.y = 40;
    column.width = 400;
    column.height = 300;
    column.scale = 0.5;
    const child = new lng.ElementNode('view');
    child.x = 100;
    child.y = 20;
    child.width = 200;
    child.height = 100;
    root.insertChild(column);
    column.insertChild(child);
    const rect = lng.screenRect(child);
    // The column is scaled about its centre: (50+200, 40+150). The child's
    // local centre is (200, 70) from the column origin.
    v.expect(rect.width).toBe(100);
    v.expect(rect.height).toBe(50);
    v.expect(rect.x).toBeGreaterThan(0);
    v.expect(rect.x + rect.width).toBeLessThanOrEqual(400);
  });
});
