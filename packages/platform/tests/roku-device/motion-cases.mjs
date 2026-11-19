// What the device motion test draws and where, shared by the app
// (motion-app.tsx) and the runner that probes its screenshots
// (run-motion.mjs). Positions are in the 1920x1080 scene.
export const SCREEN = { w: 1920, h: 1080 };
export const BG = 0x101820ff;

/** The red block slides along this span and is probed at its left edge. */
export const MOVE = {
  x0: 100,
  x1: 900,
  y: 400,
  w: 200,
  h: 200,
  color: 0xe03030ff,
  duration: 2000,
};

/** The green block fades; its centre colour carries the opacity. */
export const FADE = {
  x: 1200,
  y: 400,
  w: 200,
  h: 200,
  color: 0x30e070ff,
  a0: 1,
  a1: 0.35,
  duration: 2000,
};

/** Colours as the probes compare them (RGB only). */
export const rgb = (c) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
