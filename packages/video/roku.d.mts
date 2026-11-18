import type { NativePlayer } from './native.mjs';
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function createRokuPlayer(
  root: object,
  options?: Partial<Bounds>,
): NativePlayer;
