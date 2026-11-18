import { viewport, type Insets } from './viewport.js';
import type { Rect } from './input.js';
import { scrollAxis } from './scroll.js';

export interface KeyboardState {
  /** The software keyboard currently covers part of the window. */
  visible(): boolean;
  /** Logical units covered at the bottom of the window. */
  height(): number;
  /** Full IME inset (only `bottom` is normally non-zero). */
  insets(): Insets;
  /** Height of the currently visible content area. */
  availableHeight(): number;
}

/**
 * Reactive keyboard state. The host updates `viewport().insets.ime` from
 * Android `WindowInsets.Type.ime()`, iOS keyboard notifications, or the web
 * `visualViewport`.
 */
export function useKeyboard(): KeyboardState {
  return {
    visible: () => viewport().insets.ime.bottom > 0,
    height: () => viewport().insets.ime.bottom,
    insets: () => viewport().insets.ime,
    availableHeight: () =>
      Math.max(0, viewport().height - viewport().insets.ime.bottom),
  };
}

type Scroll = ReturnType<typeof scrollAxis>;

/**
 * Keep a focused field above the keyboard. Mirrors Flutter's
 * `Scrollable.ensureVisible` and Android's `adjustResize`: the scroll offset
 * changes, not the field's layout position.
 *
 * @param scroll  the scroll axis that owns the field
 * @param start   field top in content coordinates
 * @param end     field bottom in content coordinates
 * @param visible visible content height (before the keyboard)
 * @param duration animation length; 0 is immediate
 */
export function revealAboveKeyboard(
  scroll: Scroll,
  start: number,
  end: number,
  visible: number,
  duration = 0,
): void {
  const keyboard = useKeyboard().height();
  scroll.reveal(start, end, Math.max(0, visible - keyboard), duration);
}

export interface KeyboardAwareBoundsOptions {
  /** Set false when the field is in a region the keyboard cannot cover. */
  avoid?: boolean;
  /** Space to keep between the field and the keyboard. */
  margin?: number;
}

/**
 * Wrap a field's bounds so the field stays above the keyboard. Use it as a
 * reactive bounds source for native controls or editors:
 *
 * ```tsx
 * const bounds = keyboardAwareBounds(() => ({ x: 16, y: 480, width: 360, height: 56 }));
 * editor.setBounds(bounds);
 * ```
 */
export function keyboardAwareBounds(
  bounds: () => Rect,
  options: KeyboardAwareBoundsOptions = {},
): () => Rect {
  const margin = options.margin ?? 12;
  return () => {
    const rect = bounds();
    if (options.avoid === false) return rect;
    const keyboard = viewport().insets.ime.bottom;
    if (keyboard <= 0) return rect;
    const limit = viewport().height - keyboard - margin;
    if (rect.y + rect.height <= limit) return rect;
    return { ...rect, y: Math.max(0, limit - rect.height) };
  };
}
