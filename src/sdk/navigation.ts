import { createSignal, type Accessor } from 'solid-js';

export interface Route {
  readonly path: string;
  readonly state?: unknown;
}

/**
 * Why the stack changed. `push`, `replace` and `back` are stack operations;
 * `tab` is emitted when a tab navigation switches its active tab.
 */
export type NavigationMode = 'push' | 'replace' | 'back' | 'tab';

export interface NavigationSnapshot {
  entries: Route[];
  index: number;
}

export interface NavigationOptions {
  /**
   * Runs before a push or replace. Return `false` to cancel the navigation
   * (for example to send an unauthenticated user to sign-in). This is the
   * React Router / Flutter `WillPopScope` guard shape.
   */
  beforeEach?(
    next: Route,
    previous: Route,
    mode: 'push' | 'replace',
  ): boolean | void;
  /** Runs before `back()`. Return `false` to keep the current route. */
  beforeBack?(current: Route, next: Route): boolean | void;
}

export type NavigationListener = (route: Route, mode: NavigationMode) => void;

export interface Navigation {
  route: Accessor<Route>;
  /** Subscribe to stack changes. Returns an unsubscribe function. */
  subscribe(listener: NavigationListener): () => void;
  canGoBack(): boolean;
  /** Returns false when a guard cancelled the push. */
  push(next: Route): boolean;
  /** Returns false when a guard cancelled the replace. */
  replace(next: Route): boolean;
  /** Returns false at the root or when `beforeBack` cancelled. */
  back(): boolean;
  /** Replace the whole stack, e.g. after a deep link or restored session. */
  reset(next: Route): void;
  /** Capture the stack so a host can persist it across app restarts. */
  snapshot(): NavigationSnapshot;
  /** Restore a stack captured with `snapshot()`. */
  restore(snapshot: NavigationSnapshot): void;
}

/**
 * A small history stack. It is the shared core behind stack navigation, tabs
 * and browser history and is intentionally renderer-agnostic: it stores paths
 * and opaque state, not components.
 */
export function createNavigation(
  initial: Route,
  onChange?: NavigationListener,
  options: NavigationOptions = {},
): Navigation {
  const entries: Route[] = [initial];
  const [route, setRoute] = createSignal(initial, { equals: false });
  const listeners = new Set<NavigationListener>();
  if (onChange) listeners.add(onChange);
  let index = 0;

  const publish = (mode: NavigationMode) => {
    const next = entries[index]!;
    setRoute(next);
    for (const listener of listeners) listener(next, mode);
  };

  return {
    route,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canGoBack() {
      route();
      return index > 0;
    },
    push(next) {
      if (options.beforeEach?.(next, entries[index]!, 'push') === false)
        return false;
      entries.splice(index + 1, entries.length, next);
      index++;
      publish('push');
      return true;
    },
    replace(next) {
      if (options.beforeEach?.(next, entries[index]!, 'replace') === false)
        return false;
      entries[index] = next;
      publish('replace');
      return true;
    },
    back() {
      if (!index) return false;
      if (options.beforeBack?.(entries[index]!, entries[index - 1]!) === false)
        return false;
      index--;
      publish('back');
      return true;
    },
    reset(next) {
      entries.splice(0, entries.length, next);
      index = 0;
      publish('replace');
    },
    snapshot() {
      return { entries: entries.map((entry) => ({ ...entry })), index };
    },
    restore(snapshot) {
      if (!snapshot.entries.length) return;
      const at = Math.min(
        Math.max(0, snapshot.index),
        snapshot.entries.length - 1,
      );
      entries.splice(
        0,
        entries.length,
        ...snapshot.entries.map((entry) => ({ ...entry })),
      );
      index = at;
      publish('replace');
    },
  };
}

/** The slice of `window` browser history binding needs. Injectable for tests. */
export interface BrowserHistoryTarget {
  location: { href: string };
  history: {
    pushState(state: unknown, unused: string, url?: string | null): void;
    replaceState(state: unknown, unused: string, url?: string | null): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
}

export interface BrowserHistoryOptions {
  /** Prefix removed from/added to the URL, e.g. `/app`. */
  base?: string;
  /** Build the URL for a route. Defaults to `base + path`. */
  toUrl?(route: Route): string;
  /** Build a route from a URL. Defaults to the pathname plus search/hash. */
  fromUrl?(url: URL): Route;
  /** The window/history object, injectable for tests. */
  window?: BrowserHistoryTarget;
  /**
   * Adopt the URL the app was opened with when the stack is still at `/`.
   * Defaults to true, matching BrowserRouter/Expo Router deep-link handling.
   */
  adopt?: boolean;
}

const browserWindow = (): BrowserHistoryTarget | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as BrowserHistoryTarget);

