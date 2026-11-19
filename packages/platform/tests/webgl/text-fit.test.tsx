/**
 * Text never paints outside the box its parent reserved for it (CSS, React
 * Native, Flutter, Android and Roku all behave this way): a text wider than
 * the room left in its parent wraps at it, is cut with the overflow suffix
 * when the height gives it no more lines, and never draws glyphs past the
 * parent's edge.
 *
 * Runs in Vitest browser mode against the real WebGL renderer with Lato, and
 * reads the frame's pixels: the ink is where the canvas is not background.
 * `preserveDrawingBuffer` is turned on so a pixel can be read after the
 * frame that drew it.
 *
 *   pnpm test:webgl
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

/** A text's backend prop, which the platform's getters forward. */
const bound = (
  el: ElementNode,
  name: 'maxWidth' | 'maxHeight' | 'maxLines' | 'w' | 'h',
) => (el.lng as Record<string, unknown>)[name] as number;

const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

/** The showcase's fixed-width button label: wider than the button. */
const LONG_LABEL = 'Text field: no text entry on this host';

/** The canvas, and the scale between scene units and pixels. */
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
  return { scale, pixel };
}

/**
 * The last x (scene units) with a pixel above the background in the band
 * `[top, bottom)`; NaN when nothing drew.
 */
function lastInkColumn(
  left: number,
  right: number,
  top: number,
  bottom: number,
): number {
  const { pixel } = canvasPixels();
  let last = NaN;
  for (let y = Math.ceil(top); y < bottom; y += 1) {
    for (let x = Math.ceil(left); x < right; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      if (r! > 32 || g! > 32 || b! > 32) {
        if (!(last >= x)) last = x;
      }
    }
  }
  return last;
}

/** The first x (scene units) with ink in the band, NaN when nothing drew. */
function firstInkColumn(
  left: number,
  right: number,
  top: number,
  bottom: number,
): number {
  const { pixel } = canvasPixels();
  let first = NaN;
  for (let y = Math.ceil(top); y < bottom; y += 1) {
    for (let x = Math.ceil(left); x < right; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      if (r! > 32 || g! > 32 || b! > 32) {
        if (!(first <= x)) first = x;
      }
    }
  }
  return first;
}

v.test(
  'a label wider than its fixed parent is cut inside the parent box',
  async () => {
    let box!: ElementNode;
    let label!: ElementNode;
    // The showcase's ui.tsx Button at 1280 by 720: a 280 x 48 view with the
    // label at x 16, y 10, 22 px. At natural width it runs ~72 px past the
    // view's right edge (the "host" the screenshot showed outside it).
    const dispose = render(() => (
      <view ref={box} y={0} width={280} height={48} color={BLACK}>
        <text ref={label} x={16} y={10} fontSize={22} color={WHITE}>
          {LONG_LABEL}
        </text>
      </view>
    ));
    await settle();

    // The parent's box became the label's bound: no explicit contain, so the
    // platform wrote the room it had left.
    v.expect(label.width).toBe(264); // 280 - 16
    v.expect(bound(label, 'maxWidth')).toBeCloseTo(264, 3);
    // One line fits the height (38 = 48 - 10), so the text is cut with the
    // suffix rather than wrapped onto a second line.
    v.expect(label.height).toBe(38);
    v.expect(bound(label, 'maxHeight')).toBeCloseTo(38, 3);

    const last = lastInkColumn(0, 400, 0, 48);
    console.info('[text-fit] label ink ends at', last, 'box ends at 280');
    v.expect(last).toBeGreaterThan(16); // it drew
    v.expect(last).toBeLessThanOrEqual(280); // inside the box, within a pixel
    // And it is not the natural 352 px run.
    v.expect(last).toBeLessThan(300);

    dispose();
    await settle();
  },
);

v.test(
  'a text that fits keeps no bound and draws at its natural width',
  async () => {
    let box!: ElementNode;
    let label!: ElementNode;
    const dispose = render(() => (
      <view ref={box} y={120} width={400} height={60} color={BLACK}>
        <text ref={label} x={16} y={10} fontSize={22} color={WHITE}>
          Short label
        </text>
      </view>
    ));
    await settle();

    // No clamp: the natural width, no maxWidth or maxHeight, as before.
    v.expect(bound(label, 'maxWidth')).toBe(0);
    v.expect(bound(label, 'maxHeight')).toBe(0);
    v.expect(bound(label, 'w')).toBeCloseTo(label.width, 3);
    const last = lastInkColumn(0, 400, 120, 180);
    v.expect(last).toBeGreaterThan(16);
    v.expect(last).toBeLessThanOrEqual(400);

    dispose();
    await settle();
  },
);

