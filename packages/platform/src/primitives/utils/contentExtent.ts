import type { ElementNode } from '../../core/elementNode.js';

/**
 * How far a scroller's content reaches along one axis, in its own units.
 *
 * A scroll container is given the viewport's size, so its own height is the
 * visible box, not the content. The children are the content; measuring them
 * is what lets a fixed page scroll (touch or focus) instead of either
 * refusing to move or growing its box off the screen. Used by both the touch
 * engine and the focus-scrolling modes so they agree on the content size.
 */
export function contentExtent(node: ElementNode, axis: 'x' | 'y'): number {
  const dimension = axis === 'x' ? 'width' : 'height';
  let extent = 0;
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as ElementNode | undefined;
    if (child === undefined || typeof child.width !== 'number') continue;
    const start = (child[axis] as number) || 0;
    const size = (child[dimension] as number) || 0;
    if (start + size > extent) extent = start + size;
  }
  return Math.max((node[dimension] as number) || 0, extent);
}
