// The display service: the rate and supported modes it reports, its change
// listener, and the window request apps and hosts make through it. No device:
// the provider is a fake installed through the registry.
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  displayInfo,
  displayRefreshRate,
  onDisplayChange,
  preferDisplayRefreshRate,
  type DisplayInfo,
  type DisplayPort,
} from '../src/sdk/display.js';
import { installServices, resetServices } from '../src/sdk/services.js';

const mode = (refreshRate: number): DisplayInfo => ({
  refreshRate,
  supportedRefreshRates: [60, 90, 120],
});

/** A port that records the listeners and requests made through it. */
function fakeDisplay() {
  const listeners = new Set<(info: DisplayInfo) => void>();
  const preferred: (number | 'highest')[] = [];
  let current = mode(60);
  const port: DisplayPort = {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prefer(rate) {
      preferred.push(rate);
      if (rate !== 'highest') current = { ...current, refreshRate: rate };
    },
  };
  const change = (info: DisplayInfo) => {
    current = info;
    for (const listener of Array.from(listeners)) listener(info);
  };
  return { port, change, preferred, listeners };
}

afterEach(() => resetServices());

describe('display service', () => {
  test('no provider: an unknown rate and no change notifications', () => {
    expect(displayInfo()).toEqual({
      refreshRate: 0,
      supportedRefreshRates: [],
    });
    expect(displayRefreshRate()).toBe(0);
    const listener = vi.fn();
    const stop = onDisplayChange(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      stop();
      preferDisplayRefreshRate('highest');
    }).not.toThrow();
  });

  test('reports the current mode and every supported rate', () => {
    const display = fakeDisplay();
    installServices({ display: display.port });
    expect(displayInfo()).toEqual(mode(60));
    expect(displayRefreshRate()).toBe(60);
    expect(displayInfo().supportedRefreshRates).toEqual([60, 90, 120]);
  });

  test('a mode change reaches the listener until it unsubscribes', () => {
    const display = fakeDisplay();
    installServices({ display: display.port });
    const seen: number[] = [];
    const stop = onDisplayChange((info) => seen.push(info.refreshRate));
    display.change(mode(120));
    expect(seen).toEqual([120]);
    expect(displayRefreshRate()).toBe(120);
    stop();
    expect(display.listeners.size).toBe(0);
    display.change(mode(60));
    expect(seen).toEqual([120]);
  });

  test('prefer forwards a rate or the highest supported one', () => {
    const display = fakeDisplay();
    installServices({ display: display.port });
    preferDisplayRefreshRate(90);
    preferDisplayRefreshRate('highest');
    expect(display.preferred).toEqual([90, 'highest']);
  });

  test('a later provider shadows an earlier one, as the registry says', () => {
    const first = fakeDisplay();
    const second = fakeDisplay();
    second.change(mode(120));
    const removeFirst = installServices({ display: first.port });
    installServices({ display: second.port });
    expect(displayRefreshRate()).toBe(120);
    removeFirst();
    expect(displayRefreshRate()).toBe(120);
  });
});
