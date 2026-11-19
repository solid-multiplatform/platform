// The screen-history regression in a real browser engine: focus a keyed card,
// open a detail route, reorder the source data in `restore`, and go Back with
// the host's Back key. The same card must be focused even though its index
// changed. Back is delivered through the host dispatcher as a real Escape
// keydown, and the host history performs the traversal.
import { expect, test, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { activeElement, type ElementNode } from '@solid-multiplatform/platform';
import {
  createScreenHistory,
  List,
  type ScreenEntry,
  type ScreenHistory,
} from '@solid-multiplatform/platform/app';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { settle } from './conformance-harness';

interface Card {
  id: string;
}

const card = (id: string): Card => ({ id });

test('Back restores focus to the same card key after reordering', async () => {
  // The host's browser history starts at the cards screen.
  window.location.hash = '#/cards';
  document.body.innerHTML =
    '<div id="app" style="width:1920px;height:1080px"></div>';
  const surface = document.getElementById('app')!;
  const [items, setItems] = createSignal<Card[]>([
    card('a'),
    card('b'),
    card('c'),
  ]);
  const nodes = new Map<string, ElementNode>();
  const restored: Array<{ reason: string; stale: boolean }> = [];
  let screen!: ScreenHistory<{ tab: string }>;

  function App() {
    screen = createScreenHistory<{ tab: string }>({
      capture: () => ({ tab: 'cards' }),
      // The app revalidates (reorders) and commits new data before resolving.
      restore: (entry: ScreenEntry<{ tab: string }>, context) => {
        restored.push({ reason: context.reason, stale: entry.stale });
        setItems([card('c'), card('a'), card('b')]);
      },
      fallbackPath: '/cards',
      onBackEmpty: () => {},
    });
    return (
      <view width={1920} height={1080}>
        <Show
          when={screen.current().path === '/detail'}
          fallback={
            <List
              focusKey="cards"
              each={items()}
              itemKey={(item: Card) => item.id}
            >
              {(item: Card) => (
                <view
                  id={item.id}
                  width={300}
                  height={200}
                  ref={(node: ElementNode) => nodes.set(item.id, node)}
                />
              )}
            </List>
          }
        >
          <view id="detail" width={1920} height={1080} autofocus />
        </Show>
      </view>
    );
  }

  const stop = startApp(
    webHost({ root: surface, namespace: 'screen-history-test' }),
    () => <App />,
    {},
  ) as () => void;

  try {
    await settle();
    nodes.get('b')!.setFocus();
    await settle();
    expect(activeElement()?.id).toBe('b');

    // Open a detail route through the tracked navigation.
    screen.push('/detail', { tab: 'detail' });
    await settle();
    expect(activeElement()?.id).toBe('detail');

    // Back is the real Escape key, delivered to the host's dispatcher. The
    // focus path declines, screen history pops the host history, and restore
    // reorders the data before focus is applied.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(screen.current().path).toBe('/cards');
      expect(activeElement()?.id).toBe('b');
    });
    expect(restored).toEqual([{ reason: 'back', stale: false }]);
    // The card is now third, so focus was restored by key, not by index.
    expect(items().findIndex((item) => item.id === 'b')).toBe(2);
    expect(nodes.get('b')).toBe(activeElement());
  } finally {
    stop();
    window.location.hash = '';
  }
});
