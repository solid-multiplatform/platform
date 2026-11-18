// Contract tests: the service registry hosts install providers into.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CapabilityError,
  installServices,
  installedServices,
  loadService,
  peekService,
  resetServices,
  serviceAvailable,
  useService,
} from '../src/sdk/registry.ts';
import { CapabilityError as FromServices } from '../src/sdk/services.ts';

interface Probe {
  value: string;
}
declare module '../src/sdk/registry.ts' {
  interface ServiceProviders {
    testEager: Probe;
    testLazy: Probe;
    testAsync: Probe;
  }
}

afterEach(resetServices);

describe('service registry', () => {
  it('reports a service with no provider as unavailable and refuses it', async () => {
    expect(serviceAvailable('testEager')).toBe('unavailable');
    expect(peekService('testEager')).toBeUndefined();
    expect(() => useService('testEager')).toThrow(CapabilityError);
    await expect(loadService('testEager')).rejects.toMatchObject({
      name: 'CapabilityError',
      capability: 'testEager',
    });
    // One error class, whichever module it is imported from.
    expect(FromServices).toBe(CapabilityError);
  });

  it('installing constructs nothing; first use does, once', async () => {
    const eager = { value: 'eager' };
    const lazy = vi.fn(() => ({ value: 'lazy' }));
    const later = vi.fn(async () => ({ value: 'async' }));
    installServices({ testEager: eager, testLazy: lazy, testAsync: later });
    expect(lazy).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(serviceAvailable('testLazy')).toBe('available');
    expect(serviceAvailable('testAsync')).toBe('available');
    expect(lazy).not.toHaveBeenCalled();
    expect(installedServices()).toEqual(['testAsync', 'testEager', 'testLazy']);

    expect(useService('testEager')).toBe(eager);
    expect(useService('testLazy')).toEqual({ value: 'lazy' });
    expect(useService('testLazy')).toBe(useService('testLazy'));
    expect(lazy).toHaveBeenCalledTimes(1);

    const [a, b] = await Promise.all([
      loadService('testAsync'),
      loadService('testAsync'),
    ]);
    expect(a).toBe(b);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('an asynchronous provider is not available synchronously until loaded', async () => {
    installServices({ testAsync: async () => ({ value: 'async' }) });
    expect(peekService('testAsync')).toBeUndefined();
    expect(() => useService('testAsync')).toThrow(CapabilityError);
    await loadService('testAsync');
    expect(useService('testAsync')).toEqual({ value: 'async' });
  });

  it('a provider that fails to load can be tried again', async () => {
    let attempts = 0;
    installServices({
      testAsync: async () => {
        if (++attempts === 1) throw new Error('offline');
        return { value: 'second try' };
      },
    });
    await expect(loadService('testAsync')).rejects.toThrow('offline');
    await expect(loadService('testAsync')).resolves.toEqual({
      value: 'second try',
    });
  });

  it('a later install wins and its uninstall uncovers the earlier one', () => {
    const host = { value: 'host' };
    const plugin = { value: 'plugin' };
    installServices({ testEager: host });
    const remove = installServices({ testEager: plugin });
    expect(useService('testEager')).toBe(plugin);
    remove();
    expect(useService('testEager')).toBe(host);
    remove();
    expect(useService('testEager')).toBe(host);
  });

  it('installing adds no timers and no listeners', () => {
    vi.useFakeTimers();
    const listen = vi.spyOn(globalThis, 'addEventListener');
    try {
      installServices({
        testEager: { value: 'eager' },
        testLazy: () => ({ value: 'lazy' }),
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(listen).not.toHaveBeenCalled();
    } finally {
      listen.mockRestore();
      vi.useRealTimers();
    }
  });
});
