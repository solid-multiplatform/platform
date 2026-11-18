// The scene's semantics, told to the system's assistive technology through
// the runtime (native/src/a11y.rs; AT-SPI on Linux).
//
// A sink in the shape the platform's hosts share: `register(node, parent?)`
// returns `{ update, focus, dispose }`. It is a thin adapter: the nodes are
// the app's, this numbers them and hands their fields over. Changes made in
// one turn go to the runtime in one batch, in a microtask; nothing runs
// when nothing changes, and the runtime sends nothing unless assistive
// technology is running.
//
// A node's `bounds()` is read when the node is registered or updated. A node
// that moves without either (a scroll, an animation) keeps its old place
// until its owner calls `update`.
import type { Semantics } from '@solid-multiplatform/platform/semantics';
import { windowMetrics } from './platform.js';

/** What `register` returns: the node's own handle. */
export interface SemanticsHandle {
  /** Replace the node's description. */
  update(next: Semantics): void;
  /** Say that this node has the keyboard now. */
  focus(): void;
  dispose(): void;
}

export interface SemanticsSink {
  /** Describe a node, under `parent` or under the window. */
  register(node: Semantics, parent?: SemanticsHandle): SemanticsHandle;
  /** Remove every node. */
  dispose(): void;
}

// The bits of the runtime's `flags` argument (native/src/a11y.rs).
const DISABLED = 1;
const HAS_CHECKED = 2;
const CHECKED = 4;
const HAS_SELECTED = 8;
const SELECTED = 16;
const HAS_EXPANDED = 32;
const EXPANDED = 64;
const CAN_ACTIVATE = 128;
const CAN_FOCUS = 256;

function flags(node: Semantics): number {
  const enabled = !node.disabled;
  return (
    (node.disabled ? DISABLED : 0) |
    (node.checked === undefined ? 0 : HAS_CHECKED) |
    (node.checked ? CHECKED : 0) |
    (node.selected === undefined ? 0 : HAS_SELECTED) |
    (node.selected ? SELECTED : 0) |
    (node.expanded === undefined ? 0 : HAS_EXPANDED) |
    (node.expanded ? EXPANDED : 0) |
    // An action is offered only if asking for it would do something.
    (enabled && node.activate ? CAN_ACTIVATE : 0) |
    (enabled && node.focus ? CAN_FOCUS : 0)
  );
}

interface Entry {
  node: Semantics;
  parent: number;
}

/**
 * The desktop's semantics sink, or `undefined` where the runtime has no
 * accessibility support (a run without a window, a build without it).
 */
export function desktopSemantics(): SemanticsSink | undefined {
  const native = __solid.a11y;
  if (native === undefined) return undefined;

  const entries = new Map<number, Entry>();
  const ids = new WeakMap<SemanticsHandle, number>();
  const changed = new Set<number>();
  const removed = new Set<number>();
  let nextId = 1;
  let focused = 0;
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    for (const id of removed) native.remove(id);
    removed.clear();
    for (const id of changed) {
      const entry = entries.get(id);
      if (entry === undefined) continue;
      const { node } = entry;
      const bounds = node.bounds?.();
      native.set(
        id,
        entry.parent,
        node.role,
        node.label,
        node.description ?? null,
        node.value ?? null,
        bounds?.x ?? NaN,
        bounds?.y ?? NaN,
        bounds?.width ?? NaN,
        bounds?.height ?? NaN,
        flags(node),
        node.role === 'heading' ? (node.level ?? 2) : NaN,
        node.min ?? NaN,
        node.max ?? NaN,
        node.now ?? NaN,
      );
    }
    changed.clear();
    native.commit(focused, windowMetrics().scale);
  };
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  // What assistive technology asks of a node. The runtime offers an action
  // only on a node that has it; a node may have changed since.
  native.listen((action, id) => {
    const node = entries.get(id)?.node;
    if (node === undefined || node.disabled) return;
    if (action === 'focus') node.focus?.();
    else node.activate?.();
  });

  return {
    register(node, parent) {
      const id = nextId++;
      entries.set(id, {
        node,
        parent: (parent && ids.get(parent)) ?? 0,
      });
      changed.add(id);
      schedule();
      const handle: SemanticsHandle = {
        update(next) {
          const entry = entries.get(id);
          if (entry === undefined) return;
          entry.node = next;
          changed.add(id);
          schedule();
        },
        focus() {
          if (!entries.has(id) || focused === id) return;
          focused = id;
          schedule();
        },
        dispose() {
          if (!entries.delete(id)) return;
          changed.delete(id);
          removed.add(id);
          if (focused === id) focused = 0;
          schedule();
        },
      };
      ids.set(handle, id);
      return handle;
    },
    dispose() {
      // An app that described nothing must not start anything by leaving.
      if (entries.size === 0) return;
      for (const id of entries.keys()) removed.add(id);
      entries.clear();
      changed.clear();
      focused = 0;
      schedule();
    },
  };
}
