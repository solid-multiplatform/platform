import * as v from 'vitest';
import {
  bindBrowserHistory,
  bindDeepLinks,
  createBrowserNavigation,
  createNavigation,
  createTabNavigation,
  routeFromUrl,
  type BrowserHistoryTarget,
} from '../src/sdk/navigation.js';

function createFakeWindow(start = 'https://app.test/') {
  let current = new URL(start);
  const calls: {
    type: 'push' | 'replace';
    state: unknown;
    url: string;
  }[] = [];
  const popstate = new Set<() => void>();

  const target: BrowserHistoryTarget = {
    get location() {
      return { href: current.href };
    },
    history: {
      pushState(state, _unused, url) {
        calls.push({ type: 'push', state, url: String(url) });
        if (url !== undefined && url !== null) current = new URL(url, current);
      },
      replaceState(state, _unused, url) {
        calls.push({ type: 'replace', state, url: String(url) });
        if (url !== undefined && url !== null) current = new URL(url, current);
      },
    },
    addEventListener(type, listener) {
      if (type === 'popstate') popstate.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'popstate') popstate.delete(listener);
    },
  };

  return {
    target,
    calls,
    get href() {
      return current.href;
    },
    navigate(href: string) {
      current = new URL(href, current);
      for (const listener of popstate) listener();
    },
  };
}

v.describe('navigation guards', () => {
  v.it('beforeEach cancels push and replace without changing the stack', () => {
    const navigation = createNavigation({ path: '/' }, undefined, {
      beforeEach: (next) => next.path !== '/blocked',
    });
    v.expect(navigation.push({ path: '/a' })).toBe(true);
    v.expect(navigation.push({ path: '/blocked' })).toBe(false);
    v.expect(navigation.route().path).toBe('/a');
    v.expect(navigation.replace({ path: '/blocked' })).toBe(false);
    v.expect(navigation.route().path).toBe('/a');
    v.expect(navigation.snapshot().entries.map((entry) => entry.path)).toEqual([
      '/',
      '/a',
    ]);
  });

  v.it('beforeBack can keep the current route', () => {
    let allow = false;
    const navigation = createNavigation({ path: '/' }, undefined, {
      beforeBack: () => allow,
    });
    navigation.push({ path: '/editor' });
    v.expect(navigation.back()).toBe(false);
    v.expect(navigation.route().path).toBe('/editor');
    allow = true;
    v.expect(navigation.back()).toBe(true);
    v.expect(navigation.route().path).toBe('/');
  });

  v.it('emits the mode through subscribe', () => {
    const modes: string[] = [];
    const navigation = createNavigation({ path: '/' });
    navigation.subscribe((_route, mode) => modes.push(mode));
    navigation.push({ path: '/a' });
    navigation.replace({ path: '/b' });
    navigation.back();
    navigation.reset({ path: '/c' });
    v.expect(modes).toEqual(['push', 'replace', 'back', 'replace']);
  });
});

v.describe('navigation snapshot', () => {
  v.it('restores the full stack and index', () => {
    const navigation = createNavigation({ path: '/' });
    navigation.push({ path: '/one', state: { id: 1 } });
    navigation.push({ path: '/two' });
    navigation.back();
    const snapshot = navigation.snapshot();
    v.expect(snapshot).toEqual({
      entries: [
        { path: '/' },
        { path: '/one', state: { id: 1 } },
        { path: '/two' },
      ],
      index: 1,
    });

    navigation.reset({ path: '/elsewhere' });
    v.expect(navigation.canGoBack()).toBe(false);
    navigation.restore(snapshot);
    v.expect(navigation.route()).toEqual({ path: '/one', state: { id: 1 } });
    v.expect(navigation.canGoBack()).toBe(true);
    v.expect(navigation.snapshot()).toEqual(snapshot);
  });

  v.it('clamps an out-of-range index instead of dropping the stack', () => {
    const navigation = createNavigation({ path: '/' });
    navigation.restore({
      entries: [{ path: '/a' }, { path: '/b' }],
      index: 99,
    });
    v.expect(navigation.route().path).toBe('/b');
    navigation.restore({ entries: [], index: 0 });
    v.expect(navigation.route().path).toBe('/b');
  });
});

