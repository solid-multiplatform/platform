/**
 * Screen history with keyed focus restore.
 *
 * The host's {@link HistorySource} stays the source of truth for location and
 * traversal. This module keeps a session-local map of screen entries keyed by
 * an opaque id that lives in the host entry's state; the app-owned snapshot is
 * never written to the host. Back and Forward always remount the route and run
 * the app's `restore`, so nothing is kept alive across a traversal.
 *
 * Focus is recorded as a path of keys, outermost first, taken from the focus
 * elements' `focusKey` and from a list's `itemKey`. Restore walks that path
 * against the freshly mounted screen and resolves item keys against the list's
 * current data. An index is never written or restored.
 */
import { createSignal, getOwner, useContext, type Accessor } from 'solid-js';
import { HostScope } from '../app/context.js';
import type { HistorySource } from '../core/history.js';
import type { ElementNode } from '../core/elementNode.js';
import { isElementNode } from '../core/utils.js';
import { focusPath } from '../core/focusManager.js';
import { isDev } from '../core/config.js';
import type { BackDispatcher } from '../sdk/shortcuts.js';

/** Framework-owned. Opaque to the app; contains the keyed focus path, never an index. */
export interface ScreenFocusSnapshot {
  readonly keys: readonly string[];
}

export interface ScreenEntry<T> {
  /** Unique in this session; fences obsolete browser entries. */
  readonly id: string;
  /** The router location incl. search/hash. */
  readonly path: string;
  /** App-owned snapshot; never screen nodes. */
  readonly state: T | undefined;
  /** True: restore must revalidate, not reuse cache. */
  readonly stale: boolean;
  readonly focus: ScreenFocusSnapshot | undefined;
}

export interface ScreenRestoreContext {
  readonly reason: 'back' | 'forward' | 'retry';
  /** Aborted by another navigation, reset or disposal. */
  readonly signal: AbortSignal;
}

export type ScreenRestoreResult = void | 'gone';

export interface ScreenHistoryOptions<T> {
  capture(): T;
  restore(
    entry: ScreenEntry<T>,
    context: ScreenRestoreContext,
  ): ScreenRestoreResult | Promise<ScreenRestoreResult>;
  fallbackPath: string;
  onBackEmpty?: 'exit' | 'confirm-exit' | (() => void);
}

export type ScreenRestoreStatus =
  | { readonly phase: 'ready' }
  | { readonly phase: 'restoring' }
  | { readonly phase: 'error'; readonly error: unknown };

