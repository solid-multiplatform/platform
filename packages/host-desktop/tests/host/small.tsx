// A small app for what needs a run of its own: the display's scale as the
// window opens (run.mjs asks SDL for 2), and ending on a signal. Prints
// `SMALL <json>` once drawn, `CLICKED x,y` for a click on its control, and
// `DISPOSED` from the app's cleanup.
import { onCleanup } from 'solid-js';
import { getRenderer } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { viewport } from '@solid-multiplatform/platform/viewport';
import type { RendererMain } from '@solid-multiplatform/renderer';
import { desktopHost } from '@solid-multiplatform/host-desktop';

startApp(
  desktopHost({ id: 'solid.test.small', title: 'Solid small test' }),
  () => {
    onCleanup(() => console.log('DISPOSED'));
    return (
      <>
        <view x={20} y={20} width={100} height={100} color={0x4fb3ffff} />
        {/* A real click lands here in scene units, whatever the scale. */}
        <view
          x={140}
          y={40}
          width={20}
          height={20}
          onMouseClick={(point) => console.log(`CLICKED ${point.x},${point.y}`)}
        />
      </>
    );
  },
);

const stage = getRenderer() as RendererMain;
const read = (): void => {
  stage.off('idle', read);
  const canvas = stage.canvas;
  const gl = canvas.getContext('webgl') as WebGLRenderingContext;
  const at = (x: number, y: number): number[] => {
    const rgba = new Uint8Array(4);
    gl.readPixels(
      x,
      canvas.height - 1 - y,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );
    return Array.from(rgba);
  };
  const { width, height, scale, framebufferWidth, framebufferHeight } =
    viewport();
  console.log(
    'SMALL ' +
      JSON.stringify({
        viewport: { width, height, scale, framebufferWidth, framebufferHeight },
        canvas: [canvas.width, canvas.height],
        // In pixels: inside the box at twice its units, and where the box
        // would end at a scale of 1.
        pixels: [at(60, 60), at(200, 200), at(250, 250)],
      }),
  );
};
stage.on('idle', read);
stage.requestRender();
