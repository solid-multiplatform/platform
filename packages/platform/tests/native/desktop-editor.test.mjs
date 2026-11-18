import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopEditors } from '../../hosts/desktop/editors.mjs';
test('SDL editing respects graphemes, composition, selection and secure clipboard behavior', () => {
  const state = [],
    values = [],
    copied = [];
  const host = desktopEditors({
    textInput() {},
    imeRect() {},
    copy: (s) => copied.push(s),
    paste: () => 'x',
  });
  const f = host.createEditor({
    purpose: 'current-password',
    value: 'a😀',
    onState: (v) => state.push(v),
    onChange: (v) => values.push(v),
  });
  f.focus();
  host.handle('keydown', { key: 'Backspace' });
  assert.equal(f.value(), 'a');
  host.handle('compositionupdate', { data: 'あ' });
  assert.equal(f.value(), 'a');
  host.handle('textinput', { data: 'あ' });
  assert.equal(f.value(), 'aあ');
  host.handle('keydown', { ctrlKey: true, key: 'a' });
  host.handle('keydown', { ctrlKey: true, key: 'c' });
  assert.deepEqual(copied, []);
  assert.equal(state.at(-1).display, '••');
  host.handle('keydown', { ctrlKey: true, key: 'v' });
  assert.equal(f.value(), 'x');
  f.dispose();
  assert.equal(host.handle('textinput', { data: 'ignored' }), false);
});
