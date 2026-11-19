/**
 * An app started with `startApp(webHost(...))` draws rounded corners, borders
 * and gradients without registering a shader itself: the host registers the
 * WebGL backend's default shader types when it builds its renderer.
 *
 *   pnpm test:webgl
 */
import { expect, test, vi } from 'vitest';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;

// The drawing buffer is cleared once a frame is shown: keep it, so that a
// pixel can be read at any time after the scene has drawn.
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

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

test('webHost draws borderRadius, border and gradients with no app-side shader registration', async () => {
  const root = document.createElement('div');
  root.style.cssText = 'width:400px;height:300px';
  document.body.appendChild(root);
  const warn = vi.spyOn(console, 'warn');
  const stop = startApp(
    webHost({ root, semantics: false, pointer: false }),
    () => (
      <view width={400} height={300}>
        <view
          x={20}
          y={20}
          width={200}
          height={120}
          color={BLUE}
          borderRadius={40}
          border={{ color: RED, width: 8 }}
        />
        <view
          x={240}
          y={20}
          width={120}
          height={120}
          linearGradient={{ colors: [GREEN, BLUE], stops: [0, 1], angle: 0 }}
        />
      </view>
    ),
    {
      renderer: {
        appWidth: 400,
        appHeight: 300,
        devicePhysicalPixelRatio: 1,
      } as never,
    },
  );
  try {
    const canvas = root.querySelector('canvas')!;
    const gl = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext;
    const scale = canvas.width / 400;
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
      return [...out];
    };
    for (let i = 0; i < 10; i++) await frame();

    await vi.waitFor(() => {
      // The 8px border is drawn around the box: just above its top edge is
      // the border colour.
      const edge = pixel(120, 16);
      expect(edge[0]).toBeGreaterThan(200);
      expect(edge[2]).toBeLessThan(60);
    });
    // The corners are rounded: both the box's own corner and the border's
    // are background.
    for (const corner of [pixel(22, 22), pixel(14, 14)]) {
      expect(corner[0]).toBeLessThan(60);
      expect(corner[2]).toBeLessThan(60);
    }
    // The middle is the fill.
    const middle = pixel(120, 80);
    expect(middle[2]).toBeGreaterThan(200);
    expect(middle[0]).toBeLessThan(60);
    // The gradient runs from green to blue: its two ends differ.
    const greens = [
      pixel(300, 24),
      pixel(300, 136),
      pixel(244, 80),
      pixel(356, 80),
    ].map((p) => p[1]!);
    expect(Math.max(...greens) - Math.min(...greens)).toBeGreaterThan(120);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('not registered'),
      ),
    ).toBe(false);
  } finally {
    warn.mockRestore();
    if (typeof stop === 'function') stop();
    root.remove();
  }
});
