import { createEffect, onCleanup } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';

export type CursorStyle =
  | 'default'
  | 'pointer'
  | 'text'
  | 'move'
  | 'grab'
  | 'grabbing'
  | 'not-allowed'
  | 'wait'
  | 'crosshair'
  | 'none'
  | 'zoom-in'
  | 'zoom-out';

declare module '../core/elementNode.js' {
  interface ElementNode {
    /**
     * Pointer cursor used while this element is hovered on desktop and web.
     * The scene itself never renders a cursor; hosts with a pointer apply it.
     * Named `cursorStyle` because `cursor` is already the Virtual list index.
     */
    cursorStyle?: CursorStyle;
  }
}

const documentRoot = (): HTMLElement | undefined =>
  typeof document === 'undefined' ? undefined : document.documentElement;

/** Apply a cursor style to the host document. A no-op without a DOM. */
export function setCursor(style: CursorStyle = 'default'): void {
  const root = documentRoot();
  if (root) root.style.cursor = style;
}

/** Remove the inline cursor so the host stylesheet applies again. */
export function resetCursor(): void {
  const root = documentRoot();
  if (root) root.style.cursor = '';
}

/**
 * Resolve the cursor for a scene element. Explicit `cursor` wins, then
 * anything interactive gets `pointer` — the same rule browsers apply to
 * buttons and links. This is the cursor half of RN's `cursor` style / CSS.
 */
export function cursorForElement(
  element: ElementNode | undefined,
  fallback: CursorStyle = 'default',
): CursorStyle {
  if (!element) return fallback;
  if (element.cursorStyle) return element.cursorStyle;
  if (element.onMouseClick || element.onEnter) return 'pointer';
  return fallback;
}

/**
 * Track a reactive hovered element and publish its cursor. Use it when an app
 * owns hover outside `useMouse` (for example a custom pointer implementation).
 * The previous cursor is cleared when the owner disposes.
 */
export function useCursor(
  source: () => ElementNode | undefined,
  fallback: CursorStyle = 'default',
): void {
  createEffect(() => setCursor(cursorForElement(source(), fallback)));
  onCleanup(resetCursor);
}
