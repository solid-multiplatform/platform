/**
 * The browser's history as a {@link HistorySource}: the hash the router
 * routes on, the browser stack behind it, and a `hashchange` listener that
 * exists only while a router is subscribed.
 *
 * The router keeps a depth on each entry (`_depth`) so that a Back the
 * before-leave guard blocks can be undone; this module maintains that depth
 * itself instead of `@solidjs/router`'s `saveCurrentDepth`.
 */
import type { HistorySource } from '../core/history.js';

type DepthState = { _depth?: number } | null;

const depthOf = (): number | undefined => {
  const state = window.history.state as DepthState;
  return state?._depth;
};

/** Puts the current entry's depth in its state, as the router reads it. */
const rememberDepth = (): number | undefined => {
  const state = window.history.state as Record<string, unknown> | null;
  if (state === null || state._depth == null) {
    window.history.replaceState(
      { ...state, _depth: window.history.length - 1 },
      '',
    );
  }
  return depthOf();
};

/** A history over the page's hash and `window.history`. */
export function createBrowserHistory(): HistorySource {
  let depth = rememberDepth();
  const listeners = new Set<(delta: number) => void>();

  return {
    read: () => ({
      path: window.location.hash.slice(1),
      state: window.history.state,
    }),
    push(to, state) {
      window.history.pushState(state, '', '#' + to);
      depth = rememberDepth();
    },
    replace(to, state) {
      window.history.replaceState(
        { ...(state as Record<string, unknown> | null), _depth: depth },
        '',
        '#' + to,
      );
      depth = rememberDepth();
    },
    go(delta) {
      window.history.go(delta);
    },
    subscribe(listener) {
      depth = rememberDepth();
      listeners.add(listener);
      const onHashChange = () => {
        const previous = depth;
        depth = rememberDepth();
        listener(
          previous === undefined || depth === undefined ? 0 : depth - previous,
        );
      };
      window.addEventListener('hashchange', onHashChange);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('hashchange', onHashChange);
      };
    },
    emit() {
      // Navigation around the router used `pushState`, which raises no
      // `hashchange`; tell subscribers the location they read has changed.
      for (const listener of listeners) listener(0);
    },
  };
}
