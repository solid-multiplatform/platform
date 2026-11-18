import * as v from 'vitest';
import {
  createPagedList,
  createPullToRefresh,
  createSelection,
} from '../src/sdk/list.js';
import { ListState } from '../src/primitives/ListState.js';
import * as lng from '@solid-multiplatform/platform';
import { renderer, waitForUpdate } from './setup.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

v.describe('createSelection', () => {
  v.it('selects one value at a time in single mode', () => {
    const changes: number[][] = [];
    const selection = createSelection<number>({
      onChange: (selected) => changes.push([...selected]),
    });
    selection.select(1);
    selection.select(2);
    v.expect(selection.selected()).toEqual([2]);
    v.expect(selection.isSelected(1)).toBe(false);
    v.expect(selection.isSelected(2)).toBe(true);
    selection.toggle(2);
    v.expect(selection.size()).toBe(0);
    selection.select(3);
    selection.clear();
    v.expect(changes).toEqual([[1], [2], [], [3], []]);
  });

  v.it('adds and removes values in multiple mode', () => {
    const selection = createSelection<string>({ mode: 'multiple' });
    selection.toggle('a');
    selection.toggle('b');
    selection.toggle('a');
    selection.select('b');
    v.expect(selection.selected()).toEqual(['b']);
    selection.set(['x', 'y']);
    v.expect(selection.selected()).toEqual(['x', 'y']);
    selection.set(['only-one']);
    v.expect(selection.selected()).toEqual(['only-one']);
  });

  v.it('uses a custom equality function', () => {
    const selection = createSelection({
      mode: 'multiple',
      equals: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
    });
    selection.select('Ada');
    v.expect(selection.isSelected('ada')).toBe(true);
    selection.toggle('ADA');
    v.expect(selection.size()).toBe(0);
  });
});

v.describe('createPagedList', () => {
  v.it('appends pages and stops on a short page', async () => {
    const pages: number[][] = [[1, 2], [3, 4], [5]];
    let calls = 0;
    const list = createPagedList<number>({
      pageSize: 2,
      fetchPage: async (page) => {
        calls++;
        return pages[page] ?? [];
      },
    });
    await list.loadMore();
    v.expect(list.items()).toEqual([1, 2]);
    v.expect(list.page()).toBe(1);
    v.expect(list.end()).toBe(false);
    await list.loadMore();
    v.expect(list.items()).toEqual([1, 2, 3, 4]);
    await list.loadMore();
    v.expect(list.items()).toEqual([1, 2, 3, 4, 5]);
    v.expect(list.end()).toBe(true);
    await list.loadMore();
    v.expect(calls).toBe(3);
    list.dispose();
  });

  v.it('refreshes from the first page and keeps items on error', async () => {
    let version = 0;
    let fail = false;
    const list = createPagedList<number>({
      pageSize: 2,
      fetchPage: async (page) => {
        if (fail) throw new Error('network');
        if (page === 0) return version === 0 ? [1, 2] : [9, 10];
        return [];
      },
    });
    await list.loadMore();
    version = 1;
    await list.refresh();
    v.expect(list.items()).toEqual([9, 10]);
    v.expect(list.page()).toBe(1);
    v.expect(list.refreshing()).toBe(false);

    fail = true;
    await list.refresh();
    v.expect((list.error() as Error).message).toBe('network');
    v.expect(list.items()).toEqual([9, 10]);
    v.expect(list.refreshing()).toBe(false);

    list.reset();
    v.expect(list.items()).toEqual([]);
    v.expect(list.page()).toBe(0);
    list.dispose();
  });

  v.it('discards a stale page that resolves after a refresh', async () => {
    let resolveFirst!: (value: number[]) => void;
    let calls = 0;
    const list = createPagedList<number>({
      pageSize: 2,
      fetchPage: async () => {
        calls++;
        if (calls === 1) {
          return new Promise<number[]>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return [9, 10];
      },
    });
    const stale = list.loadMore();
    await list.refresh();
    v.expect(list.items()).toEqual([9, 10]);
    resolveFirst([1, 2]);
    await stale;
    v.expect(list.items()).toEqual([9, 10]);
    v.expect(list.page()).toBe(1);
    list.dispose();
  });
});

v.describe('createPullToRefresh', () => {
  v.it(
    'triggers refresh only past the threshold and ignores cancels',
    async () => {
      let refreshes = 0;
      let finish!: () => void;
      const pull = createPullToRefresh({
        threshold: 50,
        onRefresh: () => {
          refreshes++;
          return new Promise<void>((resolve) => (finish = resolve));
        },
      });
      const origin = { x: 0, y: 100 };
      pull.drag('start', origin, origin);
      pull.drag('move', { x: 0, y: 130 }, origin);
      v.expect(pull.distance()).toBe(30);
      pull.drag('end', { x: 0, y: 130 }, origin);
      v.expect(refreshes).toBe(0);
      v.expect(pull.distance()).toBe(0);

      pull.drag('start', origin, origin);
      pull.drag('move', { x: 0, y: 190 }, origin);
      v.expect(pull.distance()).toBe(90);
      pull.drag('end', { x: 0, y: 190 }, origin);
      v.expect(refreshes).toBe(1);
      v.expect(pull.refreshing()).toBe(true);
      finish();
      await tick();
      v.expect(pull.refreshing()).toBe(false);
      v.expect(pull.distance()).toBe(0);

      pull.drag('start', origin, origin);
      pull.drag('move', { x: 0, y: 190 }, origin);
      pull.drag('cancel', { x: 0, y: 190 }, origin);
      v.expect(pull.distance()).toBe(0);
      v.expect(refreshes).toBe(1);
    },
  );
});

v.describe('ListState', () => {
  const texts = (node: unknown): string[] => {
    const current = node as { text?: string; children?: readonly unknown[] };
    if (typeof current.text === 'string') return [current.text];
    return (current.children ?? []).flatMap((child) => texts(child));
  };

  v.it('renders the default copy and an action', async () => {
    let action = 0;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <ListState
          status="empty"
          width={400}
          height={300}
          actionLabel="Add item"
          onAction={() => action++}
        />
      </view>
    ));
    await waitForUpdate();
    const rendered = texts(renderer.rootNode).join('|');
    v.expect(rendered).toContain('Nothing here yet');
    v.expect(rendered).toContain('Items you add will show up here.');
    v.expect(rendered).toContain('Add item');

    const state = renderer.rootNode.children[0]!.children[0] as lng.ElementNode;
    const button = state.children.find(
      (child) => lng.isElementNode(child) && child.onMouseClick,
    ) as lng.ElementNode;
    button.onMouseClick?.(new MouseEvent('click'), button);
    v.expect(action).toBe(1);
    dispose();
  });

  v.it('renders loading and error statuses', async () => {
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <ListState status="loading" width={400} height={300} />
        <ListState
          status="error"
          width={400}
          height={300}
          title="Offline"
          message="Try again later"
        />
      </view>
    ));
    await waitForUpdate();
    const rendered = texts(renderer.rootNode).join('|');
    v.expect(rendered).toContain('Loading');
    v.expect(rendered).toContain('Offline');
    v.expect(rendered).toContain('Try again later');
    dispose();
  });
});
