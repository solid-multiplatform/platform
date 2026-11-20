// What the host test app draws and where, shared by the app (host-app.tsx)
// and the runner that probes its screenshots (run-host.mjs).
export const SCREEN = { w: 1920, h: 1080 };
export const BG = 0x101010ff;
/** A button with focus, and one without. */
export const FOCUSED = 0x00c000ff;
export const IDLE = 0x404040ff;
export const BUTTONS = [
  { x: 200, y: 400, w: 300, h: 150 },
  { x: 600, y: 400, w: 300, h: 150 },
  { x: 1000, y: 400, w: 300, h: 150 },
];
/** Shown while the modal is open. */
export const MODAL = { x: 1500, y: 400, w: 200, h: 150, color: 0x2040ffff };
/**
 * The scrolling rail: ten 400x200 cards with a 30 gap at y = 300. Select on
 * the first card calls `scrollToIndex(8)`, which tvOS must show whole; at that
 * scroll card 8 occupies 1520..1920.
 */
export const RAIL = {
  x: 0,
  y: 300,
  w: 400,
  h: 200,
  gap: 30,
  count: 10,
  jumpTo: 8,
  /** Inside the jumped-to card, in screenshot pixels. */
  probe: { x: 1700, y: 400, w: 40, h: 40 },
};
