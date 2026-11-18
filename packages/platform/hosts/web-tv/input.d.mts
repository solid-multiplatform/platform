import type { InputScope, Point } from '@solid-multiplatform/platform/input';
import type { HostDefinition } from '@solid-multiplatform/platform/host';
import type { WebHostOptions } from '@solid-multiplatform/platform/host/web';

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
export function bindBrowserTV(
  target: string,
  root: HTMLElement,
  toScene: ((event: MouseEvent) => Point) | undefined,
  pointer: boolean,
): { input: InputScope | undefined; dispose(): void };
/**
 * A browser TV's host around the web host for its engine (`webHost` or
 * `canvasHost`): the fixed TV stage fitted in the window, and the remote.
 */
export function tvHost(
  create: (options: WebHostOptions) => HostDefinition<HTMLElement>,
  options?: Omit<WebHostOptions, 'viewport'>,
): HostDefinition<HTMLElement>;
