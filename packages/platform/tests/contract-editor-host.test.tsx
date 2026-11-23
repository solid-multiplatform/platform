// The browser editor host (src/sdk/editor.ts): the input that replaces a
// scene field must be that field's own drawing — no chrome of its own, the
// scene's type size and colour, the hint in the scene's muted colour — so
// focusing hands over with nothing moving. Escape ends editing, as the
// phone hosts' editors do.
import * as v from 'vitest';
import { browserEditorHost } from '../src/sdk/editor.js';
import './setup.js';

const parent = (): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};

v.test('an editor draws as the field it replaces, not as a page input', () => {
  const host = parent();
  const editor = browserEditorHost(host).createEditor({
    label: 'Name',
    placeholder: 'Type here',
    placeholderColor: 0x5b6b7cff,
    value: '',
    fontSize: 24,
    color: 0x16202aff,
    purpose: 'one-time-code',
    onChange() {},
    onBlur: () => {},
  });
  try {
    const input = host.querySelector('input')!;
    v.expect(input.className).toBe('solid-editor');
    // A one-time code asks the phone for digits, as a number field does.
    v.expect(input.getAttribute('inputmode')).toBe('numeric');
    const css = input.style.cssText.toLowerCase();
    // No chrome of its own: the scene's box is what shows. (jsdom's style
    // parser keeps no `border` shorthand to read back — the real browser
    // applies it; the rest of the chrome is asserted as parsed.)
    v.expect(css).toContain('position: absolute');
    v.expect(css).toContain('padding: 0px');
    v.expect(css).toContain('background: transparent');
    v.expect(css).toContain('outline: none');
    // The scene's type metrics: 24 pt on a 32-pt line, the scene's ink.
    v.expect(input.style.fontSize).toBe('24px');
    v.expect(input.style.lineHeight).toBe('32px');
    v.expect(input.style.color).toBe('rgb(22, 32, 42)');
    v.expect(input.style.caretColor).toBe('rgba(22, 32, 42, 1.000)');
    // The hint's colour travels as the custom property the shared rule
    // reads, so one stylesheet rule serves every field of the host.
    v.expect(input.style.getPropertyValue('--solid-placeholder')).toBe(
      'rgba(91, 107, 124, 1.000)',
    );
    const rule = [...document.head.querySelectorAll('style')]
      .map((node) => node.textContent ?? '')
      .find((text) => text.includes('input.solid-editor::placeholder'));
    v.expect(rule).toContain('var(--solid-placeholder');
  } finally {
    editor.dispose();
    host.remove();
  }
});

v.test('Escape ends editing and hands the key back to the scene', () => {
  const host = parent();
  let blurred = 0;
  const editor = browserEditorHost(host).createEditor({
    label: 'Name',
    value: 'x',
    onChange() {},
    onBlur: () => {
      blurred++;
    },
  });
  try {
    const input = host.querySelector('input')!;
    editor.focus();
    v.expect(document.activeElement).toBe(input);
    const key = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    input.dispatchEvent(key);
    // The editor took the key (no dialog-close listener sees it) and gave
    // up the browser's focus, so the host's overlay is gone.
    v.expect(key.defaultPrevented).toBe(true);
    v.expect(blurred).toBe(1);
    v.expect(document.activeElement).not.toBe(input);
  } finally {
    editor.dispose();
    host.remove();
  }
});
