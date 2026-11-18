import * as v from 'vitest';
import { menuItemsPayload } from '../src/sdk/menus.js';

v.describe('menu payload', () => {
  v.it('serializes nested menus and strips callbacks', () => {
    const payload = menuItemsPayload([
      { id: 'file', label: 'File', submenu: [{ id: 'quit', label: 'Quit' }] },
      {
        id: 'wrap',
        label: 'Wrap',
        type: 'checkbox',
        checked: true,
        onSelect: () => {},
      },
      { id: 'off', label: 'Off', disabled: true },
      { id: 'sep', type: 'separator' },
    ]);
    v.expect(payload).toEqual([
      {
        id: 'file',
        label: 'File',
        type: undefined,
        shortcut: undefined,
        enabled: undefined,
        disabled: undefined,
        checked: undefined,
        submenu: [
          {
            id: 'quit',
            label: 'Quit',
            type: undefined,
            shortcut: undefined,
            enabled: undefined,
            disabled: undefined,
            checked: undefined,
            submenu: undefined,
          },
        ],
      },
      {
        id: 'wrap',
        label: 'Wrap',
        type: 'checkbox',
        shortcut: undefined,
        enabled: undefined,
        disabled: undefined,
        checked: true,
        submenu: undefined,
      },
      {
        id: 'off',
        label: 'Off',
        type: undefined,
        shortcut: undefined,
        enabled: undefined,
        disabled: true,
        checked: undefined,
        submenu: undefined,
      },
      {
        id: 'sep',
        label: undefined,
        type: 'separator',
        shortcut: undefined,
        enabled: undefined,
        disabled: undefined,
        checked: undefined,
        submenu: undefined,
      },
    ]);
    v.expect('onSelect' in payload[1]!).toBe(false);
  });
});
