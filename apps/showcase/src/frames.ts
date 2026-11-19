/**
 * Frames the renderer has drawn, from its own `frameTick` event. The listener
 * runs only inside a frame the renderer was already drawing: it schedules
 * nothing, touches no signal and so cannot cause a frame itself.
 */
import { getRenderer } from '@solid-multiplatform/platform';

interface FrameSource {
  on?(event: string, listener: () => void): void;
}

const KEEP = 512;
const stamps: number[] = [];
let total = 0;
let attached = false;

/** False when the backend exposes no frame event; the counter then reads nothing. */
export function attachFrameCounter(): boolean {
  if (attached) return true;
  const renderer = getRenderer() as FrameSource | undefined;
  if (typeof renderer?.on !== 'function') return false;
  renderer.on('frameTick', () => {
    total++;
    stamps.push(Date.now());
    if (stamps.length > KEEP) stamps.splice(0, KEEP / 2);
  });
  attached = true;
  return true;
}

export const frameCounterAttached = (): boolean => attached;
export const totalFrames = (): number => total;

/** Frames drawn in the last `ms` milliseconds (at most the last 512). */
export function framesInLast(ms: number): number {
  const since = Date.now() - ms;
  let count = 0;
  for (let i = stamps.length - 1; i >= 0 && stamps[i]! >= since; i--) count++;
  return count;
}
