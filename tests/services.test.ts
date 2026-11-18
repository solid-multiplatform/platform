import { test, expect } from 'vitest';
import { webServices } from '../src/sdk/web-services.js';
import { createNavigation } from '../src/sdk/navigation.js';
import { browserEditorHost } from '../src/sdk/editor.js';
test('browser storage is namespaced and credentials never fall back to plain settings', async () => {
  const a = webServices('a'),
    b = webServices('b');
  await a.use('settings').set('k', 'data');
  expect(await b.use('settings').get('k')).toBeNull();
  expect(a.available('secureStorage')).toBe('unavailable');
  expect(() => a.use('secureStorage')).toThrow();
  await a.use('settings').remove('k');
});
test('editing preserves selection and composition, with an actual password-manager hint', () => {
  const input = browserEditorHost(document.body).createEditor({
    label: 'Password',
    purpose: 'current-password',
    onChange() {},
  });
  const el = document.querySelector('input')!;
  el.value = 'abc';
  el.setSelectionRange(1, 1);
  input.setValue('abc');
  expect(el.selectionStart).toBe(1);
  expect(el.type).toBe('password');
  expect(el.autocomplete).toBe('current-password');
  input.dispose();
  expect(el.value).toBe('');
});
test('new navigation after back replaces forward history', () => {
  const n = createNavigation({ path: '/' });
  n.push({ path: '/a' });
  n.push({ path: '/b' });
  n.back();
  n.replace({ path: '/c' });
  n.push({ path: '/d' });
  n.back();
  expect(n.route().path).toBe('/c');
  expect(n.back()).toBe(true);
  expect(n.back()).toBe(false);
});
