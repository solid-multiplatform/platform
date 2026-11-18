import { expect, test } from 'vitest';
import {
  createRenderer,
  registerDefaultShaders,
  activeElement,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { RendererMain } from '@solid-multiplatform/renderer';

test('resize preserves the live root, focused element, shader and framebuffer coordinates', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const { renderer, render } = createRenderer(
    {
      appWidth: 120,
      appHeight: 80,
      resizable: true,
      devicePhysicalPixelRatio: 1,
    } as never,
    container,
  );
  if (!(renderer instanceof RendererMain)) throw Error('Expected WebGL');
  registerDefaultShaders(renderer);
  let child!: ElementNode;
  const dispose = render(() => (
    <view
      ref={child}
      x={4}
      y={6}
      width={32}
      height={28}
      color={0xff0000ff}
      borderRadius={4}
      autofocus
    />
  ));
  try {
    await new Promise(requestAnimationFrame);
    const node = child.lng;
    renderer.resize(210, 110, 2);
    await new Promise(requestAnimationFrame);
    expect(renderer.canvas.width).toBe(420);
    expect(renderer.canvas.height).toBe(220);
    expect([renderer.root.w, renderer.root.h]).toEqual([210, 110]);
    expect(child.lng).toBe(node);
    expect(activeElement()).toBe(child);
    const gl =
      renderer.canvas.getContext('webgl') ??
      renderer.canvas.getContext('webgl2')!;
    expect([...gl.getParameter(gl.VIEWPORT)]).toEqual([0, 0, 420, 220]);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  } finally {
    dispose();
    renderer.destroy();
    container.remove();
  }
});
