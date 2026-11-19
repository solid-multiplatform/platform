// What the Roku frame-pacing workload draws, shared by the app
// (pacing-app.tsx) and the runner (tests/performance/run-pacing.mjs).
// Positions are in the 1920x1080 scene.
export const SCREEN = { w: 1920, h: 1080 };
export const BG = 0x0d1420ff;

/** The scrolling rail: poster cards with a title label each. */
export const RAIL = {
  cards: 24,
  width: 300,
  height: 360,
  gap: 16,
  y: 200,
  color: 0x1d3350ff,
  altColor: 0x243f63ff,
  labelColor: 0xffffffff,
};

/** The full-screen batch: independent nodes animated together. */
export const BATCH = {
  nodes: 30,
  columns: 10,
  width: 140,
  height: 70,
  gapX: 30,
  gapY: 20,
  x: 120,
  y: 640,
  color: 0x2c6e8fff,
  durationMs: 800,
};

export const PERIOD_MS = 1000 / 60;
export const BLOCK_MS = 1000;
/** One deliberate JS block, after the workload has warmed up. */
export const BLOCK_AT_MS = 10_000;
export const DEFAULT_SECONDS = 60;

export const CASES = ['steady', 'animation', 'block'];

/** The rail travel that brings the last card into view. */
export const RAIL_TRAVEL =
  RAIL.cards * (RAIL.width + RAIL.gap) - RAIL.gap - SCREEN.w;
