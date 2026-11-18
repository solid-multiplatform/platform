import type { NativePlayer } from './native.mjs';
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function createApplePlayer(
  root: object,
  options?: { target?: 'ios' | 'apple-tv'; bounds?: Bounds },
): NativePlayer;
