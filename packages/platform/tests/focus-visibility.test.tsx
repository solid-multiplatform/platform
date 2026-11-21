// Focus visibility policy: focus always exists, but on a pointer-first host
// its ring is drawn only after a keyboard/D-pad interaction, as the web's
// `:focus-visible` behaves. A pointer press focuses without a ring.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { Button } from '../src/primitives/Button.jsx';
import {
  focusVisible,
  hideFocusVisible,
  useFocusManager,
} from '@solid-multiplatform/platform/focusManager';
import { createScenePointer } from '../src/sdk/input.js';
import { renderer } from './setup.js';
import { KeyTarget, flush } from './contract-focus-helpers.js';

v.describe('focusVisibility', () => {
  v.afterEach(() => lng.resetCapabilities());

  v.it(
    'auto: a pointer click focuses without a ring; a key turns it on',
    async () => {
      lng.setCapabilities('web');
      hideFocusVisible();
      let app!: lng.ElementNode;
      let first!: lng.ElementNode;
      let second!: lng.ElementNode;
      const key = new KeyTarget();
      const dispose = renderer.render(() => {
        useFocusManager(undefined, key);
        return (
          <view ref={app} width={200} height={100}>
            <view
              ref={first}
              x={0}
              width={100}
              height={100}
              onEnter={() => {}}
              style={{ color: 0x111111ff, $focus: { color: 0xff0000ff } }}
            />
            <view
              ref={second}
              x={100}
              width={100}
              height={100}
              onEnter={() => {}}
              style={{ color: 0x222222ff, $focus: { color: 0xff0000ff } }}
            />
          </view>
        );
      });
      await flush();
      const pointer = createScenePointer(app);
      pointer.down(1, { x: 50, y: 50 });
      pointer.up(1, { x: 50, y: 50 });
      await flush();
      v.expect(lng.activeElement()).toBe(first);
      v.expect(focusVisible()).toBe(false);
      v.expect(first.states.has(lng.Config.focusStateKey)).toBe(false);
      v.expect(first.color).toBe(0x111111ff);

      // A keyboard interaction draws the ring for the focus that is already
      // there, without moving it.
      key.down('ArrowLeft');
      key.up('ArrowLeft');
      await flush();
      v.expect(focusVisible()).toBe(true);
      v.expect(lng.activeElement()).toBe(first);
      v.expect(first.states.has(lng.Config.focusStateKey)).toBe(true);
      v.expect(first.color).toBe(0xff0000ff);

      // A pointer press hides it again and focuses what it clicked.
      pointer.down(1, { x: 150, y: 50 });
      pointer.up(1, { x: 150, y: 50 });
      await flush();
      v.expect(lng.activeElement()).toBe(second);
      v.expect(focusVisible()).toBe(false);
      v.expect(first.states.has(lng.Config.focusStateKey)).toBe(false);
      v.expect(second.states.has(lng.Config.focusStateKey)).toBe(false);
      pointer.dispose();
      dispose();
    },
  );

  v.it(
    'always: a TV target draws focus from launch and after a click',
    async () => {
      lng.setCapabilities('roku');
      let node!: lng.ElementNode;
      const key = new KeyTarget();
      const dispose = renderer.render(() => {
        useFocusManager(undefined, key);
        return (
          <view
            ref={node}
            width={100}
            height={100}
            style={{ color: 0x111111ff, $focus: { color: 0xff0000ff } }}
          />
        );
      });
      await flush();
      node.setFocus();
      await flush();
      v.expect(node.states.has(lng.Config.focusStateKey)).toBe(true);

      // The pointer modality does not hide it: a TV has no pointer.
      hideFocusVisible();
      v.expect(node.states.has(lng.Config.focusStateKey)).toBe(true);
      dispose();
    },
  );

  v.it('never: focus exists but is not drawn', async () => {
    lng.setCapabilities('web', { focusVisibility: 'never' });
    let node!: lng.ElementNode;
    const key = new KeyTarget();
    const dispose = renderer.render(() => {
      useFocusManager(undefined, key);
      return (
        <view
          ref={node}
          width={100}
          height={100}
          style={{ color: 0x111111ff, $focus: { color: 0xff0000ff } }}
        />
      );
    });
    await flush();
    node.setFocus();
    key.down('ArrowRight');
    key.up('ArrowRight');
    await flush();
    v.expect(lng.activeElement()).toBe(node);
    v.expect(node.states.has(lng.Config.focusStateKey)).toBe(false);
    v.expect(node.color).toBe(0x111111ff);
    dispose();
  });

  v.it(
    'a focused Button draws its $focus ring only when focus is visible',
    async () => {
      lng.setCapabilities('desktop');
      hideFocusVisible();
      let button!: lng.ElementNode;
      const key = new KeyTarget();
      const dispose = renderer.render(() => {
        useFocusManager(undefined, key);
        return (
          <Button
            ref={(node) => {
              button = node as lng.ElementNode;
            }}
            onPress={() => {}}
          >
            Play
          </Button>
        );
      });
      await flush();
      button.setFocus();
      await flush();
      v.expect(lng.activeElement()).toBe(button);
      v.expect(button.states.has(lng.Config.focusStateKey)).toBe(false);

      key.down('ArrowDown');
      key.up('ArrowDown');
      await flush();
      v.expect(button.states.has(lng.Config.focusStateKey)).toBe(true);
      dispose();
    },
  );
});
