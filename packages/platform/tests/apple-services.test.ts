import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installServices,
  loadService,
  peekService,
  serviceAvailable,
  type ProviderMap,
} from '../src/sdk/services.js';
import {
  appleServices,
  phoneOnlyServices,
} from '../hosts/nativescript/providers/apple/manifest.js';
import { confine } from '../hosts/nativescript/providers/apple/paths.js';
import { appleInfoPlistRequirements } from '../hosts/nativescript/providers/apple/plist.js';

const lazyModules = [
  'battery',
  'biometrics',
  'clipboard',
  'connectivity',
  'device-info',
  'haptics',
  'keep-awake',
  'lifecycle',
  'notifications',
  'open-external',
  'orientation',
  'secure-storage',
  'settings',
  'share',
];
const imported: string[] = [];
for (const name of lazyModules)
  vi.doMock(
    `../hosts/nativescript/providers/apple/${name}.js`,
    async (original) => {
      imported.push(name);
      return original();
    },
  );

// The unit project shares one registry between test files: remove only this
// file's layer.
let remove: (() => void) | undefined;
const install = (map: ProviderMap) => {
  remove = installServices(map);
};
afterEach(() => {
  remove?.();
  remove = undefined;
  imported.length = 0;
  vi.unstubAllGlobals();
});

describe('Apple service manifest', () => {
  it('installs every phone service without importing or constructing one', () => {
    // No native class exists here: constructing anything would throw.
    const map = appleServices({ form: 'phone' });
    install(map);
    expect(Object.keys(map).sort()).toEqual([
      'battery',
      'biometrics',
      'clipboard',
      'colorScheme',
      'connectivity',
      'deviceInfo',
      'fileSystem',
      'geolocation',
      'haptics',
      'keepAwake',
      'keyEvents',
      'lifecycle',
      'locale',
      'mediaSession',
      'memory',
      'notifications',
      'openExternal',
      'secureStorage',
      'settings',
      'share',
    ]);
    expect(imported).toEqual([]);
  });

  it('leaves the services tvOS cannot provide out of the TV map', () => {
    const tv = appleServices({ form: 'tv' });
    const hook = { allow() {} };
    const phone = appleServices({ form: 'phone', orientation: hook });
    expect('orientation' in appleServices({ form: 'phone' })).toBe(false);
    expect(
      'orientation' in appleServices({ form: 'tv', orientation: hook }),
    ).toBe(false);
    for (const name of phoneOnlyServices) {
      expect(name in tv).toBe(false);
      expect(name in phone).toBe(true);
    }
    expect(Object.keys(phone).length - Object.keys(tv).length).toBe(
      phoneOnlyServices.length,
    );
    install(tv);
    expect(serviceAvailable('settings')).toBe('available');
    expect(serviceAvailable('secureStorage')).toBe('available');
  });

  it('imports a lazy provider on first use, and only that one', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('NSUserDefaults', {
      standardUserDefaults: {
        stringForKey: (key: string) => values.get(key) ?? null,
        setObjectForKey: (value: string, key: string) => values.set(key, value),
        removeObjectForKey: (key: string) => values.delete(key),
      },
    });
    install(appleServices({ form: 'tv', namespace: 'app' }));
    expect(peekService('settings')).toBeUndefined();
    const settings = await loadService('settings');
    expect(imported).toEqual(['settings']);
    await settings.set('theme', 'dark');
    expect(values.get('app:theme')).toBe('dark');
    expect(await settings.get('theme')).toBe('dark');
    await settings.remove('theme');
    expect(await settings.get('theme')).toBeNull();
  });

  it('gives synchronous SDK functions their port at once', () => {
    vi.stubGlobal('NSLocale', {
      preferredLanguages: { firstObject: 'fr-CA' },
    });
    install(appleServices({ form: 'tv' }));
    expect(peekService('locale')?.current()).toBe('fr-CA');
    expect(peekService('keyEvents')?.primaryModifier?.()).toBe('meta');
    expect(imported).toEqual([]);
  });
});

describe('Apple Info.plist requirements', () => {
  it('needs nothing for the services that have no declaration', () => {
    expect(
      appleInfoPlistRequirements(
        ['settings', 'secureStorage', 'clipboard', 'keepAwake'],
        'phone',
      ),
    ).toEqual({
      usageDescriptions: [],
      backgroundModes: [],
      infoPlistKeys: [],
      entitlements: [],
    });
  });

  it('collects usage descriptions, background modes and entitlements', () => {
    expect(
      appleInfoPlistRequirements(
        ['push', 'links', 'geolocation', 'biometrics', 'mediaSession', 'jobs'],
        'phone',
      ),
    ).toEqual({
      usageDescriptions: [
        'NSFaceIDUsageDescription',
        'NSLocationWhenInUseUsageDescription',
      ],
      backgroundModes: ['audio', 'fetch', 'remote-notification'],
      infoPlistKeys: [
        'BGTaskSchedulerPermittedIdentifiers',
        'CFBundleURLTypes',
      ],
      entitlements: ['aps-environment'],
    });
  });

  it('installs the links port only when the host captured one', () => {
    const links = { initial: () => null, subscribe: () => () => {} };
    expect('links' in appleServices({ form: 'tv' })).toBe(false);
    expect(appleServices({ form: 'tv', links }).links).toBe(links);
  });

  it('drops what tvOS has no service for', () => {
    expect(
      appleInfoPlistRequirements(
        ['biometrics', 'geolocation', 'mediaSession'],
        'tv',
      ),
    ).toEqual({
      usageDescriptions: [],
      backgroundModes: ['audio'],
      infoPlistKeys: [],
      entitlements: [],
    });
  });
});

describe('path confinement', () => {
  it('resolves relative and contained absolute paths', () => {
    expect(confine('/app/Documents/', 'a/./b.txt')).toBe(
      '/app/Documents/a/b.txt',
    );
    expect(confine('/app/Documents', 'a/../b.txt')).toBe(
      '/app/Documents/b.txt',
    );
    expect(confine('/app/Documents', '/app/Documents/c')).toBe(
      '/app/Documents/c',
    );
    expect(confine('/app/Documents', '')).toBe('/app/Documents');
  });

  it('refuses paths that leave the root', () => {
    expect(() => confine('/app/Documents', '../Library/x')).toThrow();
    expect(() => confine('/app/Documents', 'a/../../x')).toThrow();
    expect(() => confine('/app/Documents', '/etc/passwd')).toThrow();
    expect(() => confine('/app/Documents', '/app/Documents-other/x')).toThrow();
  });
});
