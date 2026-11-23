// The desktop host's editor overlay (packages/host-desktop/src/field.tsx and
// editor.ts) against the DOM backend: while focused the overlay must be the
// field the scene drew — the rect the scene sent, the scene's type, the hint
// while it is empty — and on blur it hides, so the scene's own field (and
// its pointer target) is back with the keyboard gone. The native runtime's
// own editor tests (host-desktop/tests/run.sh) drive the same code against
// a real window; this file covers the drawing and the key flow in jsdom.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { desktopEditors } from '../../../packages/host-desktop/src/editor.js';
import { DesktopKeyboardEvent } from '../../../packages/host-desktop/src/keys.js';
import { renderer } from './setup.js';

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

// jsdom's backend has no text metrics: the real renderer measures text and
// reports late fonts over `idle`. Answer the one call the overlay makes,
// with the 10-px-per-character width the contract tests measure with.
const backend = renderer.renderer as unknown as {
  measureText?: (props: { text: string }) => { w: number } | null;
};
const realMeasureText = backend.measureText;
backend.measureText = (props) => ({ w: props.text.length * 10 });
v.afterAll(() => {
  if (realMeasureText === undefined) delete backend.measureText;
  else backend.measureText = realMeasureText;
});

/**
 * The runtime's `__solid` port, as far as the editor host reads it: the input
 * method, the clipboard and the runtime's event loop. jsdom has none of it.
 * The loop's `listen` hands over the module's event deliverer, so a test can
 * type: character insertion arrives as `textinput` events, not key events.
 */
let deliver: ((events: unknown[], count: number) => void) | undefined;
function installSolidStub(): { ime: string[]; uninstall(): void } {
  const ime: string[] = [];
  const holder = globalThis as unknown as { __solid?: unknown };
  holder.__solid = {
    text: {
      graphemes: (text: string) =>
        [...text].map((_, index) => index).concat(text.length),
      start: () => ime.push('start'),
      stop: () => ime.push('stop'),
      area: () => ime.push('area'),
    },
    clipboard: { write: () => {}, read: () => '' },
    input: {
      listen: (handler: (events: unknown[], count: number) => void) => {
        deliver = handler;
      },
    },
  };
  return {
    ime,
    uninstall: () => {
      delete holder.__solid;
    },
  };
}

/** A character the input method committed into the focused field. */
const type = (text: string): void => {
  deliver?.([{ type: 'textinput', text }], 1);
};

const key = (name: string): DesktopKeyboardEvent =>
  new DesktopKeyboardEvent('keydown', { key: name });

/** The overlay a `createEditor` mounted, as the root's new child. */
function overlayMounted(before: readonly unknown[]): lng.ElementNode {
  const node = lng.rootNode.children.find(
    (child) => !before.includes(child),
  ) as lng.ElementNode | undefined;
  if (node === undefined) throw new Error('the editor mounted no overlay');
  return node;
}

v.test('the overlay is the field while focused and gone when blurred', () => {
  const stub = installSolidStub();
  const host = desktopEditors('ctrl');
  try {
    const changes: string[] = [];
    let blurred = 0;
    const before = lng.rootNode.children.slice();
    const editor = host.createEditor({
      label: 'Name',
      placeholder: 'Type here',
      placeholderColor: 0x5b6b7cff,
      value: '',
      fontSize: 24,
      color: 0x16202aff,
      onChange: (next) => changes.push(next),
      onBlur: () => {
        blurred++;
      },
    });
    const overlay = overlayMounted(before);
    // Not focused, nothing of the host is drawn: the scene's own field — its
    // hint, its value, its pointer target — is what is on screen.
    v.expect(overlay.alpha).toBe(0);
    // Focused, the editor is the field, at the text band the scene sent:
    // the same left inset and the same 32-pt band, not a box of its own.
    editor.setBounds({ x: 12, y: 38, width: 276, height: 32 });
    editor.focus();
    v.expect(overlay.alpha).toBe(1);
    v.expect(overlay.x).toBe(12);
    v.expect(overlay.y).toBe(38);
    const line = overlay.children[0] as lng.ElementNode;
    v.expect(line.x).toBe(0);
    v.expect(line.y).toBe(0);
    const hint = line.children.find(
      (child) => (child as lng.ElementNode).text === 'Type here',
    ) as lng.ElementNode;
    // The scene's hint, in the scene's muted colour and size.
    v.expect(hint?.fontSize).toBe(24);
    v.expect(hint?.color).toBe(0x5b6b7cff);
    // Typing replaces the hint with the value, as the scene's field did.
    type('H');
    type('i');
    v.expect(changes).toEqual(['H', 'Hi']);
    v.expect(texts(overlay)).toContain('Hi');
    v.expect(texts(overlay)).not.toContain('Type here');
    // Blur hides the overlay and releases the keyboard: the editor's
    // drawing is not left floating over the scene's own.
    editor.blur();
    v.expect(overlay.alpha).toBe(0);
    v.expect(blurred).toBe(1);
    v.expect(stub.ime.at(-1)).toBe('stop');
    editor.dispose();
  } finally {
    host.dispose();
    stub.uninstall();
  }
});

v.test('Return ends editing when the field asks for it', () => {
  const stub = installSolidStub();
  const host = desktopEditors('ctrl');
  try {
    const submitted: string[] = [];
    const beforeOne = lng.rootNode.children.slice();
    const one = host.createEditor({
      label: 'Search',
      value: 'a',
      fontSize: 24,
      blurOnSubmit: true,
      onChange: () => {},
      onSubmit: (value) => submitted.push(value),
      onBlur: () => {},
    });
    one.setBounds({ x: 0, y: 0, width: 100, height: 32 });
    one.focus();
    const overlayOne = overlayMounted(beforeOne);
    v.expect(host.handleKey(key('Enter'))).toBe(true);
    v.expect(submitted).toEqual(['a']);
    // Return submitted and blurred, as the phone and web editors do.
    v.expect(overlayOne.alpha).toBe(0);
    v.expect(stub.ime.at(-1)).toBe('stop');

    // Without `blurOnSubmit`, Return submits and keeps editing.
    const beforeTwo = lng.rootNode.children.slice();
    const two = host.createEditor({
      label: 'Name',
      value: 'a',
      fontSize: 24,
      onChange: () => {},
      onSubmit: () => {},
      onBlur: () => {},
    });
    two.setBounds({ x: 0, y: 0, width: 100, height: 32 });
    two.focus();
    const overlayTwo = overlayMounted(beforeTwo);
    v.expect(host.handleKey(key('Enter'))).toBe(true);
    v.expect(overlayTwo.alpha).toBe(1);
    two.dispose();
    one.dispose();
  } finally {
    host.dispose();
    stub.uninstall();
  }
});
