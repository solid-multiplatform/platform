import { createSignal, type Accessor } from 'solid-js';
import type { Point } from './input.js';

export interface SelectionOptions<T> {
  mode?: 'single' | 'multiple';
  initial?: readonly T[];
  equals?(a: T, b: T): boolean;
  onChange?(selected: readonly T[]): void;
}

export interface Selection<T> {
  selected: Accessor<readonly T[]>;
  size: Accessor<number>;
  isSelected(value: T): boolean;
  select(value: T): void;
  toggle(value: T): void;
  clear(): void;
  set(values: readonly T[]): void;
}

/**
 * Single- or multi-select state for lists and grids. Matching is by value or a
 * caller-supplied equality function; this is the Flutter `SelectionArea` /
 * React checkbox-list shape without a rendered component.
 */
export function createSelection<T>(
  options: SelectionOptions<T> = {},
): Selection<T> {
  const mode = options.mode ?? 'single';
  const equals = options.equals ?? ((a: T, b: T) => Object.is(a, b));
  const [selected, setSelectedSignal] = createSignal<readonly T[]>([
    ...(options.initial ?? []),
  ]);
  const publish = (next: readonly T[]) => {
    setSelectedSignal(next);
    options.onChange?.(next);
  };

  return {
    selected,
    size: () => selected().length,
    isSelected: (value) => selected().some((entry) => equals(entry, value)),
    select(value) {
      if (mode === 'multiple') {
        if (selected().some((entry) => equals(entry, value))) return;
        publish([...selected(), value]);
      } else {
        publish([value]);
      }
    },
    toggle(value) {
      const present = selected().some((entry) => equals(entry, value));
      if (mode === 'multiple') {
        publish(
          present
            ? selected().filter((entry) => !equals(entry, value))
            : [...selected(), value],
        );
      } else {
        publish(present ? [] : [value]);
      }
    },
    clear: () => publish([]),
    set(values) {
      publish(mode === 'multiple' ? [...values] : values.slice(0, 1));
    },
  };
}

export interface PagedListOptions<T> {
  fetchPage(page: number): Promise<readonly T[]>;
  /** A short page marks the end. Defaults to 20. */
  pageSize?: number;
  /** Data already loaded by the host. */
  initial?: readonly T[];
  onError?(error: unknown): void;
}

export interface PagedList<T> {
  items: Accessor<readonly T[]>;
  page: Accessor<number>;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  end: Accessor<boolean>;
  error: Accessor<unknown>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  reset(): void;
  /** Cancel in-flight requests and stop publishing. */
  dispose(): void;
}

/**
 * Page-by-page loading for `Virtual`/`VirtualGrid` `onEndReached` and a
 * refresh path for pull-to-refresh. Concurrent and stale responses are
 * discarded, so a slow page cannot append after a refresh. This is the
 * TanStack `useInfiniteQuery` / Flutter list-controller shape.
 */
export function createPagedList<T>(options: PagedListOptions<T>): PagedList<T> {
  const pageSize = options.pageSize ?? 20;
  const [items, setItems] = createSignal<readonly T[]>([
    ...(options.initial ?? []),
  ]);
  const [page, setPage] = createSignal(options.initial?.length ? 1 : 0);
  const [loading, setLoading] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [end, setEnd] = createSignal(false);
  const [error, setError] = createSignal<unknown>(undefined);
  let token = 0;
  let disposed = false;

  return {
    items,
    page,
    loading,
    refreshing,
    end,
    error,
    async loadMore() {
      if (disposed || loading() || refreshing() || end()) return;
      const request = ++token;
      setLoading(true);
      setError(undefined);
      try {
        const batch = await options.fetchPage(page());
        if (disposed || request !== token) return;
        setItems((current) => [...current, ...batch]);
        setPage((current) => current + 1);
        if (batch.length < pageSize) setEnd(true);
      } catch (caught) {
        if (disposed || request !== token) return;
        setError(() => caught);
        options.onError?.(caught);
      } finally {
        if (!disposed && request === token) setLoading(false);
      }
    },
    async refresh() {
      if (disposed) return;
      const request = ++token;
      setRefreshing(true);
      setError(undefined);
      try {
        const batch = await options.fetchPage(0);
        if (disposed || request !== token) return;
        setItems([...batch]);
        setPage(1);
        setEnd(batch.length < pageSize);
      } catch (caught) {
        if (disposed || request !== token) return;
        setError(() => caught);
        options.onError?.(caught);
      } finally {
        if (!disposed && request === token) setRefreshing(false);
      }
    },
    reset() {
      token++;
      setItems([]);
      setPage(0);
      setEnd(false);
      setError(undefined);
      setLoading(false);
      setRefreshing(false);
    },
    dispose() {
      disposed = true;
      token++;
    },
  };
}

export interface PullToRefreshOptions {
  threshold?: number;
  axis?: 'x' | 'y';
  /** `1` follows the finger, `-1` inverts it. Defaults to 1. */
  direction?: 1 | -1;
  onRefresh(): void | Promise<void>;
}

export interface PullToRefresh {
  /** Current pull distance in scene units, clamped at zero. */
  distance: Accessor<number>;
  refreshing: Accessor<boolean>;
  /** Pass to a node's `onPointerDrag`. */
  drag(
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: Point,
    origin: Point,
  ): void;
}

/**
 * Pull gesture state for a `RefreshControl`-style indicator. The app renders
 * `distance()` and calls `refreshing()` from its own scene nodes; the helper
 * only decides when the gesture crossed the threshold.
 */
export function createPullToRefresh(
  options: PullToRefreshOptions,
): PullToRefresh {
  const threshold = options.threshold ?? 64;
  const axis = options.axis ?? 'y';
  const direction = options.direction ?? 1;
  const [distance, setDistance] = createSignal(0);
  const [refreshing, setRefreshing] = createSignal(false);
  const disposed = false;

  const valueOf = (point: Point) => (axis === 'x' ? point.x : point.y);

  return {
    distance,
    refreshing,
    drag(phase, point, origin) {
      if (disposed || refreshing()) return;
      if (phase === 'start') {
        setDistance(0);
        return;
      }
      if (phase === 'cancel') {
        setDistance(0);
        return;
      }
      if (phase === 'move') {
        setDistance(
          Math.max(0, (valueOf(point) - valueOf(origin)) * direction),
        );
        return;
      }
      if (distance() < threshold) {
        setDistance(0);
        return;
      }
      setRefreshing(true);
      Promise.resolve(options.onRefresh())
        .catch(() => undefined)
        .finally(() => {
          if (disposed) return;
          setRefreshing(false);
          setDistance(0);
        });
    },
  };
}
