/**
 * Culling is by the window a node's content can paint in, not by the node's
 * own box. A node that clips takes its subtree with it when its box leaves
 * the viewport; a node that does not clip may carry children painting past
 * its own box — a touch scroller's translated box is the everyday case — and
 * those children stay visible inside the clipping ancestor's window.
 *
 * Regression test for the reported bug: a rail flung to its end vanished at
 * rest, because its own (viewport-wide) box had moved fully outside the
 * window while its visible children sat past the box's end.
 *
 * Runs in Vitest browser mode against the real WebGL renderer and reads the
 * frame's pixels (`preserveDrawingBuffer` keeps them readable).
 */
import * as v from 'vitest';

// Before the renderer exists: keep the drawing buffer so pixels can be read.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  type: string,
  attributes?: Record<string, unknown>,
) {
  return getContext.call(
    this,
    type,
    type.startsWith('webgl')
      ? { ...attributes, preserveDrawingBuffer: true }
      : attributes,
  );
} as typeof getContext;

const { render, renderer, settle } = await import('./setup.js');
type ElementNode = import('@solid-multiplatform/platform').ElementNode;

const WINDOW = { x: 100, y: 100, w: 300, h: 200 };
const RED = 0xcc0000ff;
const BLUE = 0x0000ccff;

/** The canvas, and a scene-unit pixel probe. */
function canvasPixels() {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const gl = (canvas.getContext('webgl2') ??
    canvas.getContext('webgl')) as WebGLRenderingContext;
  const scale = canvas.width / renderer.settings.appWidth;
  const pixel = (x: number, y: number) => {
    const out = new Uint8Array(4);
    gl.readPixels(
      Math.round(x * scale),
      canvas.height - 1 - Math.round(y * scale),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      out,
    );
    return out;
  };
  return { pixel };
}

/** Whether any pixel in a scene-unit box matches `color`'s RGB. */
function boxHasColor(
  pixel: (x: number, y: number) => Uint8Array,
  box: { x: number; y: number; w: number; h: number },
  color: number,
): boolean {
  const r = (color >>> 24) & 0xff;
  const g = (color >>> 16) & 0xff;
  const b = (color >>> 8) & 0xff;
  for (let y = box.y + 4; y < box.y + box.h - 4; y += 8) {
    for (let x = box.x + 4; x < box.x + box.w - 4; x += 8) {
      const [pr, pg, pb] = pixel(x, y);
      if (Math.abs(pr - r) < 12 && Math.abs(pg - g) < 12 && Math.abs(pb - b) < 12)
        return true;
    }
  }
  return false;
}

v.test(
  'a translated non-clipping container keeps its in-window children visible',
  { timeout: 60000 },
  async () => {
    let container!: ElementNode;
    const dispose = render(() => (
      <view>
        {/* The window. */}
        <view
          x={WINDOW.x}
          y={WINDOW.y}
          width={WINDOW.w}
          height={WINDOW.h}
          clipping
          color={0x101014ff}
        >
          {/* The scroller: viewport-wide, its own box dragged fully past the
              window's left edge — beyond the bounds margin [100,100,450,50]
              so it is truly OUT — as the touch engine leaves a rail flung to
              its end. It does not clip; its children are absolutely placed
              and two of them land inside the window. */}
          <view
            ref={(node: ElementNode) => {
              container = node;
            }}
            x={-WINDOW.w - 300}
            y={0}
            width={WINDOW.w}
            height={WINDOW.h}
          >
            <view
              x={WINDOW.w + 300 + 40}
              y={40}
              width={80}
              height={60}
              color={RED}
            />
            <view
              x={WINDOW.w + 300 + 200}
              y={110}
              width={80}
              height={60}
              color={BLUE}
            />
            <view x={20} y={40} width={80} height={60} color={0x00aa00ff} />
          </view>
        </view>
      </view>
    )) as unknown as () => void;
    try {
      // The initial layout may classify the container in bounds; drag it out
      // the way the engine does, by writing x, then let a clean pass run.
      container.x = -WINDOW.w - 300;
      await settle();
      await settle();

      const { pixel } = canvasPixels();
      // The children inside the window still draw.
      v.expect(
        boxHasColor(pixel, { x: WINDOW.x + 40, y: WINDOW.y + 40, w: 80, h: 60 }, RED),
        'the child inside the window must stay visible after its non-clipping parent box left the window',
      ).toBe(true);
      v.expect(
        boxHasColor(pixel, { x: WINDOW.x + 200, y: WINDOW.y + 110, w: 80, h: 60 }, BLUE),
      ).toBe(true);
      // The child outside the window is clipped away (the left one).
      v.expect(
        boxHasColor(pixel, { x: WINDOW.x + 4, y: WINDOW.y + 40, w: 60, h: 60 }, 0x00aa00ff),
      ).toBe(false);
    } finally {
      dispose();
    }
  },
);

v.test(
  'a translated clipping container still culls its subtree',
  { timeout: 60000 },
  async () => {
    let container!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          x={WINDOW.x}
          y={WINDOW.y}
          width={WINDOW.w}
          height={WINDOW.h}
          clipping
          color={0x101014ff}
        >
          {/* This one clips: its box leaving the window closes the window
              for everything below it. */}
          <view
            ref={(node: ElementNode) => {
              container = node;
            }}
            x={-WINDOW.w - 300}
            y={0}
            width={WINDOW.w}
            height={WINDOW.h}
            clipping
          >
            <view
              x={WINDOW.w + 300 + 40}
              y={40}
              width={80}
              height={60}
              color={RED}
            />
          </view>
        </view>
      </view>
    )) as unknown as () => void;
    try {
      container.x = -WINDOW.w - 300;
      await settle();
      await settle();
      const { pixel } = canvasPixels();
      v.expect(
        boxHasColor(pixel, { x: WINDOW.x + 40, y: WINDOW.y + 40, w: 80, h: 60 }, RED),
        'a clipping node out of bounds must keep its subtree culled',
      ).toBe(false);
    } finally {
      dispose();
    }
  },
);