v.describe('browser history', () => {
  v.it('writes pushState/replaceState and follows popstate', () => {
    const browser = createFakeWindow('https://app.test/');
    const navigation = createNavigation({ path: '/' });
    const dispose = bindBrowserHistory(navigation, { window: browser.target });

    navigation.push({ path: '/library', state: { tab: 1 } });
    v.expect(browser.calls).toEqual([
      { type: 'push', state: { tab: 1 }, url: '/library' },
    ]);
    v.expect(browser.href).toBe('https://app.test/library');

    navigation.replace({ path: '/library/2' });
    v.expect(browser.calls[1]).toEqual({
      type: 'replace',
      state: null,
      url: '/library/2',
    });

    // Browser Back: the URL is authoritative and resets the stack.
    browser.navigate('https://app.test/');
    v.expect(navigation.route().path).toBe('/');
    v.expect(navigation.canGoBack()).toBe(false);
    // No URL write was triggered by the popstate restore.
    v.expect(browser.calls).toHaveLength(2);

    navigation.push({ path: '/settings' });
    v.expect(browser.calls[2]).toEqual({
      type: 'push',
      state: null,
      url: '/settings',
    });
    navigation.back();
    v.expect(browser.calls[3]).toEqual({
      type: 'replace',
      state: null,
      url: '/',
    });

    dispose();
    navigation.push({ path: '/after-dispose' });
    v.expect(browser.calls).toHaveLength(4);
  });

  v.it('honours a base path and creates a browser-backed navigation', () => {
    const browser = createFakeWindow('https://app.test/app/settings?tab=2');
    const navigation = createBrowserNavigation(
      { path: '/' },
      { base: '/app', window: browser.target },
    );
    v.expect(navigation.route().path).toBe('/settings');
    v.expect(navigation.route().state).toBe('?tab=2');

    navigation.push({ path: '/home' });
    v.expect(browser.href).toBe('https://app.test/app/home');
    v.expect(browser.calls.at(-1)).toMatchObject({
      type: 'push',
      url: '/app/home',
    });

    browser.navigate('https://app.test/app/library');
    v.expect(navigation.route().path).toBe('/library');
    navigation.dispose();
  });

  v.it('adopts the current URL only when the stack starts at root', () => {
    const browser = createFakeWindow('https://app.test/deep/link');
    const skipped = createNavigation({ path: '/explicit' });
    const disposeSkipped = bindBrowserHistory(skipped, {
      window: browser.target,
    });
    v.expect(skipped.route().path).toBe('/explicit');
    disposeSkipped();

    const adopted = createNavigation({ path: '/' });
    const disposeAdopted = bindBrowserHistory(adopted, {
      window: browser.target,
    });
    v.expect(adopted.route().path).toBe('/deep/link');
    disposeAdopted();
  });
});