export interface ScreenHistory<T> {
  readonly current: Accessor<ScreenEntry<T>>;
  readonly status: Accessor<ScreenRestoreStatus>;
  canGoBack(): boolean;
  push(path: string, state?: T): void;
  replace(path: string, state?: T): void;
  back(): void;
  forward(): void;
  retry(): void;
  invalidate(predicate?: (e: ScreenEntry<T>) => boolean): void;
  reset(path?: string, state?: T): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Keyed focus registry
// ---------------------------------------------------------------------------

const FOCUS_KEY = '__smpFocusKey';
const ITEM_KEY = '__smpItemKey';
const ITEM_INDEX = '__smpItemIndex';
const ITEM_KEY_OF = '__smpItemKeyOf';

interface KeyedNode extends ElementNode {
  __smpFocusKey?: string;
  __smpItemKey?: string;
  __smpItemIndex?: (key: string) => number | undefined;
  __smpItemKeyOf?: (item: unknown) => string | undefined;
}

/** Live containers by focus key, so restore can find an outer container. */
const containers = new Map<string, Set<ElementNode>>();

/** Register `key` as a container's stable focus key. */
export function registerFocusKey(
  node: ElementNode,
  key: string | undefined,
): void {
  if (key === undefined) return;
  const keyed = node as KeyedNode;
  keyed[FOCUS_KEY] = key;
  let set = containers.get(key);
  if (set === undefined) {
    set = new Set();
    containers.set(key, set);
  }
  if (isDev && set.size > 0) {
    for (const other of set) {
      if (other !== node && other.parent === node.parent) {
        console.warn(
          `[screen-history] duplicate focusKey "${key}" in the same container`,
        );
        break;
      }
    }
  }
  set.add(node);
}

/** Remove a container registration (called from the component's cleanup). */
export function unregisterFocusKey(
  node: ElementNode,
  key: string | undefined,
): void {
  if (key === undefined) return;
  const set = containers.get(key);
  if (set === undefined) return;
  set.delete(node);
  if (set.size === 0) containers.delete(key);
}

/** Attach the item key a rendered list entry had when it was captured. */
export function setItemKey(node: ElementNode, key: string | undefined): void {
  if (key === undefined) return;
  (node as KeyedNode)[ITEM_KEY] = key;
}

/** Build a key to index map; rebuilt whenever the list's data changes. */
export function keyIndex<T>(
  items: readonly T[],
  itemKey: ((item: T) => string) | undefined,
  label: string,
): Map<string, number> {
  const map = new Map<string, number>();
  if (itemKey === undefined) return map;
  for (let i = 0; i < items.length; i++) {
    const key = itemKey(items[i]!);
    if (isDev && map.has(key)) {
      console.warn(
        `[screen-history] duplicate itemKey "${key}" in ${label}; keyed restore is ambiguous`,
      );
    }
    map.set(key, i);
  }
  return map;
}

/**
 * Let restore resolve an item key against the list's current data. The map is
 * the one the list rebuilds only when `each` changes.
 */
export function registerItemSource(
  node: ElementNode,
  index: () => Map<string, number>,
): void {
  (node as KeyedNode)[ITEM_INDEX] = (key) => index().get(key);
}

/** Remove a list's item source on unmount. */
export function unregisterItemSource(node: ElementNode): void {
  delete (node as KeyedNode)[ITEM_INDEX];
}

/** The key path of the focused element, outermost first. */
export function captureFocusKeys(): string[] | undefined {
  const path = focusPath();
  if (path.length === 0) return undefined;
  const keys: string[] = [];
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i] as KeyedNode;
    const key =
      node[ITEM_KEY] ??
      node[FOCUS_KEY] ??
      (node.focusKey as string | undefined);
    if (key !== undefined) keys.push(key);
  }
  if (keys.length === 0) return undefined;
  if (isDev) {
    for (let i = 1; i < keys.length; i++) {
      if (keys.indexOf(keys[i]!) !== i) {
        console.warn(
          `[screen-history] duplicate key "${keys[i]!}" in the focus path`,
        );
        break;
      }
    }
  }
  return keys;
}

function findInChildren(
  root: ElementNode,
  key: string,
): ElementNode | undefined {
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isElementNode(child) || child.destroyed) continue;
    const node = child as KeyedNode;
    if (
      node[ITEM_KEY] === key ||
      node[FOCUS_KEY] === key ||
      (node.focusKey as string | undefined) === key
    ) {
      return child;
    }
    const found = findInChildren(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findContainer(key: string): ElementNode | undefined {
  const set = containers.get(key);
  if (set === undefined) return undefined;
  // The most recently mounted instance is the current screen; an older one
  // can outlive its unmount for a tick on some backends.
  let live: ElementNode | undefined;
  for (const node of set) {
    if (!node.destroyed) live = node;
  }
  return live;
}

function findItemNode(
  container: ElementNode,
  key: string,
): ElementNode | undefined {
  const children = container.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElementNode(child) && !child.destroyed) {
      if ((child as KeyedNode)[ITEM_KEY] === key) return child;
    }
  }
  return undefined;
}

/**
 * Walk `keys` from `start`, resolving each against the current screen. Item
 * keys are resolved through the list's key map, never by index. A virtual
 * list may need a microtask to mount the target window; the continuation then
 * runs from the item node.
 */
