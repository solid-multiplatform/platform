/**
 * Contract tests: selectable text on the DOM backend. A real scene pointer
 * drives the drag (the same hit test and slop a host feeds), the highlight
 * quads are read off the wrapper, and the keyboard path copies through the
 * clipboard service. jsdom has no layout, so text is measured 10 px per
 * character and 20 px per line, as contract-text.test.tsx does.
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import { rootNode, type ElementNode } from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/primitives';
import { createScenePointer } from '../src/sdk/input.js';
import { SelectableText } from '../src/primitives/SelectableText.jsx';
import { renderer, waitForUpdate } from './setup.js';

const CHAR_W = 10;
const LINE_H = 20;
const TEXT = 'Hello wonderful world';

function mockTextMeasure() {
  return v.vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const text = (
        this as unknown as { _node?: { props?: { text?: unknown } } }
      )._node?.props?.text;
      const isText = typeof text === 'string';
      const width = isText ? text.length * CHAR_W : 0;
      const height = isText ? LINE_H : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {},
      } as DOMRect;
    });
}

/** The highlight views: every child of the wrapper before the <text>. */
function highlights(wrapper: ElementNode): ElementNode[] {
  return wrapper.children.filter(
    (child): child is ElementNode =>
      'lng' in child && (child.lng as { text?: string }).text === undefined,
  );
}

const disposeKeys = s.createRoot((dispose) => {
  useFocusManager();
  return dispose;
});

v.afterAll(() => {
  disposeKeys();
  v.vi.restoreAllMocks();
});

/** Renders one selectable paragraph; returns its wrapper and list of changes. */
function mountSelectable() {
  const changes: (string | null)[] = [];
  const dispose = renderer.render(() => (
    <SelectableText
      width={TEXT.length * CHAR_W}
      height={LINE_H}
      onSelectionChange={(value: string | null) => changes.push(value)}
    >
      {TEXT}
    </SelectableText>
  ));
  const wrapper = rootNode.children[
    rootNode.children.length - 1
  ] as ElementNode;
  return { dispose, wrapper, changes };
}

/** Drags from character boundary `from` to `to` on the first line. */
async function drag(
  pointer: ReturnType<typeof createScenePointer>,
  from: number,
  to: number,
) {
  pointer.down(1, { x: from * CHAR_W + CHAR_W / 2, y: LINE_H / 2 });
  pointer.move(1, { x: to * CHAR_W + CHAR_W / 2, y: LINE_H / 2 });
  pointer.up(1, { x: to * CHAR_W + CHAR_W / 2, y: LINE_H / 2 });
  await waitForUpdate();
}

v.describe('contract: selectable text', () => {
  v.it('a drag selects from the down point to the current point', async () => {
    mockTextMeasure();
    const { dispose, wrapper, changes } = mountSelectable();
    await waitForUpdate();
    const pointer = createScenePointer(rootNode);
    await drag(pointer, 5, 15);

    v.expect(changes[changes.length - 1]).toBe(TEXT.slice(5, 15));
    const quads = highlights(wrapper);
    v.expect(quads).toHaveLength(1);
    v.expect(quads[0]!.x).toBeCloseTo(5 * CHAR_W, 3);
    v.expect(quads[0]!.width).toBeCloseTo(10 * CHAR_W, 3);
    v.expect(quads[0]!.height).toBeCloseTo(LINE_H, 3);
    pointer.dispose();
    dispose();
  });

  v.it(
    'a click without a drag clears the selection and its quads',
    async () => {
      mockTextMeasure();
      const { dispose, wrapper, changes } = mountSelectable();
      await waitForUpdate();
      const pointer = createScenePointer(rootNode);
      await drag(pointer, 5, 15);
      v.expect(highlights(wrapper)).toHaveLength(1);

      pointer.down(2, { x: 5, y: LINE_H / 2 });
      pointer.up(2, { x: 5, y: LINE_H / 2 });
      await waitForUpdate();

      v.expect(changes[changes.length - 1]).toBeNull();
      v.expect(highlights(wrapper)).toHaveLength(0);
      pointer.dispose();
      dispose();
    },
  );

  v.it('a double click selects the word under it', async () => {
    mockTextMeasure();
    const { dispose, changes } = mountSelectable();
    await waitForUpdate();
    const pointer = createScenePointer(rootNode);
    const x = 6 * CHAR_W + CHAR_W / 2; // inside "wonderful"
    pointer.down(3, { x, y: LINE_H / 2 });
    pointer.up(3, { x, y: LINE_H / 2 });
    pointer.down(4, { x, y: LINE_H / 2 });
    pointer.up(4, { x, y: LINE_H / 2 });
    await waitForUpdate();

    v.expect(changes[changes.length - 1]).toBe('wonderful');
    pointer.dispose();
    dispose();
  });

  v.it('Shift+Arrow extends by character and Escape clears', async () => {
    mockTextMeasure();
    const { dispose, changes } = mountSelectable();
    await waitForUpdate();
    const pointer = createScenePointer(rootNode);
    await drag(pointer, 5, 15);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }),
    );
    await waitForUpdate();
    v.expect(changes[changes.length - 1]).toBe(TEXT.slice(5, 16));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await waitForUpdate();
    v.expect(changes[changes.length - 1]).toBeNull();
    pointer.dispose();
    dispose();
  });

  v.it(
    'Ctrl+C copies the selection through the clipboard service',
    async () => {
      mockTextMeasure();
      const writeText = v.vi.fn(async () => {});
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText, readText: async () => '' },
      });
      const { dispose, changes } = mountSelectable();
      await waitForUpdate();
      const pointer = createScenePointer(rootNode);
      await drag(pointer, 5, 15);

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
      );
      await v.vi.waitFor(() => {
        v.expect(writeText).toHaveBeenCalledWith(TEXT.slice(5, 15));
      });
      v.expect(changes[changes.length - 1]).toBe(TEXT.slice(5, 15));
      pointer.dispose();
      dispose();
      delete (navigator as { clipboard?: unknown }).clipboard;
    },
  );
});
