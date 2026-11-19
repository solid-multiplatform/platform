// The ARIA mirror and an editor: while a text field is open the browser's
// focus is the editor's; when the editor is removed the focus falls to the
// page body, and the mirror gives it back to the scene's focused item.
import * as v from 'vitest';
import { browserSemantics } from '../src/sdk/semantics.js';

v.test('the mirror takes the focus back when an editor closes', () => {
  // The surface's child list is watched: stand in for the observer, so that
  // the test says when the removal is reported.
  const observers: {
    callback: () => void;
    target?: Node;
    options?: MutationObserverInit;
    connected: boolean;
  }[] = [];
  const Real = window.MutationObserver;
  window.MutationObserver = class {
    private entry;
    constructor(callback: () => void) {
      this.entry = {
        callback,
        connected: false,
      } as (typeof observers)[number];
      observers.push(this.entry);
    }
    observe(target: Node, options: MutationObserverInit) {
      Object.assign(this.entry, { target, options, connected: true });
    }
    disconnect() {
      this.entry.connected = false;
    }
    takeRecords() {
      return [];
    }
  } as unknown as typeof MutationObserver;

  const root = document.createElement('div');
  document.body.append(root);
  try {
    const semantics = browserSemantics(root);
    v.expect(observers).toHaveLength(1);
    const observer = observers[0]!;
    // Only the surface's own children: not the mirror, not the page.
    v.expect(observer.target).toBe(root);
    v.expect(observer.options).toEqual({ childList: true });

    const field = semantics.register({
      role: 'button',
      label: 'Name',
      activate: () => {},
    });
    const other = semantics.register({
      role: 'button',
      label: 'Other',
      activate: () => {},
    });
    const fieldEl = root.querySelector<HTMLElement>('[aria-label="Name"]')!;
    field.focus!();
    v.expect(document.activeElement).toBe(fieldEl);

    // The editor opens over the scene and takes the browser's focus; the
    // scene's focus stays where it was, and the mirror leaves the editor be.
    const input = document.createElement('input');
    root.appendChild(input);
    input.focus();
    observer.callback();
    field.focus!();
    v.expect(document.activeElement).toBe(input);

    // It closes: the body has the focus until the removal is reported.
    input.remove();
    v.expect(document.activeElement).toBe(document.body);
    observer.callback();
    v.expect(document.activeElement).toBe(fieldEl);

    // Focus the page holds elsewhere is not taken.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    observer.callback();
    v.expect(document.activeElement).toBe(outside);
    outside.remove();

    // A disposed item is not focused again.
    field.dispose();
    observer.callback();
    v.expect(document.activeElement).toBe(document.body);

    other.dispose();
    semantics.dispose();
    v.expect(observer.connected).toBe(false);
  } finally {
    window.MutationObserver = Real;
    root.remove();
  }
});
