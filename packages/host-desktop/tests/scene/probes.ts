// What the scene tests read from a frame, the same in the desktop runtime
// and in Chromium, so that the two can be compared.
//
// The fixture, in its own numbers: a 640 x 240 panel of 0x202020ff at the
// origin; in it a text node at the origin (Lato, 32 px, white) and two
// 64 x 64 boxes of 0x4fb3ffff at y = 80, the first at x = 0 and the second
// at x = 80. Around the panel the renderer's clear colour shows: transparent
// black.
import {
  activeElement,
  getRenderer,
  rootNode,
  type ElementNode,
} from '@solid-multiplatform/platform';
import type { RendererMain } from '@solid-multiplatform/renderer';

export const PANEL = [0x20, 0x20, 0x20, 0xff];
export const BOX = [0x4f, 0xb3, 0xff, 0xff];
export const BACKGROUND = [0, 0, 0, 0];

/** The text's area: the top of the panel, clear of the boxes below it. */
const TEXT = { x: 0, y: 0, width: 320, height: 48 };
const CELL = 8;

export interface Frame {
  width: number;
  height: number;
  /** RGBA at named points, x and y from the top left. */
  points: Record<string, number[]>;
  /** Pixels in the text's area that are nearer white than the panel. */
  glyphPixels: number;
  /**
   * The text's area as mean brightness per 8 x 8 cell, row by row: enough to
   * tell which glyphs are where, loose enough for two rasterizers.
   */
  textCells: number[];
}

export interface Scene {
  /** The panel's children, in order: the text, then the boxes by id. */
  children: string[];
  text: string;
  focused: boolean;
}

export const renderer = (): RendererMain => getRenderer() as RendererMain;

/** What the app's own tree says, beside what the pixels show. */
export function scene(): Scene {
  const panel = rootNode.children[0] as ElementNode;
  const children = panel.children as ElementNode[];
  return {
    children: children.map((child) => child.id ?? ''),
    text: String((children[0]!.lng as { text?: unknown }).text),
    focused: activeElement() === children[0],
  };
}

/** Points to read in a `width` x `height` frame, with what each must show. */
export function expectations(
  width: number,
  height: number,
): Record<string, { x: number; y: number; colour: number[] }> {
  const all = {
    'panel, far corner': { x: 630, y: 230, colour: PANEL },
    'panel, below the boxes': { x: 320, y: 200, colour: PANEL },
    'panel, between the boxes': { x: 72, y: 112, colour: PANEL },
    'panel, right of the boxes': { x: 160, y: 112, colour: PANEL },
    'first box': { x: 32, y: 112, colour: BOX },
    'first box, last pixel': { x: 63, y: 143, colour: BOX },
    'second box': { x: 112, y: 112, colour: BOX },
    'second box, first pixel': { x: 80, y: 80, colour: BOX },
    'above the boxes': { x: 32, y: 78, colour: PANEL },
    'background, right of the panel': { x: 660, y: 120, colour: BACKGROUND },
    'background, below the panel': { x: 320, y: 250, colour: BACKGROUND },
    'background, far corner': {
      x: width - 2,
      y: height - 2,
      colour: BACKGROUND,
    },
  };
  // In a window smaller than the panel only what fits can be read.
  return Object.fromEntries(
    Object.entries(all).filter(([, p]) => p.x < width && p.y < height),
  );
}

/**
 * Read the frame the renderer has just drawn. Call from the renderer's
 * `idle` event after `requestRender()`: the event fires in the animation
 * frame that drew, before the frame is presented, which is when the drawing
 * buffer is defined in a browser and here alike.
 */
export function readFrame(): Frame {
  const canvas = renderer().canvas;
  const gl = canvas.getContext('webgl') as WebGLRenderingContext;
  const { width, height } = canvas;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // GL's rows run from the bottom.
  const at = (x: number, y: number): number =>
    ((height - 1 - y) * width + x) * 4;
  const points: Record<string, number[]> = {};
  for (const [name, point] of Object.entries(expectations(width, height))) {
    const i = at(point.x, point.y);
    points[name] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
  }
  let glyphPixels = 0;
  const textCells: number[] = [];
  for (let cy = 0; cy < TEXT.height; cy += CELL) {
    for (let cx = 0; cx < TEXT.width; cx += CELL) {
      let sum = 0;
      for (let y = cy; y < cy + CELL; y++) {
        for (let x = cx; x < cx + CELL; x++) {
          const red = pixels[at(TEXT.x + x, TEXT.y + y)]!;
          sum += red;
          if (red > (PANEL[0]! + 255) / 2) glyphPixels++;
        }
      }
      textCells.push(Math.round(sum / (CELL * CELL)));
    }
  }
  return { width, height, points, glyphPixels, textCells };
}

/** Problems with a frame against the fixture's own numbers; empty when right. */
export function verifyFrame(frame: Frame): string[] {
  const problems: string[] = [];
  for (const [name, point] of Object.entries(
    expectations(frame.width, frame.height),
  )) {
    const actual = frame.points[name]!;
    if (actual.some((channel, i) => channel !== point.colour[i])) {
      problems.push(
        `${name} at ${point.x},${point.y}: [${actual}] is not [${point.colour}]`,
      );
    }
  }
  // "second first" at 32 px lights about a thousand pixels; a missing font
  // or atlas leaves none.
  if (frame.glyphPixels < 500) {
    problems.push(`text: only ${frame.glyphPixels} glyph pixels`);
  }
  return problems;
}

/** Problems with the app's tree after the fixture's reorder. */
export function verifyScene(state: Scene): string[] {
  const problems: string[] = [];
  if (state.children.join() !== ',second,first') {
    problems.push(`children are [${state.children}], not [,second,first]`);
  }
  if (state.text !== 'second first') problems.push(`text is "${state.text}"`);
  if (!state.focused) problems.push('the text node is not focused');
  return problems;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the scene has stopped changing: the font is in and no frame
 * has run for a while. A test's own loop, not something an app does.
 */
export async function settled(fonts: Promise<void>): Promise<void> {
  await fonts;
  let frames = 0;
  const count = (): void => {
    frames++;
  };
  renderer().on('frameTick', count);
  for (let quiet = -1; quiet !== frames; ) {
    quiet = frames;
    await sleep(150);
  }
  renderer().off('frameTick', count);
}

/** Draw once more and read that frame. */
export function nextFrame(): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const stage = renderer();
    const read = (): void => {
      stage.off('idle', read);
      try {
        resolve(readFrame());
      } catch (error) {
        reject(error);
      }
    };
    stage.on('idle', read);
    stage.requestRender();
  });
}
