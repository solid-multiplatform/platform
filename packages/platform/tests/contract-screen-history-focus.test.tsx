// Contract tests: keyed focus capture and restore.
//
// Focus is recorded as a path of keys, outermost first, and restored by
// walking that path against the freshly mounted screen. Data lists resolve
// item keys against their current data, so reordering never moves focus to
// the same index. No test asserts or persists an index.
import * as v from 'vitest';
import { createSignal, Show } from 'solid-js';
import { activeElement, type ElementNode } from '@solid-multiplatform/platform';
import {
  Column,
  Modal,
  Row,
  VirtualRow,
} from '@solid-multiplatform/platform/primitives';
import { List } from '@solid-multiplatform/platform/app';
import { AppShell } from '../src/app/ExitConfirm.jsx';
import { HostScope } from '../src/app/context.js';
import { createMemoryHistory } from '../src/core/history.js';
import { createBackDispatcher } from '../src/sdk/shortcuts.js';
import {
  captureFocusKeys,
  cancelExitConfirmation,
  confirmExitConfirmation,
  createScreenHistory,
  pendingExitConfirmation,
  restoreFocusKeys,
  type ScreenHistory,
} from '../src/primitives/screenHistory.js';
import { flush, mount } from './contract-focus-helpers.js';

interface Card {
  id: string;
}

const card = (id: string): Card => ({ id });

v.afterEach(() => {
  // A failed assertion before dispose() must not leave the shared exit
  // confirmation mounted for the next test.
  cancelExitConfirmation();
});