v.describe('tab navigation', () => {
  const createTabs = () =>
    createTabNavigation([
      { name: 'home', initial: { path: '/home' } },
      { name: 'search', initial: { path: '/search' } },
    ]);

  v.it('keeps an independent stack per tab', () => {
    const navigation = createTabs();
    v.expect(navigation.tabs()).toEqual(['home', 'search']);
    v.expect(navigation.tab()).toBe('home');
    navigation.push({ path: '/home/item' });
    v.expect(navigation.stack('home')!.route().path).toBe('/home/item');

    v.expect(navigation.select('search')).toBe(true);
    v.expect(navigation.tab()).toBe('search');
    v.expect(navigation.route().path).toBe('/search');
    v.expect(navigation.canGoBack()).toBe(false);
    v.expect(navigation.back()).toBe(false);

    v.expect(navigation.select('home')).toBe(true);
    v.expect(navigation.route().path).toBe('/home/item');
    v.expect(navigation.back()).toBe(true);
    v.expect(navigation.route().path).toBe('/home');
  });

  v.it('can reset a tab while selecting it and rejects unknown tabs', () => {
    const navigation = createTabs();
    navigation.push({ path: '/home/item' });
    v.expect(navigation.select('home', { path: '/home' })).toBe(true);
    v.expect(navigation.route().path).toBe('/home');
    v.expect(navigation.canGoBack()).toBe(false);
    v.expect(navigation.select('missing')).toBe(false);
    v.expect(() =>
      createTabNavigation([
        { name: 'a', initial: { path: '/a' } },
        { name: 'a', initial: { path: '/b' } },
      ]),
    ).toThrowError(/unique/);
  });

  v.it('emits tab switches with the tab mode', () => {
    const events: string[] = [];
    const navigation = createTabs();
    navigation.subscribe((tab, route, mode) =>
      events.push(`${mode}:${tab}:${route.path}`),
    );
    navigation.push({ path: '/home/one' });
    navigation.select('search');
    navigation.push({ path: '/search/q' });
    v.expect(events).toEqual([
      'push:home:/home/one',
      'tab:search:/search',
      'push:search:/search/q',
    ]);
  });

  v.it('snapshots every tab stack and restores them together', () => {
    const navigation = createTabs();
    navigation.push({ path: '/home/b' });
    navigation.select('search');
    navigation.push({ path: '/search/q' });
    const snapshot = navigation.snapshot();
    v.expect(snapshot.activeTab).toBe('search');

    navigation.back();
    navigation.select('home');
    navigation.back();
    v.expect(navigation.route().path).toBe('/home');

    navigation.restore(snapshot);
    v.expect(navigation.tab()).toBe('search');
    v.expect(navigation.route().path).toBe('/search/q');
    v.expect(navigation.canGoBack()).toBe(true);
    navigation.select('home');
    v.expect(navigation.route().path).toBe('/home/b');
    v.expect(navigation.canGoBack()).toBe(true);
  });

  v.it('applies guards to the active tab only', () => {
    const navigation = createTabNavigation(
      [
        { name: 'home', initial: { path: '/home' } },
        { name: 'admin', initial: { path: '/admin' } },
      ],
      {
        beforeEach: (next) => !next.path.startsWith('/admin'),
      },
    );
    v.expect(navigation.push({ path: '/home/a' })).toBe(true);
    v.expect(navigation.push({ path: '/admin/secret' })).toBe(false);
    v.expect(navigation.select('admin')).toBe(true);
    v.expect(navigation.push({ path: '/admin/users' })).toBe(false);
    v.expect(navigation.route().path).toBe('/admin');
  });
});

v.describe('deep links', () => {
  const createLinks = (initial: string | null) => {
    const listeners = new Set<(link: string) => void>();
    return {
      source: {
        initial: () => initial,
        subscribe(listener: (link: string) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      emit(link: string) {
        for (const listener of listeners) listener(link);
      },
      get count() {
        return listeners.size;
      },
    };
  };

  v.it('applies the launch link and pushes later links', () => {
    const links = createLinks('https://app.test/items/42?ref=push');
    const navigation = createNavigation({ path: '/' });
    const dispose = bindDeepLinks(navigation, links.source, {
      route: (link) => {
        const route = routeFromUrl(link);
        return route.path.startsWith('/items/') ? route : undefined;
      },
    });
    v.expect(navigation.route()).toEqual({
      path: '/items/42',
      state: '?ref=push',
    });
    v.expect(navigation.canGoBack()).toBe(false);

    links.emit('https://app.test/items/43');
    v.expect(navigation.route().path).toBe('/items/43');
    v.expect(navigation.canGoBack()).toBe(true);

    links.emit('https://app.test/unknown');
    v.expect(navigation.route().path).toBe('/items/43');
    dispose();
    v.expect(links.count).toBe(0);
  });

  v.it('can reset instead of pushing for warm links', () => {
    const links = createLinks(null);
    const navigation = createNavigation({ path: '/' });
    const dispose = bindDeepLinks(navigation, links.source, {
      mode: 'reset',
      route: (link) => routeFromUrl(link, '/app'),
    });
    navigation.push({ path: '/before' });
    links.emit('https://app.test/app/inbox');
    v.expect(navigation.route().path).toBe('/inbox');
    v.expect(navigation.canGoBack()).toBe(false);
    dispose();
  });
});
