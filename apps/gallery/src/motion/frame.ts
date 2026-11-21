/**
 * One frame scheduler for the app's motion code.
 *
 * The browser and the native hosts provide `requestAnimationFrame`; the Roku
 * runtime does not (the renderer there runs on `setTimeout`), so an unguarded
 * rAF throws on mount and takes the screen with it. This asks for the next
 * frame on whichever clock the host has.
 */
const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

export function nextFrame(callback: (now: number) => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(now()), 16) as unknown as number;
}

export function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

export { now };
