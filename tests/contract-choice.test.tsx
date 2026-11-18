import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Checkbox, RadioGroup } from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';

const find = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
): lng.ElementNode | undefined => {
  if (!lng.isINode(node)) return undefined;
  if (lng.isElementNode(node) && predicate(node)) return node;
  for (const child of node.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return undefined;
};

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

const rowFor = (label: string) =>
  find(
    renderer.rootNode,
    (node) =>
      typeof node.onMouseClick === 'function' && texts(node).includes(label),
  )!;

v.describe('Checkbox', () => {
  v.it('toggles through Enter and pointer activation', async () => {
    const label = `Wi-Fi-${Math.random()}`;
    const [checked, setChecked] = createSignal(false);
    const changes: boolean[] = [];
    const dispose = renderer.render(() => (
      <view width={400} height={300}>
        <Checkbox
          label={label}
          checked={checked}
          onChange={(next) => {
            changes.push(next);
            setChecked(next);
          }}
        />
      </view>
    ));
    await waitForUpdate();
    const row = find(
      renderer.rootNode,
      (node) => typeof node.onMouseClick === 'function',
    )!;
    row.onEnter?.call(row, new KeyboardEvent('keydown'));
    v.expect(changes).toEqual([true]);
    v.expect(checked()).toBe(true);
    row.onMouseClick?.(new MouseEvent('click'), row);
    v.expect(changes).toEqual([true, false]);
    v.expect(checked()).toBe(false);
    dispose();
  });

  v.it('ignores activation when disabled', async () => {
    const label = `Locked-${Math.random()}`;
    let changes = 0;
    const dispose = renderer.render(() => (
      <view width={400} height={300}>
        <Checkbox label="Locked" checked disabled onChange={() => changes++} />
      </view>
    ));
    await waitForUpdate();
    const row = find(
      renderer.rootNode,
      (node) => typeof node.onMouseClick === 'function',
    )!;
    row.onEnter?.call(row, new KeyboardEvent('keydown'));
    v.expect(changes).toBe(0);
    dispose();
  });
});

v.describe('RadioGroup', () => {
  v.it(
    'reports the selected option and reflects controlled value',
    async () => {
      const [value, setValue] = createSignal('b');
      const dispose = renderer.render(() => (
        <view width={400} height={300}>
          <RadioGroup
            value={value}
            options={[
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
              { value: 'c', label: 'Gamma', disabled: true },
            ]}
            onChange={(next) => setValue(next)}
          />
        </view>
      ));
      await waitForUpdate();
      // Selecting an enabled row updates the controlled value.
      const alpha = rowFor('Alpha');
      alpha.onMouseClick?.(new MouseEvent('click'), alpha);
      v.expect(value()).toBe('a');
      // The disabled row does not.
      const gamma = rowFor('Gamma');
      gamma.onMouseClick?.(new MouseEvent('click'), gamma);
      v.expect(value()).toBe('a');
      dispose();
    },
  );
});
