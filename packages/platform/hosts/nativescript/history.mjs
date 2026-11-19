// The in-memory history a native host gives the router. It is the plain-JS
// twin of `createMemoryHistory` in `src/core/history.ts`, kept here so the
// bootstrap can make one without loading the platform host module (and the
// renderer it pulls in) before the app starts.
//
// A path is what the router routes on. `push` and `replace` do not notify; a
// host that moves the stack itself calls `go`, which does.

export function createMemoryHistory(initial = '') {
  const entries = [{ path: initial, state: undefined }];
  let index = 0;
  const listeners = new Set();

  return {
    read: () => entries[index],
    push(to, state) {
      entries.splice(index + 1, entries.length);
      entries.push({ path: to, state });
      index = entries.length - 1;
    },
    replace(to, state) {
      entries[index] = { path: to, state };
    },
    go(delta) {
      const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
      if (next === index) return;
      const moved = next - index;
      index = next;
      for (const listener of listeners) listener(moved);
    },
    canGoBack: () => index > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
