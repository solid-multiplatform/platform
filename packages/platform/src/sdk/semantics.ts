/**
 * Accessibility semantics.
 *
 * A node declares what it is in JSX (`role`, `ariaLabel`, `ariaChecked`, …:
 * `AccessibilityProps`), and most need not: a node with `onEnter` is a button
 * named by the text inside it. A host that has assistive technology supplies
 * a {@link SemanticsSink}; `startApp` keeps it in step with the scene through
 * {@link attachSemantics}. With no sink nothing here runs.
 */
import { createEffect, createRoot } from 'solid-js';
import {
  semanticsHook,
  setSemanticsHook,
  type SemanticsRole,
} from '../core/accessibility.js';
import { activeElement } from '../core/activeElement.js';
import type { ElementNode } from '../core/elementNode.js';
import { isElementNode, isElementText, isFunction } from '../core/utils.js';
import { activateNode, type Rect } from './input.js';

export type { AccessibilityProps } from '../core/accessibility.js';
export type { SemanticsRole };

export interface Semantics {
  bounds?: () => { x: number; y: number; width: number; height: number };
  label: string;
  role: SemanticsRole;
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  /** `aria-selected`, used by tabs, options and rows. */
  selected?: boolean;
  /** `aria-expanded`, used by disclosure buttons and menus. */
  expanded?: boolean;
  /** Heading level, 1–6. */
  level?: number;
  /** Secondary description for screen readers. */
  description?: string;
  min?: number;
  max?: number;
  now?: number;
  /** A live region: changes of the label are announced. */
  live?: 'polite' | 'assertive';
  activate?(): void;
  focus?(): void;
}

/** One item a sink was given. */
export interface SemanticsHandle {
  update(next: Semantics): void;
  /** The scene's focus moved to this item, or into it. */
  focus?(): void;
  dispose(): void;
}

/**
 * Where a host receives the scene's semantics: an ARIA mirror in a browser,
 * AccessKit on desktop. `parent` is the handle of the item the new one is
 * inside, for a sink that keeps a tree; a flat sink ignores it.
 */
export interface SemanticsSink {
  register(node: Semantics, parent?: SemanticsHandle): SemanticsHandle;
}

// ---- What the scene says about itself.

/** Roles whose name is the text inside them when no label is given. */
const NAMED_BY_CONTENT: { [role: string]: true | undefined } = {
  button: true,
  link: true,
  heading: true,
  checkbox: true,
  radio: true,
  switch: true,
  tab: true,
  menuitem: true,
  tooltip: true,
  status: true,
};

const hiddenItself = (node: ElementNode): boolean =>
  node.ariaHidden === true || node._hidden === true;

function roleOf(node: ElementNode): SemanticsRole | undefined {
  const role = node.role;
  if (role !== undefined) return role === 'none' ? undefined : role;
  return isFunction(node.onEnter) ? 'button' : undefined;
}

/** The text drawn in `node`, leaving out what is hidden or exposed by itself. */
function collectText(node: ElementNode, parts: string[]): void {
  if (isElementText(node)) {
    const text = (node.text as string | undefined) || node.getText();
    if (text) parts.push(text);
    return;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (
      isElementNode(child) &&
      !hiddenItself(child) &&
      roleOf(child) === undefined
    ) {
      collectText(child, parts);
    }
  }
}

function nameOf(node: ElementNode, role: SemanticsRole): string {
  if (node.ariaLabel !== undefined) return node.ariaLabel;
  // The announcer's spoken label names the node for a screen reader too.
  if (typeof node.announce === 'string') return node.announce;
  if (NAMED_BY_CONTENT[role] !== true) return '';
  const parts: string[] = [];
  collectText(node, parts);
  return parts.join(' ').trim();
}

interface Actions {
  bounds(): Rect;
  focus(): void;
  activate(): void;
}

const actionsOf = (node: ElementNode): Actions => ({
  bounds: () => ({
    x: node.absX || 0,
    y: node.absY || 0,
    width: node.width || 0,
    height: node.height || 0,
  }),
  focus: () => node.setFocus(),
  activate: () => activateNode(node),
});

