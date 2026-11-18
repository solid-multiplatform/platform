import { expect, vi } from 'vitest';
import {
  activeElement,
  rootNode,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { mount } from '../../examples/shared/app';

export async function verifySharedFixture() {
  const dispose = mount();
  try {
    const container = rootNode.children[0] as ElementNode;
    const [label, first, second] = container.children as ElementNode[];
    expect(first.id).toBe('first');
    expect(second.id).toBe('second');
    await vi.waitFor(() => {
      expect(container.children[1]).toBe(second);
      expect(container.children[2]).toBe(first);
      const backendChildren = (
        container.lng as unknown as { children: unknown[] }
      ).children;
      expect(backendChildren.indexOf(second.lng)).toBeLessThan(
        backendChildren.indexOf(first.lng),
      );
      expect(label.lng.text).toBe('second first');
      expect(activeElement()).toBe(label);
    });
  } finally {
    dispose();
  }
  expect(rootNode.children).toHaveLength(0);
}
