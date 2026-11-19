import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { DatePicker } from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';
import { flush, mount } from './contract-focus-helpers.js';

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

const findAll = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] => {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
};

v.describe('DatePicker', () => {
  v.it('selects a day and commits the date', async () => {
    const [open, setOpen] = createSignal(true);
    const selected: Date[] = [];
    const dispose = renderer.render(() => (
      <DatePicker
        visible={open}
        value={new Date(2026, 0, 15)}
        onChange={(date) => selected.push(date)}
        onRequestClose={() => setOpen(false)}
      />
    ));
    await waitForUpdate();
    v.expect(texts(renderer.rootNode).join('|')).toContain('January 2026');

    const day = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' && texts(node).includes('20'),
    ).at(-1)!;
    day.onMouseClick?.(new MouseEvent('click'), day);
    await waitForUpdate();

    const done = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' && texts(node).includes('Done'),
    ).at(-1)!;
    done.onMouseClick?.(new MouseEvent('click'), done);
    await waitForUpdate();
    v.expect(selected).toHaveLength(1);
    v.expect(selected[0]!.getFullYear()).toBe(2026);
    v.expect(selected[0]!.getMonth()).toBe(0);
    v.expect(selected[0]!.getDate()).toBe(20);
    v.expect(open()).toBe(false);
    dispose();
  });

  v.it('navigates months and edits time', async () => {
    const selected: Date[] = [];
    const dispose = renderer.render(() => (
      <DatePicker
        visible
        withTime
        value={new Date(2026, 0, 15, 10, 30)}
        onChange={(date) => selected.push(date)}
      />
    ));
    await waitForUpdate();

    const next = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' && texts(node).includes('>'),
    ).at(-1)!;
    next.onMouseClick?.(new MouseEvent('click'), next);
    await waitForUpdate();
    v.expect(texts(renderer.rootNode).join('|')).toContain('February 2026');

    const plus = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' &&
        texts(node).join('') === '+',
    );
    v.expect(plus.length).toBeGreaterThanOrEqual(2);
    plus[0]!.onMouseClick?.(new MouseEvent('click'), plus[0]!);
    plus[1]!.onMouseClick?.(new MouseEvent('click'), plus[1]!);
    await waitForUpdate();

    const done = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' && texts(node).includes('Done'),
    ).at(-1)!;
    done.onMouseClick?.(new MouseEvent('click'), done);
    v.expect(selected[0]!.getHours()).toBe(11);
    v.expect(selected[0]!.getMinutes()).toBe(35);
    dispose();
  });

  v.it('navigates and picks a date with the keyboard only', async () => {
    const selected: Date[] = [];
    const { target, dispose } = await mount(() => (
      <DatePicker
        visible
        value={new Date(2026, 0, 15)}
        onChange={(date) => selected.push(date)}
      />
    ));
    await flush();
    await flush();
    const activeText = () => texts(lng.activeElement()).join('');
    v.expect(activeText()).toBe('15');

    // Move to the 16th and pick it: navigation must keep working afterwards
    // (the picker stays open; Done commits).
    target.down('ArrowRight');
    target.up('ArrowRight');
    await flush();
    v.expect(activeText()).toBe('16');
    target.down('Enter');
    target.up('Enter');
    await flush();
    target.down('ArrowRight');
    target.up('ArrowRight');
    await flush();
    v.expect(activeText()).toBe('17');

    // Focus on the grid container itself (its days were not inserted when
    // the dialog took focus): every arrow used to be rejected because the
    // grid is not one of its own children. It now starts from the chosen day.
    const grid = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onLeft === 'function' &&
        typeof node.onRight === 'function' &&
        typeof node.onUp === 'function' &&
        typeof node.onDown === 'function' &&
        typeof node.onEnter === 'function',
    )[0]!;
    lng.setActiveElementCore(grid);
    await flush();
    v.expect(lng.activeElement()).toBe(grid);
    target.down('ArrowRight');
    target.up('ArrowRight');
    await flush();
    v.expect(activeText()).toBe('17');
    v.expect(selected).toEqual([]);
    dispose();
  });
});
