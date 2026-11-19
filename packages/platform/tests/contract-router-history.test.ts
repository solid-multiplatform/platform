// The router keeps its location in the host's history, not in `window`.
//
// `@solidjs/router` is aliased to tests/stubs/solidjs-router.ts, whose
// `createRouter` runs the integration and records it; these tests drive that
// integration directly. The API used (get/set/init/utils) is the library's.
import * as v from 'vitest';
import { createComponent, createRoot } from 'solid-js';
import {
  routerConfigs,
  routerNotifications,
  setRouterBeforeLeave,
  type RouterIntegrationConfig,
} from '@solidjs/router';
import { HostScope } from '../src/app/context.js';
import {
  createMemoryHistory,
  type HistorySource,
} from '../src/core/history.js';
import { HashRouter, hashParser } from '../src/primitives/router.js';

interface RouterConfig extends RouterIntegrationConfig {
  get(): string;
  set(change: { value: string; replace?: boolean; state?: unknown }): void;
  utils: { go?(delta: number): void };
}

/** Mounts a `HashRouter` on a host history and returns its integration. */
function mount(history: HistorySource): RouterConfig {
  createRoot((dispose) => {
    roots.push(dispose);
    createComponent(HostScope.Provider, {
      value: { history },
      get children() {
        return HashRouter({}) as unknown as never;
      },
    });
  });
  return routerConfigs[routerConfigs.length - 1] as RouterConfig;
}

const roots: (() => void)[] = [];
const disposeAll = () => {
  while (roots.length > 0) roots.pop()!();
};

v.afterEach(() => {
  disposeAll();
  routerConfigs.length = 0;
  routerNotifications.length = 0;
  setRouterBeforeLeave(() => true);
  window.location.hash = '';
});

v.describe('HashRouter over a host history', () => {
  v.it('reads the path and writes push, replace and go to the host', () => {
    const history = createMemoryHistory();
    const router = mount(history);

    v.expect(router.get()).toBe('');

    router.set({ value: '/library' });
    v.expect(history.read().path).toBe('/library');
    v.expect(router.get()).toBe('/library');

    router.set({
      value: '/library/42',
      replace: true,
      state: { from: 'list' },
    });
    v.expect(history.read().path).toBe('/library/42');
    v.expect(history.read().state).toEqual({ from: 'list' });

    // The router's go is the host's go: one entry back.
    router.set({ value: '/' });
    router.utils.go?.(-1);
    v.expect(history.read().path).toBe('/library/42');
  });

  v.it(
    'subscribes only while mounted and removes the listener on dispose',
    () => {
      const history = createMemoryHistory();
      let listeners = 0;
      let removals = 0;
      const subscribe = history.subscribe!;
      history.subscribe = (listener) => {
        listeners++;
        const remove = subscribe(listener);
        return () => {
          removals++;
          remove();
        };
      };

      const router = mount(history);
      v.expect(listeners).toBe(1);
      v.expect(removals).toBe(0);

      // Own navigation does not raise a change: pushState never did.
      router.set({ value: '/a' });
      v.expect(routerNotifications).toHaveLength(0);

      // A system move (Back) does, and the router is told.
      history.go(-1);
      v.expect(routerNotifications).toHaveLength(1);

      disposeAll();
      v.expect(removals).toBe(1);
      history.go(1);
      v.expect(routerNotifications).toHaveLength(1);
    },
  );

  v.it('asks the before-leave guard before following a Back', () => {
    const history = createMemoryHistory();
    const router = mount(history);
    router.set({ value: '/editor' });

    let asked: unknown;
    setRouterBeforeLeave((to) => {
      asked = to;
      return false; // blocked: the router undoes the move
    });
    history.go(-1);
    v.expect(asked).toBe(-1);
    v.expect(history.read().path).toBe('/editor');
    v.expect(routerNotifications).toHaveLength(0);
  });

  v.it('does not use window when the host supplies a history', () => {
    const history = createMemoryHistory('/from-host');
    const router = mount(history);
    // A browser hash at the same time is irrelevant: the host's path wins.
    window.location.hash = '#/from-window';
    v.expect(router.get()).toBe('/from-host');
    router.set({ value: '/next' });
    v.expect(history.read().path).toBe('/next');
  });
});

v.describe('hashParser', () => {
  v.it('resolves an in-page anchor against the current router path', () => {
    v.expect(hashParser('#top', '#/library')).toBe('/library#top');
    v.expect(hashParser('/details/1')).toBe('/details/1');
  });
});
