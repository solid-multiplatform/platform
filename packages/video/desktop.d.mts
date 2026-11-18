import type { NativePlayer } from './native.mjs';
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function createDesktopPlayer(
  root: object,
  options?: { executable?: string },
): NativePlayer;