/** The semantics of one node, or undefined when it is not exposed. */
function describe(node: ElementNode, actions: Actions): Semantics | undefined {
  const role = roleOf(node);
  if (role === undefined) return undefined;
  const semantics: Semantics = {
    role,
    label: nameOf(node, role),
    bounds: actions.bounds,
  };
  const props = node._a11y;
  if (props !== undefined) {
    if (props.ariaDescription !== undefined)
      semantics.description = props.ariaDescription;
    if (props.ariaDisabled !== undefined)
      semantics.disabled = props.ariaDisabled;
    if (props.ariaValueText !== undefined)
      semantics.value = props.ariaValueText;
    if (props.ariaValueNow !== undefined) semantics.now = props.ariaValueNow;
    if (props.ariaValueMin !== undefined) semantics.min = props.ariaValueMin;
    if (props.ariaValueMax !== undefined) semantics.max = props.ariaValueMax;
    if (props.ariaChecked !== undefined) semantics.checked = props.ariaChecked;
    if (props.ariaSelected !== undefined)
      semantics.selected = props.ariaSelected;
    if (props.ariaExpanded !== undefined)
      semantics.expanded = props.ariaExpanded;
    if (props.ariaLevel !== undefined) semantics.level = props.ariaLevel;
    if (props.ariaLive !== undefined) semantics.live = props.ariaLive;
  }
  if (isFunction(node.onEnter)) {
    semantics.focus = actions.focus;
    semantics.activate = actions.activate;
  }
  return semantics;
}

const same = (a: Semantics, b: Semantics): boolean =>
  a.role === b.role &&
  a.label === b.label &&
  a.description === b.description &&
  a.disabled === b.disabled &&
  a.value === b.value &&
  a.now === b.now &&
  a.min === b.min &&
  a.max === b.max &&
  a.checked === b.checked &&
  a.selected === b.selected &&
  a.expanded === b.expanded &&
  a.level === b.level &&
  a.live === b.live &&
  a.activate === b.activate;

/**
 * The semantics of the scene under `root` as it is now, in tree order: what
 * an attached host would hold. For audits and tests.
 */
export function sceneSemantics(root: ElementNode): Semantics[] {
  const found: Semantics[] = [];
  const visit = (node: ElementNode) => {
    if (hiddenItself(node)) return;
    const semantics = describe(node, actionsOf(node));
    if (semantics !== undefined) found.push(semantics);
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isElementNode(child)) visit(child);
    }
  };
  visit(root);
  return found;
}

interface Entry {
  node: ElementNode;
  parent: Entry | undefined;
  actions: Actions;
  current: Semantics;
  handle: SemanticsHandle;
}

/**
 * Keeps `sink` in step with the scene under `root`, and tells it where the
 * focus is. The scene reports each change to a rendered node (core's
 * semantics hook); changes are gathered and applied once per microtask, and
 * only the nodes that changed are looked at again. Returns how to detach,
 * which also disposes every item it registered. One sink at a time.
 */
