/**
 * The history a host gives the router. A host with a real browser history
 * implements it over `window.history`; every other target gets the in-memory
 * stack here. Nothing in the router reads `window` when the host supplies one.
 *
 * A path is what the router routes on: for `HashRouter` it is the body of the
 * hash (`#/library` -> `/library`), search included.
 */

export interface HistoryLocation {
  /** The current router path, search included. */
  readonly path: string;
  /** Opaque per-entry state the backing history keeps, if any. */
  readonly state?: unknown;
}

export interface HistorySource {
  /** The location the app is showing now. */
  read(): HistoryLocation;
  /** Add an entry after the current one. */
  push(to: string, state?: unknown): void;
  /** Replace the current entry. */
  replace?(to: string, state?: unknown): void;
  /** Move `delta` entries, as Back and Forward do. */
  go?(delta: number): void;
  /** Whether there is an earlier entry to go back to. */
  canGoBack?(): boolean;
  /**
   * Listen for changes the router did not make (system Back, a browser Back
   * button, a link). The listener gets how many entries the location moved.
   * Only registered while a router is mounted; the returned disposer removes
   * it.
   */
  subscribe?(listener: (delta: number) => void): () => void;
  /**
   * Tell subscribers the location changed although the stack did not move.
   * Navigation that goes around the router (screen history's `push` and
   * `replace`) calls it so the router re-reads the host location. A source
   * that does not implement it is still usable; nothing else calls it.
   */
  emit?(): void;
}

/** One entry in {@link createMemoryHistory}. */
interface MemoryEntry {
  path: string;
  state: unknown;
}

/**
 * A history stack in memory, for a host with no browser history: Android,
 * iOS, tvOS and Roku. `push` and `replace` do not notify; a host that moves
 * the stack itself calls `go`, which does.
 */
export function createMemoryHistory(initial = ''): HistorySource {
  const entries: MemoryEntry[] = [{ path: initial, state: undefined }];
  let index = 0;
  const listeners = new Set<(delta: number) => void>();

  return {
    read: () => entries[index] as MemoryEntry,
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
    emit() {
      for (const listener of listeners) listener(0);
    },
  };
}