const stripBase = (pathname: string, base: string): string => {
  if (!base) return pathname;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (pathname === prefix) return '/';
  return pathname.startsWith(prefix + '/')
    ? pathname.slice(prefix.length)
    : pathname;
};

const defaultFromUrl =
  (base: string) =>
  (url: URL): Route => ({
    path: stripBase(url.pathname, base) || '/',
    state: url.search + url.hash || undefined,
  });

/**
 * Keep a navigation stack in sync with the browser URL.
 *
 * - `push` adds a history entry with `pushState`;
 * - `replace` and an in-app `back()` call `replaceState` (the URL follows the
 *   stack without adding another entry);
 * - the browser's Back/Forward buttons reset the stack from `popstate`.
 *
 * This mirrors Expo Router / React Navigation on web: the URL is the source of
 * truth for entry, and the in-app stack is the source of truth while running.
 */
export function bindBrowserHistory(
  navigation: Navigation,
  options: BrowserHistoryOptions = {},
): () => void {
  const target = options.window ?? browserWindow();
  if (!target?.history) return () => {};
  const base = options.base ?? '';
  const toUrl = options.toUrl ?? ((route: Route) => base + route.path);
  const fromUrl = options.fromUrl ?? defaultFromUrl(base);
  const read = () => fromUrl(new URL(target.location.href));

  const initialPath = navigation.route().path;
  if (options.adopt !== false && (initialPath === '/' || initialPath === '')) {
    navigation.reset(read());
  } else if (options.adopt === false) {
    const route = navigation.route();
    target.history.replaceState(route.state ?? null, '', toUrl(route));
  }

  let fromPopstate = false;
  const unsubscribe = navigation.subscribe((route, mode) => {
    if (fromPopstate) return;
    if (mode === 'push') {
      target.history.pushState(route.state ?? null, '', toUrl(route));
    } else {
      target.history.replaceState(route.state ?? null, '', toUrl(route));
    }
  });
  const onPopstate = () => {
    fromPopstate = true;
    try {
      navigation.reset(read());
    } finally {
      fromPopstate = false;
    }
  };
  target.addEventListener('popstate', onPopstate);
  return () => {
    unsubscribe();
    target.removeEventListener('popstate', onPopstate);
  };
}

/**
 * Create a stack already connected to browser history. The initial route is
 * read from the URL, so reloads and deep links land on the same screen.
 */
export function createBrowserNavigation(
  initial: Route = { path: '/' },
  options: BrowserHistoryOptions = {},
): Navigation & { dispose(): void } {
  const target = options.window ?? browserWindow();
  const base = options.base ?? '';
  const fromUrl = options.fromUrl ?? defaultFromUrl(base);
  const start = target?.location
    ? fromUrl(new URL(target.location.href))
    : initial;
  const navigation = createNavigation(start);
  const disposeHistory = bindBrowserHistory(navigation, {
    ...options,
    window: target,
    adopt: false,
  });
  return Object.assign(navigation, {
    dispose: disposeHistory,
  });
}

export interface DeepLinkSource {
  /** The link that launched the app, or null on a normal start. */
  initial(): string | null;
  subscribe(listener: (link: string) => void): () => void;
}

export interface DeepLinkOptions {
  /** Map a URL to a route. Return undefined to ignore the link. */
  route(link: string): Route | undefined;
  /**
   * What to do with links received while running. `push` (the default)
   * preserves Back; `reset` starts a new stack.
   */
  mode?: 'push' | 'reset';
}

/**
 * Build a route from an absolute or relative URL. The browser history binding
 * uses the same shape, so restarts and links land on the same path.
 */
export function routeFromUrl(link: string, base = ''): Route {
  const url = new URL(link, 'https://app.local');
  return {
    path: stripBase(url.pathname, base) || '/',
    state: url.search + url.hash || undefined,
  };
}

/**
 * Feed the `links` service (universal links, custom schemes, web popstate)
 * into a navigation stack. The launch link resets the stack; later links push
 * so the platform Back gesture returns to where the user was.
 */
