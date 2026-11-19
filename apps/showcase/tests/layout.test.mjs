// The showcase's window classes, run by Node's own test runner (the file is
// type-stripped, so no build step): phone, desktop window, television. The
// television and desktop numbers are the scene's original geometry and must
// not move; the phone's header condenses and its list becomes one column.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_MAX_WIDTH,
  MOBILE_MAX_WIDTH,
  layoutFor,
  metricsFor,
} from '../src/layout.ts';

test('maps widths to phone, desktop and television', () => {
  assert.equal(MOBILE_MAX_WIDTH, 500);
  assert.equal(DESKTOP_MAX_WIDTH, 1600);
  assert.equal(layoutFor(320), 'mobile');
  assert.equal(layoutFor(420), 'mobile');
  assert.equal(layoutFor(500), 'mobile');
  assert.equal(layoutFor(501), 'desktop');
  assert.equal(layoutFor(800), 'desktop');
  assert.equal(layoutFor(1280), 'desktop');
  assert.equal(layoutFor(1600), 'desktop');
  assert.equal(layoutFor(1601), 'tv');
  assert.equal(layoutFor(1920), 'tv');
});

test('keeps the television and desktop geometry the scene always had', () => {
  // The Roku visual suite compares 1920 by 1080 pixels and the mouse test
  // clicks at 1280: neither may move.
  for (const width of [1280, 1920]) {
    assert.deepEqual(metricsFor(width), {
      layout: width === 1920 ? 'tv' : 'desktop',
      margin: 32,
      titleY: 18,
      titleSize: 34,
      subtitleY: 68,
      subtitleSize: 18,
      screenBodyY: 76,
      homeBodyY: 110,
      gap: 16,
      tileHeight: 110,
    });
  }
});

test('condenses the header and the spacing on a phone', () => {
  const phone = metricsFor(420);
  assert.equal(phone.layout, 'mobile');
  assert.equal(phone.margin, 16);
  assert.equal(phone.titleSize, 26);
  assert.equal(phone.screenBodyY, 60);
  assert.equal(phone.homeBodyY, 70);
  assert.equal(phone.tileHeight, 84);
  assert.ok(phone.margin < metricsFor(1280).margin);
});