export function attachSemantics(
  root: ElementNode,
  sink: SemanticsSink,
): () => void {
  const entries = new Map<ElementNode, Entry>();
  /** Nodes to look at again, with everything inside them. */
  const dirty = new Set<ElementNode>();
  /** Items whose name may have changed with the text inside them. */
  const renamed = new Set<Entry>();
  let queued = false;
  let detached = false;
  let active: ElementNode | undefined;
  let focused: Entry | undefined;

  const schedule = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(flush);
    }
  };

  const nearest = (node: ElementNode | undefined): Entry | undefined => {
    while (node !== undefined) {
      const entry = entries.get(node);
      if (entry !== undefined) return entry;
      if (node === root) break;
      node = node.parent;
    }
    return undefined;
  };

  /** Whether `node` is in the scene now, and not hidden by what is around it. */
  const visibleInScene = (node: ElementNode): boolean | undefined => {
    let hidden = false;
    while (node !== root) {
      const parent = node.parent;
      if (parent === undefined || parent.children.indexOf(node) === -1)
        return undefined;
      if (hiddenItself(parent)) hidden = true;
      node = parent;
    }
    return !hidden;
  };

  const remove = (entry: Entry) => {
    entries.delete(entry.node);
    if (focused === entry) focused = undefined;
    entry.handle.dispose();
  };

  const drop = (node: ElementNode) => {
    const entry = entries.get(node);
    if (entry !== undefined) remove(entry);
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isElementNode(child)) drop(child);
    }
  };

  const scan = (
    node: ElementNode,
    parent: Entry | undefined,
    shown: boolean,
  ) => {
    if (shown && hiddenItself(node)) shown = false;
    let entry = entries.get(node);
    // An item whose surrounding item changed is registered again under it.
    if (entry !== undefined && entry.parent !== parent) {
      remove(entry);
      entry = undefined;
    }
    const actions = entry === undefined ? actionsOf(node) : entry.actions;
    const next = shown ? describe(node, actions) : undefined;
    if (next === undefined) {
      if (entry !== undefined) remove(entry);
    } else if (entry === undefined) {
      entry = {
        node,
        parent,
        actions,
        current: next,
        handle: sink.register(next, parent?.handle),
      };
      entries.set(node, entry);
      parent = entry;
    } else {
      if (!same(entry.current, next)) {
        entry.current = next;
        entry.handle.update(next);
      }
      parent = entry;
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isElementNode(child)) scan(child, parent, shown);
    }
  };

  function flush() {
    queued = false;
    if (detached) return;
    for (const node of dirty) {
      const shown = visibleInScene(node);
      if (shown === undefined) drop(node);
      else scan(node, nearest(node === root ? undefined : node.parent), shown);
    }
    dirty.clear();
    for (const entry of renamed) {
      if (entries.get(entry.node) !== entry) continue;
      const next = describe(entry.node, entry.actions);
      if (next !== undefined && !same(entry.current, next)) {
        entry.current = next;
        entry.handle.update(next);
      }
    }
    renamed.clear();
    // Focus goes to the item the focused node is, or is inside.
    const entry = nearest(active);
    if (entry !== focused) {
      focused = entry;
      entry?.handle.focus?.();
    }
  }

  const hook = (node: ElementNode) => {
    dirty.add(node);
    // The item around it may be named by the text in here.
    const around = nearest(node.parent);
    if (around !== undefined) renamed.add(around);
    schedule();
  };
  setSemanticsHook(hook);
  dirty.add(root);
  const stopFocus = createRoot((dispose) => {
    createEffect(() => {
      active = activeElement();
      schedule();
    });
    return dispose;
  });

  return () => {
    detached = true;
    stopFocus();
    if (semanticsHook === hook) setSemanticsHook(undefined);
    for (const entry of entries.values()) entry.handle.dispose();
    entries.clear();
    dirty.clear();
    renamed.clear();
  };
}

// ---- The browser's sink.

const DIALOG = '[role="dialog"],[role="alertdialog"]';
const isDialog = (role: SemanticsRole) =>
  role === 'dialog' || role === 'alertdialog';

interface Mirrored {
  node: Semantics;
  el: HTMLElement;
  /** Kept from assistive technology while a dialog is open elsewhere. */
  masked: boolean;
}

/**
 * Browser accessibility nodes for canvas content. Real editors have their own
 * native semantics. The hidden tree mirrors the scene so screen readers can
 * enumerate roles, labels, values and actions without a platform-specific API.
 * Items nest as the scene does, a dialog takes everything outside it out of
 * reach, and the browser's focus follows the scene's.
 */
