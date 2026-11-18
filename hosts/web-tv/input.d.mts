import type { InputScope, Point } from '@solid-multiplatform/platform/input';

export function bindTVViewport(
  root: HTMLElement,
  width?: number,
  height?: number,
): {
  attach(): void;
  point(event: MouseEvent): Point;
  dispose(): void;
};
export function bindBrowserTV(
  target: string,
  root: HTMLElement,
  toScene?: (event: MouseEvent) => Point,
): { input: InputScope; dispose(): void };
