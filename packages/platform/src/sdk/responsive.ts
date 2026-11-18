import type { Accessor } from 'solid-js';
import { viewport } from './viewport.js';

export type Breakpoint = 'compact' | 'medium' | 'expanded';

export interface Breakpoints {
  compact: number;
  medium: number;
  expanded: number;
}

/** Material 3 window classes: compact phone, medium tablet, expanded desktop. */
export const defaultBreakpoints: Breakpoints = {
  compact: 0,
  medium: 600,
  expanded: 960,
};

/** Resolve the window class for a width. */
export function breakpointFor(
  width: number,
  breakpoints: Breakpoints = defaultBreakpoints,
): Breakpoint {
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

/**
 * Reactive window class from the viewport signal. This is the Flutter
 * `LayoutBuilder` / CSS media-query contract without a platform-specific hook.
 */
export const breakpoint: Accessor<Breakpoint> = () =>
  breakpointFor(viewport().width);

/** Alias for `breakpoint`, mirroring the other `use…` accessors. */
export const useBreakpoint: Accessor<Breakpoint> = breakpoint;

export type ResponsiveValue<T> =
  | T
  | {
      compact?: T;
      medium?: T;
      expanded?: T;
    };

const isResponsiveMap = <T>(
  value: ResponsiveValue<T>,
): value is { compact?: T; medium?: T; expanded?: T } =>
  typeof value === 'object' &&
  value !== null &&
  ('compact' in value || 'medium' in value || 'expanded' in value);

/**
 * Pick the value for the current window class, falling back to the nearest
 * smaller class. `resolveResponsive({ compact: 1, expanded: 3 })` returns 1 on
 * tablets and 3 on desktops.
 */
export function resolveResponsive<T>(
  value: ResponsiveValue<T>,
  current: Breakpoint = breakpoint(),
): T {
  if (!isResponsiveMap(value)) return value;
  if (current === 'expanded' && value.expanded !== undefined) {
    return value.expanded;
  }
  if (current !== 'compact' && value.medium !== undefined) {
    return value.medium;
  }
  if (value.compact !== undefined) return value.compact;
  if (value.medium !== undefined) return value.medium;
  return value.expanded as T;
}
