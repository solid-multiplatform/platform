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
 * The PS4 browser's pointer-only input: focus follows the pointer, a left
 * click is Select, a click on empty space presses Enter on the focused node,
 * and a browser Back key is delivered as Escape. `toScene` maps a client
 * point into scene coordinates; without it the stage is 1920×1080.
 */
export function bindPS4(
  root: HTMLElement,
  toScene?: (event: MouseEvent) => Point,
): { input: InputScope; dispose(): void };
/** The browser TV host's options; `ps4` binds the pointer-only PS4 input. */
export interface TVHostOptions extends Omit<WebHostOptions, 'viewport'> {
  ps4?: boolean;
}
/**
 * A browser TV's host around the web host for its engine (`webHost` or
 * `canvasHost`): the fixed TV stage fitted in the window, and the remote.
 */
export function tvHost(
  create: (options: WebHostOptions) => HostDefinition<HTMLElement>,
  options?: TVHostOptions,
): HostDefinition<HTMLElement>;
/**
 * The PlayStation 4 host: `tvHost` with `bindPS4`. `create` is `webHost`, or
 * `canvasHost` for the `--legacy` Canvas 2D build.
 */
export function ps4Host(
  create: (options: WebHostOptions) => HostDefinition<HTMLElement>,
  options?: Omit<WebHostOptions, 'viewport'>,
): HostDefinition<HTMLElement>;