function restoreFrom(
  keys: readonly string[],
  start: number,
  scope: ElementNode | undefined,
): boolean {
  let i = start;
  let current = scope;
  while (i < keys.length) {
    const key = keys[i]!;
    if (current !== undefined) {
      const resolve = (current as KeyedNode)[ITEM_INDEX];
      const index = resolve?.(key);
      if (
        index !== undefined &&
        index >= 0 &&
        (
          current as unknown as {
            scrollToIndex?: (
              index: number,
              options?: { noFocus?: boolean },
            ) => void;
          }
        ).scrollToIndex !== undefined
      ) {
        const last = i === keys.length - 1;
        current.setFocus();
        (
          current as unknown as {
            scrollToIndex: (
              index: number,
              options?: { noFocus?: boolean },
            ) => void;
          }
        ).scrollToIndex(index, { noFocus: !last });
        const item = findItemNode(current, key);
        if (last) {
          if (item !== undefined) item.setFocus();
          else {
            // The list may mount the window a microtask later; focus the
            // keyed item then, never the index the list happens to select.
            const container = current;
            queueMicrotask(() => findItemNode(container, key)?.setFocus());
          }
          return true;
        }
        if (item !== undefined) {
          current = item;
          i++;
          continue;
        }
        // The item is outside the mounted window: the list's scrollToIndex
        // mounts it in a microtask. Continue there, still keyed.
        const container = current;
        const next = i + 1;
        queueMicrotask(() => {
          const mounted = findItemNode(container, key);
          if (mounted !== undefined) restoreFrom(keys, next, mounted);
        });
        return true;
      }
    }
    const found =
      current === undefined ? findContainer(key) : findInChildren(current, key);
    if (found === undefined) return false;
    current = found;
    i++;
    if (i === keys.length) {
      current.setFocus();
      return true;
    }
  }
  return false;
}

/**
 * Restore focus from a key path. Missing keys leave the screen's declared
 * initial focus in place (its `autofocus` ran when the route mounted).
 */
export function restoreFocusKeys(keys: readonly string[]): boolean {
  if (keys.length === 0) return false;
  return restoreFrom(keys, 0, undefined);
}

// ---------------------------------------------------------------------------
// Exit confirmation
// ---------------------------------------------------------------------------

const [exitConfirm, setExitConfirm] = createSignal<(() => void) | undefined>(
  undefined,
);

/** Open the generated shell's shared exit confirmation. */
export function showExitConfirmation(confirm: () => void): void {
  setExitConfirm(() => confirm);
}

/** What the generated shell renders: the pending exit action, if any. */
export const pendingExitConfirmation = exitConfirm;

/** Close the shell's exit confirmation without exiting. */
export function cancelExitConfirmation(): void {
  setExitConfirm(undefined);
}

/** Run the pending exit action, if one is open. */
export function confirmExitConfirmation(): void {
  const confirm = exitConfirm();
  setExitConfirm(undefined);
  confirm?.();
}

// ---------------------------------------------------------------------------
// Screen history
// ---------------------------------------------------------------------------

interface MutableEntry<T> {
  id: string;
  path: string;
  state: T | undefined;
  stale: boolean;
  focus: ScreenFocusSnapshot | undefined;
}

const HOST_ID = '__smpScreen';

function idOf(state: unknown): string | undefined {
  const id = (state as Record<string, unknown> | null | undefined)?.[HOST_ID];
  return typeof id === 'string' ? id : undefined;
}

const hostState = (id: string): Record<string, unknown> => ({
  [HOST_ID]: id,
});

