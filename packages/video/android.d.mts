import type { NativePlayer } from './native.mjs';
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function createAndroidPlayer(
  root: object,
  options?: { target?: 'android' | 'android-tv'; bounds?: Bounds },
): NativePlayer;
