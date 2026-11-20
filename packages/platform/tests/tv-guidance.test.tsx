// TV behaviour against Apple's tvOS guidance, exercised through the public
// surface with real key events.
//
// Sources (developer.apple.com/design/human-interface-guidelines):
//   focus-and-selection — directional focus reaches every item; when the
//     focused item disappears, focus moves to a nearby remaining item.
//   scroll-views (tvOS) — content scrolls to keep focused items visible; tvOS
//     has no separate scroll objects or indicators.
//   designing-for-tvos — the focus system is the only navigation model.
// Touch and pointer guidance on those pages does not apply to a remote-only
// TV and is deliberately not implemented here.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  Column,
  Grid,
  Modal,
  Row,
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/primitives';
import { renderer } from './setup.js';

const keys = new EventTarget();
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function press(...names: string[]) {
  for (const key of names) {
    keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
    await flush();
  }
}

async function mount(ui: () => s.JSX.Element) {
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    return ui();
  }) as unknown as () => void;
  await flush();
  return dispose;
}

const focusedId = () => lng.activeElement()?.id;

const W = 1920;
const H = 1080;

/** Whether a node is wholly inside the viewport on both axes. */
function isFullyVisible(node: lng.ElementNode): boolean {
  const n = node.lng as unknown as { absX: number; absY: number };
  return (
    n.absX >= 0 &&
    n.absY >= 0 &&
    n.absX + (node.width ?? 0) <= W &&
    n.absY + (node.height ?? 0) <= H
  );
}

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <view id={`c${i}`} width={400} height={200} />
  ));

let dispose: (() => void) | undefined;
const animationsEnabled = lng.Config.animationsEnabled;

v.beforeEach(() => {
  lng.Config.animationsEnabled = false;
  // Roku draws focus always; the removal rule is a TV rule.
  lng.setCapabilities('roku');
});
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
  lng.resetCapabilities();
});
v.afterAll(() => {
  lng.Config.animationsEnabled = animationsEnabled;
});

v.describe('tvOS scroll-into-view', () => {
  v.it('scrollToIndex brings the focused row item fully on screen', async () => {
    let row!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Row ref={row} autofocus>
          {items(10)}
        </Row>
      </view>
    ));
    (
      row as lng.ElementNode & { scrollToIndex: (i: number) => void }
    ).scrollToIndex(5);
    await flush();
    v.expect(focusedId()).toBe('c5');
    v.expect(isFullyVisible(row.children[5]!)).toBe(true);
    // It moved the least distance: c5 ends at the right edge.
    v.expect(row.x).toBe(-630);
  });

  v.it('scrollToIndex brings the focused column item fully on screen', async () => {
    let col!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Column ref={col} autofocus>
          {Array.from({ length: 10 }, (_, i) => (
            <view id={`r${i}`} width={400} height={200} />
          ))}
        </Column>
      </view>
    ));
    (
      col as lng.ElementNode & { scrollToIndex: (i: number) => void }
    ).scrollToIndex(6);
    await flush();
    v.expect(focusedId()).toBe('r6');
    v.expect(isFullyVisible(col.children[6]!)).toBe(true);
  });

  v.it(
    'a key that focuses an already selected item scrolls it back into view',
    async () => {
      const [sel, setSel] = s.createSignal(3);
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={W} height={H}>
          <Row ref={row} autofocus selected={sel()}>
            {items(10)}
          </Row>
        </view>
      ));
      await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight');
      v.expect(focusedId()).toBe('c7');
      // The app moves `selected` without touching focus.
      setSel(0);
      await flush();
      v.expect(focusedId()).toBe('c7');
      // The next Left focuses c0, which tvOS must show whole.
      await press('ArrowLeft');
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);
      v.expect(isFullyVisible(row.children[0]!)).toBe(true);
    },
  );

  v.it('default scrolling keeps a focused item visible when sizes differ', async () => {
    let col!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Column ref={col} autofocus>
          <view id="tall" width={400} height={1200} />
          <view id="short1" width={400} height={100} />
          <view id="short2" width={400} height={100} />
        </Column>
      </view>
    ));
    await press('ArrowDown');
    v.expect(focusedId()).toBe('short1');
    v.expect(isFullyVisible(col.children[1]!)).toBe(true);
    await press('ArrowDown');
    v.expect(focusedId()).toBe('short2');
    v.expect(isFullyVisible(col.children[2]!)).toBe(true);
  });
});

v.describe('tvOS focus when the focused item disappears', () => {
  v.it('a Row keeps focus on a remaining item and keeps navigating', async () => {
    const [count, setCount] = s.createSignal(4);
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Row autofocus scroll="none">
          <s.For each={Array.from({ length: count() }, (_, i) => i)}>
            {(i) => <view id={`c${i}`} width={400} height={200} />}
          </s.For>
        </Row>
      </view>
    ));
    await press('ArrowRight', 'ArrowRight');
    v.expect(focusedId()).toBe('c2');

    setCount(1);
    await flush();
    await flush();
    // The old c2 is gone; focus moved to the only remaining item.
    v.expect(focusedId()).toBe('c0');
    v.expect(lng.activeElement()?.destroyed).toBe(false);
    // The remote still works: there is nothing to the right, so it bubbles
    // without moving, and focus stays on the live item.
    await press('ArrowRight');
    v.expect(focusedId()).toBe('c0');
  });

  v.it('a Grid clamps the cursor and focuses the last remaining item', async () => {
    const [count, setCount] = s.createSignal(10);
    let grid!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Grid
          ref={grid}
          autofocus
          items={Array.from({ length: count() }, (_, i) => i)}
          columns={3}
          itemWidth={100}
          itemHeight={50}
        >
          {(p) => (
            <view
              id={`g${p.index}`}
              x={p.x}
              y={p.y}
              width={p.width}
              height={p.height}
            />
          )}
        </Grid>
      </view>
    ));
    await press('ArrowRight', 'ArrowDown');
    v.expect(focusedId()).toBe('g4');

    setCount(2);
    await flush();
    await flush();
    v.expect(focusedId()).toBe('g1');
    v.expect(lng.activeElement()?.destroyed).toBe(false);
    // Right at the end of the last row stays put instead of stranding focus.
    await press('ArrowRight');
    v.expect(focusedId()).toBe('g1');
  });

  v.it('a Modal restores to a surviving item when its trigger was removed', async () => {
    const [cards, setCards] = s.createSignal([0, 1, 2]);
    const [open, setOpen] = s.createSignal(false);
    let panel!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={W} height={H}>
        <Row autofocus scroll="none">
          <s.For each={cards()}>
            {(i) => <view id={`b${i}`} width={400} height={200} />}
          </s.For>
        </Row>
        <Modal
          visible={open}
          label="Details"
          initialFocus={() => panel}
          onRequestClose={() => setOpen(false)}
        >
          <view
            id="panel"
            ref={(node) => (panel = node as lng.ElementNode)}
            width={320}
            height={200}
          />
        </Modal>
      </view>
    ));
    await press('ArrowRight');
    v.expect(focusedId()).toBe('b1');

    setOpen(true);
    await flush();
    await flush();
    v.expect(focusedId()).toBe('panel');

    // The invoking item goes away while the dialog is open.
    setCards([0, 2]);
    await flush();
    await flush();

    setOpen(false);
    await flush();
    await flush();
    // b1's slot now holds b2; focus is not left on the destroyed b1.
    v.expect(focusedId()).toBe('b2');
    v.expect(lng.activeElement()?.destroyed).toBe(false);
  });
});