export function bindDeepLinks(
  navigation: Navigation,
  links: DeepLinkSource,
  options: DeepLinkOptions,
): () => void {
  const initial = links.initial();
  if (initial) {
    const route = options.route(initial);
    if (route) navigation.reset(route);
  }
  return links.subscribe((link) => {
    const route = options.route(link);
    if (!route) return;
    if ((options.mode ?? 'push') === 'reset') navigation.reset(route);
    else navigation.push(route);
  });
}

export interface TabDefinition {
  name: string;
  /** The initial route for this tab's independent stack. */
  initial: Route;
}

export interface TabNavigationSnapshot {
  activeTab: string;
  tabs: Record<string, NavigationSnapshot>;
}

export type TabNavigationListener = (
  tab: string,
  route: Route,
  mode: NavigationMode,
) => void;

export interface TabNavigation {
  /** The active tab name. */
  tab: Accessor<string>;
  /** Every tab name, in definition order. */
  tabs: Accessor<string[]>;
  /** The active tab's current route. */
  route: Accessor<Route>;
  subscribe(listener: TabNavigationListener): () => void;
  canGoBack(): boolean;
  push(next: Route): boolean;
  replace(next: Route): boolean;
  back(): boolean;
  reset(next: Route): void;
  /**
   * Switch tabs, optionally resetting the target tab to a specific route.
   * Returns false for an unknown tab.
   */
  select(name: string, initial?: Route): boolean;
  /** The navigation stack for a tab, for per-tab state and guards. */
  stack(name: string): Navigation | undefined;
  snapshot(): TabNavigationSnapshot;
  restore(snapshot: TabNavigationSnapshot): void;
}

/**
 * Tab navigation with one independent history stack per tab. This is the
 * React Navigation bottom-tab / Flutter `NavigationBar` model: each tab
 * remembers where the user was, and switching tabs does not merge stacks.
 */
export function createTabNavigation(
  definitions: TabDefinition[],
  options: NavigationOptions = {},
): TabNavigation {
  if (!definitions.length) {
    throw new Error('createTabNavigation needs at least one tab');
  }
  const names = definitions.map((definition) => definition.name);
  if (new Set(names).size !== names.length) {
    throw new Error('createTabNavigation tab names must be unique');
  }

  const [tab, setTab] = createSignal(names[0]!);
  const [route, setRoute] = createSignal<Route>(definitions[0]!.initial);
  const [tabs] = createSignal(names);
  const listeners = new Set<TabNavigationListener>();
  const stacks = new Map<string, Navigation>();
  let restoring = false;

  const publish = (name: string, next: Route, mode: NavigationMode) => {
    setRoute(next);
    for (const listener of listeners) listener(name, next, mode);
  };

  for (const definition of definitions) {
    stacks.set(
      definition.name,
      createNavigation(
        definition.initial,
        (next, mode) => {
          if (restoring || tab() !== definition.name) return;
          publish(definition.name, next, mode);
        },
        options,
      ),
    );
  }

  const active = () => stacks.get(tab())!;

  return {
    tab,
    tabs,
    route,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canGoBack: () => active().canGoBack(),
    push: (next) => active().push(next),
    replace: (next) => active().replace(next),
    back: () => active().back(),
    reset: (next) => active().reset(next),
    select(name, initial) {
      const stack = stacks.get(name);
      if (!stack) return false;
      const changed = tab() !== name;
      if (!changed && !initial) return true;
      setTab(name);
      if (initial) stack.reset(initial);
      else publish(name, stack.route(), 'tab');
      return true;
    },
    stack: (name) => stacks.get(name),
    snapshot() {
      const snapshot: TabNavigationSnapshot = {
        activeTab: tab(),
        tabs: {},
      };
      for (const [name, stack] of stacks) {
        snapshot.tabs[name] = stack.snapshot();
      }
      return snapshot;
    },
    restore(snapshot) {
      restoring = true;
      try {
        for (const [name, stack] of stacks) {
          const saved = snapshot.tabs[name];
          if (saved) stack.restore(saved);
        }
      } finally {
        restoring = false;
      }
      if (!stacks.has(snapshot.activeTab)) return;
      setTab(snapshot.activeTab);
      publish(snapshot.activeTab, active().route(), 'replace');
    },
  };
}
