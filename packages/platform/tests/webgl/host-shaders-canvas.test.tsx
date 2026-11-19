/**
 * The Canvas 2D host registers its engine's shader types as `webHost` does
 * the WebGL ones: an app started with `startApp(canvasHost(...))` draws
 * rounded corners, borders and gradients without registering anything.
 *
 *   pnpm test:webgl
 */
import { expect, test, vi } from 'vitest';
import { startApp } from '@solid-multiplatform/platform/host';
import { canvasHost } from '../../src/hosts/canvas';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

test('canvasHost draws borderRadius, border and gradients with no app-side shader registration', async () => {
  const root = document.createElement('div');
  root.style.cssText = 'width:400px;height:300px';
  document.body.appendChild(root);
  const warn = vi.spyOn(console, 'warn');
  const stop = startApp(
    canvasHost(
      { root, semantics: false, pointer: false },
      { numImageWorkers: 0 },
    ),
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
    const context = canvas.getContext('2d')!;
    const scale = canvas.width / 400;
    const pixel = (x: number, y: number) => [
      ...context.getImageData(
        Math.round(x * scale),
        Math.round(y * scale),
        1,
        1,
      ).data,
    ];
    for (let i = 0; i < 10; i++) await frame();

    // The middle is the fill, and the corner of the box is cut away.
    await vi.waitFor(() => {
      const middle = pixel(120, 80);
      expect(middle[2]).toBeGreaterThan(200);
      expect(middle[0]).toBeLessThan(60);
    });
    const corner = pixel(22, 22);
    expect(corner[2]).toBeLessThan(60);
    // The 8px border is somewhere across the top edge.
    const reds = [14, 16, 18, 22, 24, 26].map((y) => pixel(120, y)[0]!);
    expect(Math.max(...reds)).toBeGreaterThan(200);
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
        /not registered|does not support|already exists/.test(String(call[0])),
      ),
    ).toBe(false);
  } finally {
    warn.mockRestore();
    if (typeof stop === 'function') stop();
    root.remove();
  }
});