v.test('a long word in a narrow box is split and stays inside', async () => {
  let box!: ElementNode;
  let label!: ElementNode;
  const dispose = render(() => (
    <view ref={box} y={240} width={100} height={120} color={BLACK}>
      <text ref={label} x={0} y={0} fontSize={22} color={WHITE}>
        Supercalifragilisticexpialidocious
      </text>
    </view>
  ));
  await settle();

  v.expect(bound(label, 'maxWidth')).toBeCloseTo(100, 3);
  const last = lastInkColumn(0, 200, 240, 360);
  console.info('[text-fit] long word ink ends at', last, 'box ends at 100');
  v.expect(last).toBeLessThanOrEqual(100);
  const first = firstInkColumn(0, 200, 240, 360);
  v.expect(first).toBeGreaterThanOrEqual(0);
  dispose();
  await settle();
});

v.test('a contained text wraps at its width and stays inside it', async () => {
  let label!: ElementNode;
  const dispose = render(() => (
    <view y={400} width={300} height={200} color={BLACK}>
      <text ref={label} width={200} contain="width" fontSize={22} color={WHITE}>
        A description long enough to wrap onto several lines inside its box.
      </text>
    </view>
  ));
  await settle();

  // The app's own bound: the clamp leaves it alone.
  v.expect(bound(label, 'maxWidth')).toBe(200);
  v.expect(bound(label, 'maxHeight')).toBe(0);
  v.expect(bound(label, 'w')).toBeLessThanOrEqual(200);
  const last = lastInkColumn(0, 300, 400, 600);
  v.expect(last).toBeLessThanOrEqual(200);
  dispose();
  await settle();
});

v.test(
  'maxLines and the overflow suffix cut the last line inside the box',
  async () => {
    let label!: ElementNode;
    const dispose = render(() => (
      <view y={650} width={240} height={120} color={BLACK}>
        <text
          ref={label}
          width={180}
          contain="width"
          maxLines={2}
          overflowSuffix="..."
          fontSize={22}
          color={WHITE}
        >
          A description long enough to be cut after its second line, with more.
        </text>
      </view>
    ));
    await settle();

    v.expect(bound(label, 'maxWidth')).toBe(180);
    v.expect(bound(label, 'maxLines')).toBe(2);
    const last = lastInkColumn(0, 240, 650, 770);
    console.info('[text-fit] maxLines ink ends at', last, 'box ends at 180');
    v.expect(last).toBeLessThanOrEqual(180);
    dispose();
    await settle();
  },
);

v.test(
  'a scaled parent scales the box and the ink it holds together',
  async () => {
    let parent!: ElementNode;
    let label!: ElementNode;
    // The design-space box is 280 x 48; scale 1.5 draws it 420 x 72.
    const dispose = render(() => (
      <view
        ref={parent}
        x={0}
        y={800}
        width={280}
        height={48}
        scale={1.5}
        pivot={0}
        color={BLACK}
      >
        <text ref={label} x={16} y={10} fontSize={22} color={WHITE}>
          {LONG_LABEL}
        </text>
      </view>
    ));
    await settle();

    v.expect(bound(label, 'maxWidth')).toBeCloseTo(264, 3);
    const last = lastInkColumn(0, 600, 800, 880);
    console.info(
      '[text-fit] scaled ink ends at',
      last,
      'scaled box ends at 420',
    );
    // The box's scaled right edge, within a pixel.
    v.expect(last).toBeLessThanOrEqual(420);
    v.expect(last).toBeGreaterThan(300); // it used the room and drew
    dispose();
    await settle();
  },
);

v.test('two texts in a flex row keep the row as their box', async () => {
  let row!: ElementNode;
  let one!: ElementNode;
  let two!: ElementNode;
  const dispose = render(() => (
    <view ref={row} y={950} display="flex" gap={12} color={BLACK}>
      <text ref={one} fontSize={22} color={WHITE}>
        First
      </text>
      <text ref={two} fontSize={22} color={WHITE}>
        Second
      </text>
    </view>
  ));
  await settle();

  // The row grew to both texts and their gap: nothing was cut.
  v.expect(bound(one, 'maxWidth')).toBe(0);
  v.expect(bound(two, 'maxWidth')).toBe(0);
  v.expect(row.width).toBeCloseTo(one.width + 12 + two.width, 3);
  const last = lastInkColumn(0, 600, 950, 1030);
  v.expect(last).toBeLessThanOrEqual(Math.ceil(row.width));
  dispose();
  await settle();
});
