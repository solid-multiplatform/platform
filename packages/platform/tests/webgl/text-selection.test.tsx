/**
 * Selectable text on the real WebGL backend: the highlight is drawn behind
 * the glyphs in the theme's selection colour, its x-range is the selected
 * characters' glyph advances, and clearing it removes the ink. Runs in
 * Vitest browser mode against the real renderer with Lato, reading frame
 * pixels (see text-fit.test.tsx for the same pattern).
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
const { SelectableText } = await import('@solid-multiplatform/platform/app');
const { rootNode } = await import('@solid-multiplatform/platform');
type ElementNode = import('@solid-multiplatform/platform').ElementNode;

const TEXT = 'Hello wonderful world';
const BLACK = 0x000000ff;
const WHITE = 0xffffffff;
const RED = 0xff0000ff;

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

/** First and last x whose pixel is red in the band, NaN when none is. */
function redRange(top: number, bottom: number, left = 0, right = 600) {
  const { pixel } = canvasPixels();
  let first = NaN;
  let last = NaN;
  for (let y = Math.ceil(top); y < bottom; y += 1) {
    for (let x = Math.ceil(left); x < right; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      // The quad's edges are antialiased: any clearly red pixel counts.
      if (r! > 100 && g! < 100 && b! < 100) {
        if (!(first <= x)) first = x;
        if (!(last >= x)) last = x;
      }
    }
  }
  return { first, last };
}

v.test(
  'a drag highlight covers characters 5–15 at their glyph advances',
  async () => {
    const dispose = render(() => (
      <view width={600} height={80} color={BLACK}>
        <SelectableText
          width={560}
          height={60}
          fontSize={30}
          color={WHITE}
          selectionColor={RED}
        >
          {TEXT}
        </SelectableText>
      </view>
    ));
    await settle();

    const background = rootNode.children[0] as ElementNode;
    const wrapper = background.children[0] as ElementNode;
    // SelectableText layers selection chrome after the text; the geometry
    // holder is the child that has it, not the last one.
    const inner = wrapper.children.find(
      (child) =>
        typeof (child as ElementNode).getTextGeometry === 'function',
    ) as ElementNode;
    const geometry = inner.getTextGeometry();
    v.expect(geometry).not.toBeNull();
    const line = geometry!.lines[0]!;
    v.expect(line.text).toBe(TEXT);

    // Select characters 5 to 15, as a pointer drag from their boundary does.
    const y = line.y + line.height / 2;
    const from = { x: line.charX[5]!, y };
    const to = { x: line.charX[15]!, y };
    wrapper.onPointerDrag!('start', from, from, wrapper);
    wrapper.onPointerDrag!('move', to, from, wrapper);
    wrapper.onPointerDrag!('end', to, from, wrapper);
    await settle();

    // The quad is the glyph advance span of the selected characters.
    const quad = wrapper.children[0] as ElementNode;
    v.expect(quad.x).toBeCloseTo(line.charX[5]!, 1);
    v.expect(quad.width).toBeCloseTo(line.charX[15]! - line.charX[5]!, 1);
    v.expect(quad.height).toBeCloseTo(line.height, 1);

    // And the pixels agree: the red band starts and ends at those advances.
    // Scan a band above the glyphs' cap height.
    const band = redRange(1, Math.max(2, line.baseline - 26));
    // A pixel is a 1 px cell: its left edge is `first`, its right edge is
    // `last + 1`. The tolerance is 2 px because the quad is rasterised on
    // integer pixels (its geometry, asserted above, is exact within 0.1):
    // SwiftShader in CI truncates a fractional edge by up to a pixel.
    console.info(
      '[selection] highlight pixels',
      band,
      'advances',
      line.charX[5],
      line.charX[15],
    );
    v.expect(Math.abs(band.first - line.charX[5]!)).toBeLessThanOrEqual(2);
    v.expect(Math.abs(band.last + 1 - line.charX[15]!)).toBeLessThanOrEqual(2);

    // Clearing removes the highlight and its ink.
    wrapper.onMouseClick!({ x: 0, y: 0 }, wrapper);
    await settle();
    const quads = wrapper.children.filter(
      (child) =>
        child.lng !== undefined &&
        (child.lng as { text?: string }).text === undefined,
    );
    v.expect(quads).toHaveLength(0);
    const after = redRange(1, Math.max(2, line.baseline - 26));
    v.expect(Number.isNaN(after.first)).toBe(true);

    dispose();
    await settle();
  },
);
