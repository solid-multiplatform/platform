import { peekService } from './registry.js';

/**
 * What the host's display reports about its refresh rate.
 *
 * A renderer that draws on every vsync (the default, `targetFPS: 0`) runs at
 * `refreshRate`; the value is also the one to give `animationSnapRate` when
 * animations must step whole display frames.
 */
export interface DisplayInfo {
  /** The current refresh rate in Hz (60, 90, 120, ...); 0 when unknown. */
  refreshRate: number;
  /** Every refresh rate the display can switch to, ascending; empty when unknown. */
  supportedRefreshRates: readonly number[];
}

export interface DisplayPort {
  /** The display's current mode. Synchronous: safe to call per layout pass. */
  get(): DisplayInfo;
  /**
   * Calls `listener` whenever the display's mode changes (a refresh-rate
   * switch, a resolution change), until the returned function is called.
   * Event-driven: hosts register a display listener, nothing polls.
   */
  subscribe?(listener: (info: DisplayInfo) => void): () => void;
  /**
   * Ask the host to run the app's window at `rate`, or at the highest rate
   * the display supports. Hosts that need no opt-in (the display already
   * follows the app) omit it.
   */
  prefer?(rate: number | 'highest'): void;
}

declare module './registry.js' {
  interface ServiceProviders {
    display: DisplayPort;
  }
}

/** The display's current mode, or a zero rate when the host has no display service. */
export function displayInfo(): DisplayInfo {
  return (
    peekService('display')?.get() ?? {
      refreshRate: 0,
      supportedRefreshRates: [],
    }
  );
}

/** The display's current refresh rate in Hz, or 0 when unknown. */
export function displayRefreshRate(): number {
  return displayInfo().refreshRate;
}

/**
 * Subscribe to display mode changes. Where the host has no display service,
 * the returned function does nothing and never calls `listener`: a target
 * with no rate to report has no change to report either.
 */
export function onDisplayChange(
  listener: (info: DisplayInfo) => void,
): () => void {
  const port = peekService('display');
  if (port?.subscribe === undefined) return () => {};
  return port.subscribe(listener);
}

/**
 * Ask the host to run the window at `rate` (or the highest supported one).
 * A no-op where the host has no display service or no choice of mode.
 */
export function preferDisplayRefreshRate(rate: number | 'highest'): void {
  peekService('display')?.prefer?.(rate);
}
