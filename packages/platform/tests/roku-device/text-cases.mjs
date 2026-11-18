// The texts of the device text test, shared by the app that draws them
// (text-app.tsx) and the runner that probes the screenshot (run-text.mjs).
// White text on black; `x`/`y` place the text node, `props` are its text
// props as an app writes them.

export const SCREEN = { w: 1920, h: 1080 };
export const BG = 0x000000ff;
export const INK = 0xffffffff;
/** The box after a text in a flex row: where it lands shows the width the layout saw. */
export const MARK = { w: 40, h: 40, color: 0xd02020ff };
export const GAP = 24;

/** A family nobody registers: its text falls back to the system font. */
export const UNREGISTERED = 'Nope Sans';
/** A family whose font file run-text.mjs removes from the package before installing. */
export const MISSING = 'Onest';
export const MISSING_FILE = 'fonts/Onest-Regular.ttf';

const PARAGRAPH = 'The quick brown fox jumps over the lazy dog near the river bank';
const LINES = 'Line one\nLine two\nLine three';

export const TEXTS = {
  // Alignment in a contain="width" box.
  alignLeft: { x: 40, y: 30, text: 'Left aligned', props: { width: 520, contain: 'width', textAlign: 'left', fontFamily: 'Roboto', fontSize: 40 } },
  alignCenter: { x: 600, y: 30, text: 'Centre aligned', props: { width: 520, contain: 'width', textAlign: 'center', fontFamily: 'Roboto', fontSize: 40 } },
  alignRight: { x: 1160, y: 30, text: 'Right aligned', props: { width: 520, contain: 'width', textAlign: 'right', fontFamily: 'Roboto', fontSize: 40 } },

  // Wrapping, maxLines with the suffix, a word longer than the line.
  wrap: { x: 40, y: 110, text: PARAGRAPH, props: { width: 360, contain: 'width', fontFamily: 'Roboto', fontSize: 32 } },
  maxLines: { x: 460, y: 110, text: PARAGRAPH, props: { width: 360, contain: 'width', maxLines: 2, fontFamily: 'Roboto', fontSize: 32 } },
  suffix: { x: 880, y: 110, text: PARAGRAPH, props: { width: 360, contain: 'width', maxLines: 1, overflowSuffix: ' >>', fontFamily: 'Roboto', fontWeight: 700, fontSize: 32 } },
  longWord: { x: 1300, y: 110, text: 'Pneumonoultramicroscopic word', props: { width: 240, contain: 'width', fontFamily: 'Roboto', fontSize: 32 } },

  // Letter spacing: the same text without, with, and centred with.
  plain: { x: 40, y: 360, text: 'SPACED OUT', props: { fontFamily: 'Roboto', fontSize: 40 } },
  spaced: { x: 440, y: 360, text: 'SPACED OUT', props: { fontFamily: 'Roboto', fontSize: 40, letterSpacing: 12 } },
  spacedCenter: { x: 1000, y: 360, text: 'SPACED OUT', props: { width: 700, contain: 'width', textAlign: 'center', fontFamily: 'Raleway', fontSize: 40, letterSpacing: 6 } },

  // Line height: pixels, a multiplier, the default (1.2).
  linePixels: { x: 40, y: 440, text: LINES, props: { fontFamily: 'Roboto', fontSize: 32, lineHeight: 60 } },
  lineMultiple: { x: 440, y: 440, text: LINES, props: { fontFamily: 'Roboto', fontSize: 32, lineHeight: 1.5 } },
  lineDefault: { x: 840, y: 440, text: LINES, props: { fontFamily: 'Roboto', fontSize: 32 } },
  lineRight: { x: 1240, y: 440, text: 'A\nlonger line\nmid', props: { width: 300, contain: 'width', textAlign: 'right', fontFamily: 'Raleway', fontSize: 32 } },

  // The width the platform reads against the ink on screen.
  widthRegular: { x: 40, y: 640, text: 'Hamburgefonstiv 0123456789', props: { fontFamily: 'Roboto', fontSize: 40 } },
  widthBold: { x: 680, y: 640, text: 'AVATAR To WAVE, Yo. Text', props: { fontFamily: 'Roboto', fontWeight: 700, fontSize: 40 } },
  widthLigatures: { x: 1320, y: 640, text: 'office fi fl ffi affinity', props: { fontFamily: 'Raleway', fontSize: 40 } },
  widthSmall: { x: 40, y: 705, text: 'The quick brown fox jumps over the lazy dog', props: { fontFamily: 'Roboto', fontSize: 28 } },
  // Weight 500 is not registered: the nearest, 400, draws it.
  widthNearest: { x: 680, y: 705, text: 'Nearest weight of a family', props: { fontFamily: 'Roboto', fontWeight: 500, fontSize: 36 } },
  widthLarge: { x: 1320, y: 695, text: 'Typography AV', props: { fontFamily: 'Raleway', fontSize: 56 } },

  // Vertical alignment in a fixed-height box. Capitals: their feet are the baseline.
  top: { x: 40, y: 790, text: 'HEH', props: { width: 300, height: 160, contain: 'both', verticalAlign: 'top', fontFamily: 'Roboto', fontSize: 48 } },
  middle: { x: 380, y: 790, text: 'HEH', props: { width: 300, height: 160, contain: 'both', verticalAlign: 'middle', fontFamily: 'Roboto', fontSize: 48 } },
  bottom: { x: 720, y: 790, text: 'HEH', props: { width: 300, height: 160, contain: 'both', verticalAlign: 'bottom', fontFamily: 'Roboto', fontSize: 48 } },
};

/** Flex rows: a text and then the mark, GAP apart. The mark's place depends on the text's measured width. */
export const ROWS = {
  flexRegistered: { x: 1060, y: 790, text: 'Flexible width', props: { fontFamily: 'Roboto', fontWeight: 700, fontSize: 36 } },
  flexUnregistered: { x: 1060, y: 860, text: 'System fallback', props: { fontFamily: UNREGISTERED, fontSize: 36 } },
  flexMissing: { x: 1060, y: 930, text: 'Missing file', props: { fontFamily: MISSING, fontSize: 36 } },
};

/** Fonts measured on the device with getFontMeasure(), against the build-time table. */
export const MEASURED_SIZES = [20, 28, 36, 48, 64];
export const MEASURED_STRINGS = [
  'Hello World',
  'AVATAR To WAVE',
  'The quick brown fox jumps over the lazy dog',
  'office fi fl ffi',
  'Te', 'Yo', 'r.', 'LT',
  'aaaaaaaaaa',
  'Settings & Privacy (12)',
  '0123456789',
  'a  b',
  'éüñ €',
  'Left aligned',
  'SPACED OUT',
];
