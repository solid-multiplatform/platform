// The geometry and colours of the device visual test, shared by the app that
// draws the cases (visual-app.tsx) and the runner that probes the screenshot
// (run-visual.mjs). Colours are 0xRRGGBBAA; angles are radians, as the
// platform's linearGradient takes them (0: top to bottom, PI/2: right to left).

export const SCREEN = { w: 1920, h: 1080 };
export const BG = 0x1a2330ff;
/** The light panel the shadow case sits on, so that a black shadow shows. */
export const PANEL = 0xd0d0d0ff;

const col = (i) => 45 + i * 262;
const ROW = [86, 336, 586, 836];

const RED = 0xe0483cff;
const BLUE = 0x3060c8ff;
const YELLOW = 0xf0c020ff;
const TWO = [0xf03030ff, 0x2030f0ff];

/** Where the label of the i-th case goes: above its grid cell. */
export const labelAt = (i) => ({ x: col(i % 7), y: ROW[Math.floor(i / 7)] - 44 });

export const CASES = {
  // Row 1: corners and borders.
  rounded: { x: col(0), y: ROW[0], w: 240, h: 180, color: RED, radius: 48 },
  // [top-left, top-right, bottom-right, bottom-left]
  roundedCorners: {
    x: col(1),
    y: ROW[0],
    w: 240,
    h: 180,
    color: RED,
    radius: [0, 40, 80, 0],
  },
  // A radius past half the height draws a pill, as the web backends clamp it.
  pill: { x: col(2), y: ROW[0] + 40, w: 240, h: 100, color: RED, radius: 200 },
  // A border is drawn outside the node by default, as on WebGL.
  border: {
    x: col(3) + 16,
    y: ROW[0] + 16,
    w: 208,
    h: 148,
    color: BLUE,
    borderWidth: 16,
    borderColor: YELLOW,
  },
  borderInside: {
    x: col(4),
    y: ROW[0],
    w: 240,
    h: 180,
    color: BLUE,
    borderWidth: 16,
    borderColor: YELLOW,
  },
  roundedBorder: {
    x: col(5) + 12,
    y: ROW[0] + 12,
    w: 216,
    h: 156,
    color: BLUE,
    radius: 32,
    borderWidth: 12,
    borderColor: YELLOW,
  },
  borderBottom: {
    x: col(6),
    y: ROW[0],
    w: 240,
    h: 150,
    color: BLUE,
    borderWidth: 16,
    borderColor: YELLOW,
  },

  // Row 2: gradient shaders.
  linear0: { x: col(0), y: ROW[1], w: 240, h: 180, angle: 0, colors: TWO },
  linear90: {
    x: col(1),
    y: ROW[1],
    w: 240,
    h: 180,
    angle: Math.PI / 2,
    colors: TWO,
  },
  linear45: {
    x: col(2),
    y: ROW[1],
    w: 180,
    h: 180,
    angle: Math.PI / 4,
    colors: TWO,
  },
  // Not square: the axis is 45 degrees in pixels, not corner to corner.
  linear45wide: {
    x: col(3),
    y: ROW[1],
    w: 240,
    h: 120,
    angle: Math.PI / 4,
    colors: TWO,
  },
  linear3: {
    x: col(4),
    y: ROW[1],
    w: 240,
    h: 180,
    angle: 0,
    colors: [0xf03030ff, 0x30d040ff, 0x2030f0ff],
    stops: [0, 0.25, 1],
  },
  linear4: {
    x: col(5),
    y: ROW[1],
    w: 240,
    h: 180,
    angle: Math.PI / 2,
    colors: [0xf03030ff, 0xf0d020ff, 0x30d040ff, 0x2030f0ff],
  },
  radial: {
    x: col(6),
    y: ROW[1],
    w: 180,
    h: 180,
    colors: [0xf0e040ff, 0x2030a0ff],
    stops: [0, 1],
    radiusW: 90,
    radiusH: 90,
    pivot: [0.5, 0.5],
  },

  // Row 3: vertex colours, shadow, clipping, text.
  topBottom: {
    x: col(0),
    y: ROW[2],
    w: 240,
    h: 180,
    colorTop: 0xf04040ff,
    colorBottom: 0x2040e0ff,
  },
  leftRight: {
    x: col(1),
    y: ROW[2],
    w: 240,
    h: 180,
    colorLeft: 0xf04040ff,
    colorRight: 0x2040e0ff,
  },
  corners: {
    x: col(2),
    y: ROW[2],
    w: 240,
    h: 180,
    colorTl: 0xff0000ff,
    colorTr: 0x00ff00ff,
    colorBl: 0x0000ffff,
    colorBr: 0xffff00ff,
  },
  roundedGradient: {
    x: col(3),
    y: ROW[2],
    w: 240,
    h: 180,
    radius: 48,
    colorTop: 0xf04040ff,
    colorBottom: 0x2040e0ff,
  },
  // The node sits on a light panel; the shadow falls 24 px below it.
  shadow: {
    panel: { x: col(4) - 5, y: ROW[2] - 10, w: 250, h: 200 },
    x: col(4) + 40,
    y: ROW[2] + 20,
    w: 160,
    h: 100,
    color: BLUE,
    radius: 16,
    shadowColor: 0x000000ff,
    shadowX: 0,
    shadowY: 24,
    shadowBlur: 16,
    shadowSpread: 0,
  },
  clip: {
    x: col(5),
    y: ROW[2],
    w: 160,
    h: 120,
    color: BLUE,
    child: { x: 80, y: 60, w: 160, h: 120, color: YELLOW },
  },
  textOverGradient: {
    x: col(6),
    y: ROW[2],
    w: 240,
    h: 180,
    angle: 0,
    colors: [0x802020ff, 0x202080ff],
    text: 'Text',
    fontSize: 72,
    textColor: 0xffffffff,
  },

  // Row 4: an image, and combinations.
  // A packaged image (the host's black.png) with rounded corners and a border.
  imageRounded: {
    x: col(0) + 12,
    y: ROW[3] + 12,
    w: 216,
    h: 156,
    src: 'pkg:/assets/black.png',
    radius: 40,
    borderWidth: 12,
    borderColor: YELLOW,
  },
  cornersRounded: {
    x: col(1),
    y: ROW[3],
    w: 240,
    h: 180,
    radius: 48,
    colorTl: 0xff0000ff,
    colorTr: 0x00ff00ff,
    colorBl: 0x0000ffff,
    colorBr: 0xffff00ff,
  },
  // Starts square and animates to the radius through a platform transition.
  animatedRadius: {
    x: col(3),
    y: ROW[3],
    w: 240,
    h: 180,
    color: RED,
    radius: 48,
  },
  // The right half of a packaged image (the backend's 256 x 2 alpha ramp,
  // tinted): a crop is drawn from the bitmap size the device reports.
  imageCrop: {
    x: col(4),
    y: ROW[3],
    w: 240,
    h: 180,
    src: 'pkg:/assets/smp/ramp-h.png',
    color: YELLOW,
    srcX: 128,
    srcY: 0,
    srcWidth: 128,
    srcHeight: 2,
  },
  // A gap between the node and its border shows what is behind.
  borderGap: {
    x: col(2) + 24,
    y: ROW[3] + 24,
    w: 192,
    h: 132,
    color: BLUE,
    borderWidth: 12,
    borderGap: 12,
    borderColor: YELLOW,
  },
};

export const LABELS = {
  rounded: 'radius 48',
  roundedCorners: 'radius 0/40/80/0',
  pill: 'radius 200 (pill)',
  border: 'border 16',
  borderInside: 'border 16 inside',
  roundedBorder: 'radius 32 + border 12',
  borderBottom: 'borderBottom 16',
  linear0: 'linear 0',
  linear90: 'linear 90',
  linear45: 'linear 45',
  linear45wide: 'linear 45, 2:1',
  linear3: 'linear 0, stops 0/.25/1',
  linear4: 'linear 90, 4 colours',
  radial: 'radial',
  topBottom: 'colorTop/Bottom',
  leftRight: 'colorLeft/Right',
  corners: 'four corners',
  roundedGradient: 'radius 48 + colorTop',
  shadow: 'shadow y24 blur16',
  clip: 'clipped child',
  textOverGradient: 'text over gradient',
  imageRounded: 'image, radius + border',
  cornersRounded: 'four corners + radius',
  borderGap: 'border 12, gap 12',
  animatedRadius: 'radius 0 -> 48, animated',
  imageCrop: 'image, right half',
};