export function createScreenHistory<T>(
  options: ScreenHistoryOptions<T>,
): ScreenHistory<T> {
  const scope = getOwner() !== undefined ? useContext(HostScope) : undefined;
  const history: HistorySource | undefined = scope?.history;
  const dispatcher: BackDispatcher | undefined = scope?.back;

  let nextId = 0;
  let epoch = 0;
  let disposed = false;
  let sequence = 0;
  let controller: AbortController | undefined;

  const map = new Map<string, MutableEntry<T>>();
  let stack: string[] = [];
  let position = 0;

  const newId = () => `s${++nextId}:${epoch}`;

  const entryFor = (
    id: string,
    path: string,
    state: T | undefined,
  ): MutableEntry<T> => ({ id, path, state, stale: false, focus: undefined });

  const initialPath = history?.read().path ?? '';
  const first = entryFor(newId(), initialPath, undefined);
  map.set(first.id, first);
  stack = [first.id];
  position = 0;
  // Stamp this session's id on the entry the app started on, so the first
  // Back finds it instead of treating it as an untracked location.
  history?.replace?.(initialPath, hostState(first.id));

  const [current, setCurrent] = createSignal<ScreenEntry<T>>(first);
  const [status, setStatus] = createSignal<ScreenRestoreStatus>({
    phase: 'ready',
  });

  const setStatusReady = () => setStatus({ phase: 'ready' });

  const cancelRestore = () => {
    sequence++;
    controller?.abort();
    controller = undefined;
  };

  const captureOutgoing = () => {
    const entry = map.get(stack[position]!);
    if (entry === undefined) return;
    entry.state = options.capture();
    const keys = captureFocusKeys();
    entry.focus = keys === undefined ? undefined : { keys };
  };

  const completeGone = () => {
    cancelRestore();
    const path = options.fallbackPath;
    const id = newId();
    map.clear();
    const gone = entryFor(id, path, undefined);
    map.set(id, gone);
    stack = [id];
    position = 0;
    history?.replace?.(path, hostState(id));
    history?.emit?.();
    setCurrent(gone);
    setStatusReady();
  };

  const finishRestore = (
    entry: MutableEntry<T>,
    seq: number,
    signal: AbortSignal,
    result: ScreenRestoreResult,
  ) => {
    if (disposed || seq !== sequence || signal.aborted) return;
    controller = undefined;
    if (result === 'gone') {
      completeGone();
      return;
    }
    const fresh: MutableEntry<T> = { ...entry, stale: false };
    map.set(fresh.id, fresh);
    if (stack[position] === fresh.id) setCurrent(fresh);
    setStatusReady();
    const keys = fresh.focus?.keys;
    if (keys === undefined) return;
    // The remount applies its declared initial focus (an `autofocus`
    // column, say) in the post-mutation pass; the keyed restore runs after
    // that pass, so the restored element wins the focus slot. The fence is
    // re-read: nothing may move between this turn and the microtask, but a
    // pending promise continuation could have navigated.
    queueMicrotask(() => {
      if (disposed || stack[position] !== fresh.id) return;
      restoreFocusKeys(keys);
    });
  };

  const failRestore = (
    entry: MutableEntry<T>,
    seq: number,
    signal: AbortSignal,
    error: unknown,
  ) => {
    if (disposed || seq !== sequence || signal.aborted) return;
    controller = undefined;
    const stale: MutableEntry<T> = { ...entry, stale: true };
    map.set(stale.id, stale);
    if (stack[position] === stale.id) setCurrent(stale);
    setStatus({ phase: 'error', error });
  };

  const startRestore = (
    entry: MutableEntry<T>,
    reason: ScreenRestoreContext['reason'],
  ) => {
    cancelRestore();
    const seq = sequence;
    const restoreController = new AbortController();
    controller = restoreController;
    setCurrent(entry);
    setStatus({ phase: 'restoring' });
    let result: ScreenRestoreResult | Promise<ScreenRestoreResult>;
    try {
      result = options.restore(entry, {
        reason,
        signal: restoreController.signal,
      });
    } catch (error) {
      failRestore(entry, seq, restoreController.signal, error);
      return;
    }
    if (
      result !== null &&
      typeof (result as Promise<ScreenRestoreResult>) === 'object' &&
      typeof (result as Promise<ScreenRestoreResult>).then === 'function'
    ) {
      (result as Promise<ScreenRestoreResult>).then(
        (value) => finishRestore(entry, seq, restoreController.signal, value),
        (error: unknown) =>
          failRestore(entry, seq, restoreController.signal, error),
      );
    } else {
      finishRestore(
        entry,
        seq,
        restoreController.signal,
        result as ScreenRestoreResult,
      );
    }
  };

  const onHostChange = () => {
    if (disposed || history === undefined) return;
    const location = history.read();
    const id = idOf(location.state);
    if (id !== undefined && id === stack[position]) return;
    const known = id === undefined ? undefined : map.get(id);
    if (known !== undefined) {
      const next = stack.indexOf(id!);
      if (next < 0) return;
      const reason: ScreenRestoreContext['reason'] =
        next < position ? 'back' : 'forward';
      position = next;
      startRestore(known, reason);
      return;
    }
    // A location this session did not create (an untracked navigate, or a
    // browser entry from before a reset): start a new epoch without a restore.
    epoch++;
    map.clear();
    const untracked = entryFor(newId(), location.path, undefined);
    map.set(untracked.id, untracked);
    stack = [untracked.id];
    position = 0;
    setCurrent(untracked);
    setStatusReady();
  };

  const unsubscribe = history?.subscribe?.(onHostChange);

  const exitHost = (): boolean => {
    const exit = scope?.exit;
    if (exit !== undefined) {
      exit();
      return true;
    }
    if (isDev) {
      console.warn(
        '[screen-history] Back at the root: this host has no exit action',
      );
    }
    return false;
  };

  const runRootPolicy = (): boolean => {
    const policy = options.onBackEmpty ?? 'exit';
    if (typeof policy === 'function') {
      policy();
      return true;
    }
    if (policy === 'confirm-exit') {
      showExitConfirmation(() => {
        exitHost();
      });
      return true;
    }
    return exitHost();
  };

  const backInternal = (): boolean => {
    if (disposed) return false;
    if (position <= 0) {
      // A restore in error may be abandoned by Back, as the design allows.
      const run = runRootPolicy();
      return run;
    }
    captureOutgoing();
    if (history?.go === undefined) return false;
    const before = stack[position];
    history.go(-1);
    // A source without `subscribe` cannot tell us the move landed; complete
    // it now. A source with one completes in `onHostChange`.
    if (history.subscribe === undefined && stack[position] === before) {
      onHostChange();
    }
    return true;
  };

  const removeNav = dispatcher?.onBack?.(backInternal);

  const back = (): void => {
    backInternal();
  };

  const push = (path: string, state?: T): void => {
    if (disposed) return;
    cancelRestore();
    captureOutgoing();
    const id = newId();
    // Truncate forward metadata.
    for (let i = position + 1; i < stack.length; i++) map.delete(stack[i]!);
    stack.length = position + 1;
    const entry = entryFor(id, path, state);
    map.set(id, entry);
    stack.push(id);
    position = stack.length - 1;
    setCurrent(entry);
    setStatusReady();
    history?.push(path, hostState(id));
    history?.emit?.();
  };

  const replace = (path: string, state?: T): void => {
    if (disposed) return;
    cancelRestore();
    const id = newId();
    // Discard the replaced snapshot.
    map.delete(stack[position]!);
    const entry = entryFor(id, path, state);
    map.set(id, entry);
    stack[position] = id;
    setCurrent(entry);
    setStatusReady();
    if (history?.replace !== undefined) history.replace(path, hostState(id));
    else history?.push(path, hostState(id));
    history?.emit?.();
  };

  const forward = (): void => {
    if (disposed) return;
    if (position >= stack.length - 1) return;
    captureOutgoing();
    history?.go?.(1);
  };

  const retry = (): void => {
    if (disposed) return;
    if (status().phase !== 'error') return;
    const entry = map.get(stack[position]!);
    if (entry !== undefined) startRestore(entry, 'retry');
  };

  const invalidate = (predicate?: (e: ScreenEntry<T>) => boolean): void => {
    for (const [id, entry] of map) {
      if (predicate !== undefined && !predicate(entry)) continue;
      const stale: MutableEntry<T> = { ...entry, stale: true };
      map.set(id, stale);
      if (id === stack[position]) setCurrent(stale);
    }
  };

  const reset = (path?: string, state?: T): void => {
    if (disposed) return;
    cancelRestore();
    epoch++;
    map.clear();
    const target = path ?? history?.read().path ?? '';
    const id = newId();
    const entry = entryFor(id, target, state);
    map.set(id, entry);
    stack = [id];
    position = 0;
    if (history?.replace !== undefined) history.replace(target, hostState(id));
    else history?.push(target, hostState(id));
    history?.emit?.();
    setCurrent(entry);
    setStatusReady();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelRestore();
    unsubscribe?.();
    removeNav?.();
  };

  return {
    current,
    status,
    canGoBack: () => position > 0,
    push,
    replace,
    back,
    forward,
    retry,
    invalidate,
    reset,
    dispose,
  };
}
