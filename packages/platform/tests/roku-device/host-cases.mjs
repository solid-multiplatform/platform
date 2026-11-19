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
