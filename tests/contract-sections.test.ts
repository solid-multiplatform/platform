import * as v from 'vitest';
import {
  createReorder,
  createSwipeActions,
  flattenSections,
  moveItem,
  sectionListHeight,
  stickyHeaderAt,
  visibleSectionRows,
} from '../src/sdk/sections.js';

const sections = [
  { title: 'A', items: ['a0', 'a1'] },
  { title: 'B', items: ['b0'] },
];

v.describe('section rows', () => {
  v.it('flattens headers and items into offsets', () => {
    const rows = flattenSections(sections, {
      headerSize: 40,
      itemSize: 50,
    });
    v.expect(
      rows.map((row) =>
        row.type === 'header'
          ? `H:${row.title}:${row.offset}`
          : `I:${row.item}:${row.offset}`,
      ),
    ).toEqual(['H:A:0', 'I:a0:40', 'I:a1:90', 'H:B:140', 'I:b0:180']);
    v.expect(sectionListHeight(rows)).toBe(230);
  });

  v.it('supports per-item sizes', () => {
    const rows = flattenSections(sections, {
      headerSize: 10,
      itemSize: (_item, index) => (index === 0 ? 20 : 30),
    });
    v.expect(rows[1]).toMatchObject({ item: 'a0', offset: 10, size: 20 });
    v.expect(rows[2]).toMatchObject({ item: 'a1', offset: 30, size: 30 });
    v.expect(sectionListHeight(rows)).toBe(90);
  });

  v.it('resolves sticky headers and visible rows', () => {
    const rows = flattenSections(sections, {
      headerSize: 40,
      itemSize: 50,
    });
    v.expect(stickyHeaderAt(rows, 0)?.title).toBe('A');
    v.expect(stickyHeaderAt(rows, 139)?.title).toBe('A');
    v.expect(stickyHeaderAt(rows, 140)?.title).toBe('B');
    v.expect(stickyHeaderAt(rows, 500)?.title).toBe('B');

    v.expect(
      visibleSectionRows(rows, 90, 60).map((row) =>
        row.type === 'header' ? row.title : row.item,
      ),
    ).toEqual(['a1', 'B']);
    v.expect(
      visibleSectionRows(rows, 90, 60, 20).map((row) =>
        row.type === 'header' ? row.title : row.item,
      ),
    ).toEqual(['a0', 'a1', 'B']);
    v.expect(visibleSectionRows(rows, 0, 10)).toHaveLength(1);
  });
});

v.describe('swipe actions', () => {
  v.it('commits start/end actions past the threshold', () => {
    const actions: string[] = [];
    const swipe = createSwipeActions({
      threshold: 80,
      max: 120,
      onAction: (direction) => actions.push(direction),
    });
    const origin = { x: 0, y: 10 };
    swipe.drag('start', origin, origin);
    swipe.drag('move', { x: 200, y: 10 }, origin);
    v.expect(swipe.offset()).toBe(120);
    swipe.drag('end', { x: 200, y: 10 }, origin);
    v.expect(actions).toEqual(['start']);
    v.expect(swipe.offset()).toBe(80);
    v.expect(swipe.direction()).toBe('start');
    v.expect(swipe.open()).toBe(true);

    swipe.close();
    v.expect(swipe.offset()).toBe(0);
    v.expect(swipe.open()).toBe(false);

    swipe.drag('start', origin, origin);
    swipe.drag('move', { x: -70, y: 10 }, origin);
    swipe.drag('end', { x: -70, y: 10 }, origin);
    v.expect(actions).toEqual(['start']);
    v.expect(swipe.offset()).toBe(0);
    v.expect(swipe.direction()).toBeNull();

    swipe.drag('start', origin, origin);
    swipe.drag('move', { x: -100, y: 10 }, origin);
    swipe.drag('end', { x: -100, y: 10 }, origin);
    v.expect(actions).toEqual(['start', 'end']);
    v.expect(swipe.offset()).toBe(-80);
    v.expect(swipe.direction()).toBe('end');

    swipe.drag('start', origin, origin);
    swipe.drag('move', { x: -100, y: 10 }, origin);
    swipe.drag('cancel', { x: -100, y: 10 }, origin);
    v.expect(swipe.offset()).toBe(0);
  });
});

v.describe('reorder', () => {
  v.it('moves items and clamps invalid indexes', () => {
    v.expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    v.expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    v.expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    v.expect(moveItem(['a', 'b', 'c'], -1, 2)).toEqual(['a', 'b', 'c']);
    v.expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'b', 'c']);
  });

  v.it('tracks a drag and returns the drop move once', () => {
    const reorder = createReorder();
    v.expect(reorder.drop()).toBeUndefined();
    reorder.start(1);
    reorder.hover(0);
    reorder.hover(2);
    v.expect(reorder.from()).toBe(1);
    v.expect(reorder.over()).toBe(2);
    v.expect(reorder.drop()).toEqual({ from: 1, to: 2 });
    v.expect(reorder.from()).toBeNull();
    v.expect(reorder.over()).toBeNull();

    reorder.start(1);
    reorder.hover(1);
    v.expect(reorder.drop()).toBeUndefined();
    reorder.start(2);
    reorder.hover(0);
    reorder.cancel();
    v.expect(reorder.drop()).toBeUndefined();
  });
});