export function browserSemantics(
  root: HTMLElement,
): SemanticsSink & { dispose(): void } {
  const doc = root.ownerDocument;
  const tree = doc.createElement('div');
  root.appendChild(tree);
  tree.style.cssText =
    'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  const registered = new Set<Mirrored>();
  const elements = new WeakMap<SemanticsHandle, Mirrored>();
  let dialogs = 0;
  /** Set while this code moves the browser's focus, which is not the user's doing. */
  let forwarding = false;
  /** The element of the item the scene's focus is on. */
  let current: HTMLElement | undefined;

  // An editor in the surface holds the browser's focus while it is open.
  // When it is removed (a text field closes) the focus falls to the page
  // body, and the scene's has not moved: give it back to the scene's item.
  // This runs when a child of the surface is added or removed, and at no
  // other time.
  const Observer = doc.defaultView?.MutationObserver;
  const editors =
    Observer === undefined
      ? undefined
      : new Observer(() => {
          if (
            current === undefined ||
            !current.isConnected ||
            doc.activeElement !== doc.body
          )
            return;
          forwarding = true;
          try {
            current.focus({ preventScroll: true });
          } finally {
            forwarding = false;
          }
        });
  editors?.observe(root, { childList: true });

  const mask = (entry: Mirrored) => {
    const masked =
      dialogs > 0 &&
      !isDialog(entry.node.role) &&
      entry.el.closest(DIALOG) === null &&
      entry.el.querySelector(DIALOG) === null;
    if (masked === entry.masked) return;
    entry.masked = masked;
    if (masked) {
      entry.el.setAttribute('aria-hidden', 'true');
      entry.el.setAttribute('inert', '');
    } else {
      entry.el.removeAttribute('aria-hidden');
      entry.el.removeAttribute('inert');
    }
  };
  const maskAll = () => registered.forEach(mask);

  return {
    register(initial: Semantics, parent?: SemanticsHandle) {
      const el = doc.createElement(
        initial.role === 'button' ? 'button' : 'div',
      );
      if (el instanceof HTMLButtonElement) el.type = 'button';
      const entry: Mirrored = { node: initial, el, masked: false };
      let text: Text | undefined;
      const attribute = (name: string, value: unknown) => {
        if (value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, String(value));
      };
      function update(node: Semantics) {
        const wasDialog = isDialog(entry.node.role);
        entry.node = node;
        el.setAttribute('role', node.role);
        el.setAttribute('aria-label', node.label);
        el.setAttribute('aria-disabled', String(!!node.disabled));
        el.tabIndex = !node.disabled && node.activate ? 0 : -1;
        attribute('aria-checked', node.checked);
        attribute('aria-selected', node.selected);
        attribute('aria-expanded', node.expanded);
        attribute('aria-valuetext', node.value);
        attribute('aria-description', node.description);
        attribute(
          'aria-level',
          node.role === 'heading' ? (node.level ?? 2) : undefined,
        );
        attribute('aria-modal', isDialog(node.role) ? true : undefined);
        attribute('aria-valuemin', node.min);
        attribute('aria-valuemax', node.max);
        attribute('aria-valuenow', node.now);
        attribute('aria-live', node.live);
        // A live region announces its text, not its label.
        if (node.live !== undefined || node.role === 'status') {
          if (text === undefined) {
            text = doc.createTextNode('');
            el.insertBefore(text, el.firstChild);
          }
          if (text.data !== node.label) text.data = node.label;
        } else if (text !== undefined) {
          text.remove();
          text = undefined;
        }
        if (isDialog(node.role) !== wasDialog) {
          dialogs += wasDialog ? -1 : 1;
          maskAll();
        }
      }
      el.addEventListener('focus', () => {
        if (!forwarding && !entry.node.disabled) entry.node.focus?.();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!entry.node.disabled) entry.node.activate?.();
      });
      // Keys go on to the scene's focus manager, which has the same node
      // focused. Enter would also click a button: once is enough.
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' && e.target === el)
          e.preventDefault();
      });

      const inside = parent === undefined ? undefined : elements.get(parent);
      let outer: HTMLElement = el;
      // A list holds list items; whatever else is put in one gets wrapped.
      if (inside?.node.role === 'list' && initial.role !== 'listitem') {
        outer = doc.createElement('div');
        outer.setAttribute('role', 'listitem');
        outer.appendChild(el);
      }
      (inside?.el ?? tree).appendChild(outer);
      registered.add(entry);
      if (isDialog(initial.role)) dialogs++;
      update(initial);
      if (isDialog(initial.role)) maskAll();
      else mask(entry);

      const handle: SemanticsHandle = {
        update(next: Semantics) {
          update(next);
        },
        focus() {
          current = el;
          const holder = doc.activeElement;
          // Focus an editor or another page control holds is left alone.
          if (
            holder === el ||
            (holder !== null && holder !== doc.body && !tree.contains(holder))
          )
            return;
          forwarding = true;
          try {
            el.focus({ preventScroll: true });
          } finally {
            forwarding = false;
          }
        },
        dispose() {
          if (!registered.delete(entry)) return;
          if (current === el) current = undefined;
          outer.remove();
          if (isDialog(entry.node.role)) {
            dialogs--;
            maskAll();
          }
        },
      };
      elements.set(handle, entry);
      return handle;
    },
    dispose: () => {
      editors?.disconnect();
      current = undefined;
      registered.clear();
      dialogs = 0;
      tree.remove();
    },
  };
}