v.describe('keyed focus restore', () => {
  v.it('captures and restores a nested key path, never an index', async () => {
    const nodes = new Map<string, ElementNode>();
    const first = await mount(() => (
      <Column focusKey="rail">
        <Row focusKey="cards">
          <view
            id="a"
            focusKey="a"
            ref={(n: ElementNode) => nodes.set('a', n)}
          />
          <view
            id="b"
            focusKey="b"
            ref={(n: ElementNode) => nodes.set('b', n)}
          />
        </Row>
      </Column>
    ));
    nodes.get('b')!.setFocus();
    await flush();
    const keys = captureFocusKeys();
    v.expect(keys).toEqual(['rail', 'cards', 'b']);
    first.dispose();

    const reordered = new Map<string, ElementNode>();
    const second = await mount(() => (
      <Column focusKey="rail">
        <Row focusKey="cards">
          <view
            id="b"
            focusKey="b"
            ref={(n: ElementNode) => reordered.set('b', n)}
          />
          <view
            id="a"
            focusKey="a"
            ref={(n: ElementNode) => reordered.set('a', n)}
          />
        </Row>
      </Column>
    ));
    v.expect(restoreFocusKeys(keys!)).toBe(true);
    await flush();
    v.expect(activeElement()?.id).toBe('b');
    v.expect(reordered.get('b')).toBe(activeElement());
    second.dispose();
  });

  v.it('restores a reordered List by itemKey, not by position', async () => {
    const [items, setItems] = createSignal<Card[]>([
      card('a'),
      card('b'),
      card('c'),
    ]);
    const nodes = new Map<string, ElementNode>();
    const first = await mount(() => (
      <List focusKey="cards" each={items()} itemKey={(item: Card) => item.id}>
        {(item: Card) => (
          <view id={item.id} ref={(n: ElementNode) => nodes.set(item.id, n)} />
        )}
      </List>
    ));
    nodes.get('b')!.setFocus();
    await flush();
    const keys = captureFocusKeys();
    v.expect(keys).toEqual(['cards', 'b']);
    first.dispose();

    // The source data is reordered before the screen is rebuilt.
    setItems([card('c'), card('a'), card('b')]);
    const rebuilt = new Map<string, ElementNode>();
    const second = await mount(() => (
      <List focusKey="cards" each={items()} itemKey={(item: Card) => item.id}>
        {(item: Card) => (
          <view
            id={item.id}
            ref={(n: ElementNode) => rebuilt.set(item.id, n)}
          />
        )}
      </List>
    ));
    v.expect(restoreFocusKeys(keys!)).toBe(true);
    await flush();
    v.expect(activeElement()?.id).toBe('b');
    v.expect(rebuilt.get('b')).toBe(activeElement());
    second.dispose();
  });

  v.it('mounts and focuses an off-window virtual item by key', async () => {
    const items = Array.from({ length: 100 }, (_, i) => card('i' + i));
    const first = await mount(() => (
      <VirtualRow
        focusKey="virtual"
        each={items}
        displaySize={3}
        itemKey={(item: Card) => item.id}
      >
        {(item) => <view id={item().id} />}
      </VirtualRow>
    ));
    // Simulate a captured path from the same screen before it was rebuilt.
    v.expect(restoreFocusKeys(['virtual', 'i50'])).toBe(true);
    await flush();
    await flush();
    v.expect(activeElement()?.id).toBe('i50');
    first.dispose();
  });

  v.it(
    'falls back to the declared initial focus when a key is gone',
    async () => {
      let initial!: ElementNode;
      const handle = await mount(() => (
        <Column focusKey="cards">
          <view
            id="initial"
            focusKey="initial"
            autofocus
            ref={(n: ElementNode) => (initial = n)}
          />
          <view id="other" focusKey="other" />
        </Column>
      ));
      await flush();
      v.expect(activeElement()).toBe(initial);
      v.expect(restoreFocusKeys(['cards', 'missing'])).toBe(false);
      v.expect(activeElement()).toBe(initial);
      handle.dispose();
    },
  );

  v.it('captures nothing when no keyed element is focused', async () => {
    let plain!: ElementNode;
    const handle = await mount(() => (
      <view id="plain" ref={(n: ElementNode) => (plain = n)} />
    ));
    plain.setFocus();
    await flush();
    v.expect(captureFocusKeys()).toBeUndefined();
    handle.dispose();
  });

  v.it('Back runs the precedence chain with exactly one consumer', async () => {
    const dispatcher = createBackDispatcher();
    const navigation = v.vi.fn(() => true);
    dispatcher.onBack(navigation);
    const [open, setOpen] = createSignal(true);
    const closed = v.vi.fn();
    const scene = await mount(() => (
      <Modal
        visible={open()}
        label="Back"
        onRequestClose={() => {
          closed();
          setOpen(false);
        }}
      >
        <view width={300} height={100} />
      </Modal>
    ));
    // The modal takes the press: navigation never runs.
    v.expect(dispatcher.handle()).toBe(true);
    v.expect(closed).toHaveBeenCalledTimes(1);
    v.expect(navigation).not.toHaveBeenCalled();
    await flush();
    v.expect(open()).toBe(false);
    // The same press count after it: one traversal, one consumer.
    v.expect(dispatcher.handle()).toBe(true);
    v.expect(closed).toHaveBeenCalledTimes(1);
    v.expect(navigation).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  v.it(
    'a beforeFocus handler consumes Back while a modal is open',
    async () => {
      const dispatcher = createBackDispatcher();
      const cancelled = v.vi.fn(() => true);
      dispatcher.push(cancelled, { beforeFocus: true });
      const navigation = v.vi.fn(() => true);
      dispatcher.onBack(navigation);
      const [open] = createSignal(true);
      const closed = v.vi.fn();
      const scene = await mount(() => (
        <Modal visible={open()} label="Back" onRequestClose={closed}>
          <view width={300} height={100} />
        </Modal>
      ));
      v.expect(dispatcher.handle()).toBe(true);
      v.expect(cancelled).toHaveBeenCalledTimes(1);
      v.expect(closed).not.toHaveBeenCalled();
      v.expect(navigation).not.toHaveBeenCalled();
      scene.dispose();
    },
  );

  v.it(
    "the shell's exit confirmation takes Back before the root exit",
    async () => {
      const exit = v.vi.fn();
      const dispatcher = createBackDispatcher({ onExit: exit });
      const history = createMemoryHistory('/');
      let screen!: ScreenHistory<Record<string, never>>;
      const Shell = () => {
        screen = createScreenHistory<Record<string, never>>({
          capture: () => ({}),
          restore: () => undefined,
          fallbackPath: '/',
          onBackEmpty: 'confirm-exit',
        });
        return (
          <AppShell>
            <view width={100} height={40} autofocus />
          </AppShell>
        );
      };
      const scene = await mount(() => (
        <HostScope.Provider value={{ history, back: dispatcher, exit }}>
          <Shell />
        </HostScope.Provider>
      ));
      await flush();
      // Back at the root opens the shared Alert, not the exit.
      screen.back();
      await flush();
      v.expect(exit).not.toHaveBeenCalled();
      v.expect(pendingExitConfirmation()).toBeTypeOf('function');
      // Back while it is open is the Alert's own: it cancels and consumes.
      v.expect(dispatcher.handle()).toBe(true);
      await flush();
      v.expect(pendingExitConfirmation()).toBeUndefined();
      v.expect(exit).not.toHaveBeenCalled();
      v.expect(screen.current().path).toBe('/');
      // Open it again and confirm: the exit runs, once.
      screen.back();
      await flush();
      confirmExitConfirmation();
      v.expect(exit).toHaveBeenCalledTimes(1);
      scene.dispose();
    },
  );

  v.it('a traversal remounts the route, never reusing a node', async () => {
    const history = createMemoryHistory('/');
    const nodes: ElementNode[] = [];
    const reasons: string[] = [];
    let screen!: ScreenHistory<Record<string, never>>;
    const Route = () => (
      <view
        width={100}
        height={40}
        autofocus
        ref={(node: ElementNode) => nodes.push(node)}
      />
    );
    const Inner = () => {
      screen = createScreenHistory<Record<string, never>>({
        capture: () => ({}),
        restore: (_entry, context) => {
          reasons.push(context.reason);
        },
        fallbackPath: '/',
      });
      return (
        <Show when={screen.current().path === '/detail'} fallback={<Route />}>
          <Route />
        </Show>
      );
    };
    const scene = await mount(() => (
      <HostScope.Provider value={{ history }}>
        <Inner />
      </HostScope.Provider>
    ));
    v.expect(nodes).toHaveLength(1);
    screen.push('/detail');
    await flush();
    v.expect(nodes).toHaveLength(2);
    screen.back();
    await flush();
    // Every traversal rebuilt the route: three mounts, three distinct nodes.
    v.expect(nodes).toHaveLength(3);
    v.expect(new Set(nodes).size).toBe(3);
    v.expect(reasons).toEqual(['back']);
    scene.dispose();
  });

  v.it('a late restore cannot focus a newer screen', async () => {
    const history = createMemoryHistory('/');
    const nodes = new Map<string, ElementNode>();
    let release!: () => void;
    let screen!: ScreenHistory<Record<string, never>>;
    const Inner = () => {
      screen = createScreenHistory<Record<string, never>>({
        capture: () => ({}),
        restore: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        fallbackPath: '/',
      });
      return (
        <Show
          when={screen.current().path === '/away'}
          fallback={
            <view
              focusKey="late"
              width={100}
              height={40}
              ref={(node: ElementNode) => nodes.set('home', node)}
            />
          }
        >
          <Column>
            <view
              focusKey="late"
              width={100}
              height={40}
              ref={(node: ElementNode) => nodes.set('away-late', node)}
            />
            <view
              width={100}
              height={40}
              autofocus
              ref={(node: ElementNode) => nodes.set('away-initial', node)}
            />
          </Column>
        </Show>
      );
    };
    const scene = await mount(() => (
      <HostScope.Provider value={{ history }}>
        <Inner />
      </HostScope.Provider>
    ));
    nodes.get('home')!.setFocus();
    await flush();
    v.expect(captureFocusKeys()).toEqual(['late']);
    screen.push('/away');
    await flush();
    // Back starts a restore that is still in flight when the user leaves
    // again; its late resolution must not focus anything.
    screen.back();
    await flush();
    screen.push('/away');
    await flush();
    v.expect(activeElement()).toBe(nodes.get('away-initial'));
    release();
    await flush();
    await flush();
    v.expect(activeElement()).toBe(nodes.get('away-initial'));
    v.expect(screen.current().path).toBe('/away');
    scene.dispose();
  });
});
