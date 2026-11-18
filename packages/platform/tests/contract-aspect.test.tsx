import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { renderer, waitForUpdate } from './setup.js';

v.describe('aspectRatio', () => {
  v.it('derives the missing dimension from width or height', async () => {
    let fromWidth!: lng.ElementNode;
    let fromHeight!: lng.ElementNode;
    let explicit!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={400} height={400}>
        <view ref={fromWidth} width={100} aspectRatio={2} />
        <view ref={fromHeight} height={60} aspectRatio={2} />
        <view ref={explicit} width={80} height={20} aspectRatio={2} />
      </view>
    ));
    await waitForUpdate();
    v.expect(fromWidth.width).toBe(100);
    v.expect(fromWidth.height).toBe(50);
    v.expect(fromHeight.width).toBe(120);
    v.expect(fromHeight.height).toBe(60);
    v.expect(explicit.width).toBe(80);
    v.expect(explicit.height).toBe(20);
    dispose();
  });

  v.it('works when aspectRatio appears before the dimension prop', async () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={400} height={400}>
        <view ref={node} aspectRatio={1.5} width={90} />
      </view>
    ));
    await waitForUpdate();
    v.expect(node.width).toBe(90);
    v.expect(node.height).toBe(60);
    dispose();
  });

  v.it('ignores non-positive or non-finite ratios', async () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={400} height={400}>
        <view ref={node} width={50} aspectRatio={0} />
      </view>
    ));
    await waitForUpdate();
    v.expect(node.aspectRatio).toBeUndefined();
    v.expect(node.width).toBe(50);
    dispose();
  });
});
