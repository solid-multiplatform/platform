import { getOwner, runWithOwner, createMemo, useContext } from 'solid-js';
import {
  type BaseRouterProps,
  createRouter,
  createBeforeLeave,
  type RouteDescription,
  type RouteMatch,
} from '@solidjs/router';
import type { JSX } from 'solid-js';
import { HostScope } from '../app/context.js';
import type { HistorySource } from '../core/history.js';

/** The live hash on a page, or '' where there is no browser location. */
const windowHash = (): string =>
  typeof window !== 'undefined' && window.location !== undefined
    ? window.location.hash
    : '';

export function hashParser(str: string, currentHash = windowHash()) {
  const to = str.replace(/^.*?#/, '');
  // Hash-only hrefs like `#foo` from plain anchors will come in as `/#foo` whereas a link to
  // `/foo` will be `/#/foo`. Check if the to starts with a `/` and if not append it as a hash
  // to the current path so we can handle these in-page anchors correctly.
  if (!to.startsWith('/')) {
    const [, path = '/'] = currentHash.split('#', 2);
    return `${path}#${to}`;
  }
  return to;
}

type DepthState = { _depth?: number } | null;

const windowDepth = (): number | undefined => {
  const state = window.history.state as DepthState;
  return state?._depth;
};

/** Depth bookkeeping for the fallback path, as `createBrowserHistory` does. */
const rememberWindowDepth = (): number | undefined => {
  const state = window.history.state as Record<string, unknown> | null;
  if (state === null || state._depth == null) {
    window.history.replaceState(
      { ...state, _depth: window.history.length - 1 },
      '',
    );
  }
  return windowDepth();
};

/**
 * The browser's hash history, for a `HashRouter` mounted without a host (a
 * test, or an app not started through `startApp`). Hosts supply their own, so
 * this is never reached on a target without a page.
 */
function windowHistory(): HistorySource {
  let depth = rememberWindowDepth();
  return {
    read: () => ({
      path: window.location.hash.slice(1),
      state: window.history.state,
    }),
    push(to, state) {
      window.history.pushState(state, '', '#' + to);
      depth = rememberWindowDepth();
    },
    replace(to, state) {
      window.history.replaceState(
        { ...(state as Record<string, unknown> | null), _depth: depth },
        '',
        '#' + to,
      );
      depth = rememberWindowDepth();
    },
    go(delta) {
      window.history.go(delta);
    },
    subscribe(listener) {
      depth = rememberWindowDepth();
      const onHashChange = () => {
        const previous = depth;
        depth = rememberWindowDepth();
        listener(
          previous === undefined || depth === undefined ? 0 : depth - previous,
        );
      };
      window.addEventListener('hashchange', onHashChange);
      return () => window.removeEventListener('hashchange', onHashChange);
    },
  };
}

export type HashRouterProps = BaseRouterProps & {
  forceProxy?: boolean;
  queryParams?: string[];
};

export function bindEvent(
  target: EventTarget,
  type: string,
  handler: EventListener,
) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

export function HashRouter(props: HashRouterProps): JSX.Element {
  const history =
    useContext(HostScope)?.history ??
    (typeof window !== 'undefined' ? windowHistory() : undefined);
  if (history === undefined) {
    throw new Error(
      'HashRouter needs a host history (HostContext.history) or a browser window',
    );
  }
  const getSource = () => history.read().path;
  const beforeLeave = createBeforeLeave();
  return createRouter({
    get: getSource,
    set({ value, replace, state }) {
      if (replace)
        (history.replace ?? history.push).call(history, value, state);
      else history.push(value, state);
    },
    init: (notify) => {
      const subscribe = history.subscribe;
      if (subscribe === undefined) return () => {};
      // The compensating `go` below raises another change; ignore that one,
      // as the browser notify helper did.
      let undoing = false;
      return subscribe.call(history, (delta) => {
        if (undoing) {
          undoing = false;
          return;
        }
        // A browser Back the before-leave guard blocks is undone, as the
        // hash router always did; a host's Back behaves the same way.
        if (
          delta !== 0 &&
          !beforeLeave.confirm(delta < 0 ? delta : getSource())
        ) {
          undoing = true;
          history.go?.(-delta);
          return;
        }
        notify();
      });
    },
    utils: {
      go: (delta) => history.go?.(delta),
      renderPath: (path) => `#${path}`,
      parsePath: (path) => hashParser(path, getSource()),
      beforeLeave,
      queryWrapper:
        props.forceProxy || !SUPPORTS_PROXY
          ? (getQuery) => {
              return createMemoWithoutProxy(getQuery, props.queryParams);
            }
          : undefined,
      paramsWrapper:
        props.forceProxy || !SUPPORTS_PROXY
          ? (buildParams, branches) => {
              return createMemoWithoutProxy(
                buildParams,
                collectDynamicParams(branches()),
              );
            }
          : undefined,
    },
  })(props);
}

export const SUPPORTS_PROXY = typeof Proxy === 'function';
export function createMemoWithoutProxy<
  T extends Record<string | symbol, unknown>,
>(fn: () => T, allKeys?: string[]): T {
  const map = new Map();
  const owner = getOwner()!;
  const target = {} as T;

  const handler = (property: keyof T) => {
    if (!map.has(property)) {
      runWithOwner(owner, () =>
        map.set(
          property,
          createMemo(() => fn()[property]),
        ),
      );
    }
    return map.get(property)!();
  };

  const keys = allKeys ? allKeys : (Object.keys(fn()) as (keyof T)[]);

  keys.forEach((key) => {
    Object.defineProperty(target, key, {
      get: () => handler(key),
      enumerable: true,
      configurable: true,
    });
  });

  return target;
}

export interface Branch {
  routes: RouteDescription[];
  score: number;
  matcher: (location: string) => RouteMatch[] | null;
}

export const collectDynamicParams = (branches: Branch[]) => {
  const dynamicParams: string[] = [];

  branches.forEach((branch) => {
    branch.routes.forEach((route) => {
      if (route.pattern) {
        const matches = route.pattern.match(/:(\w+)/g);
        if (matches) {
          matches.forEach((param) => {
            const p = param.slice(1); // Remove the `:`
            if (!dynamicParams.includes(p)) dynamicParams.push(p);
          });
        }
      }
    });
  });

  return dynamicParams;
};
