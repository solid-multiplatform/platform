// The device services of the desktop host. Each export makes a port when an
// app first uses the service (see ./manifest.ts): nothing here runs before.
import type {
  BatteryPort,
  ClipboardPort,
  DeviceInfo,
  DeviceInfoPort,
  KeepAwakePort,
  MemoryPort,
  OpenExternalPort,
} from '@solid-multiplatform/platform/device';
import type { LocalePort } from '@solid-multiplatform/platform/i18n';
import {
  CapabilityError,
  type LifecyclePort,
} from '@solid-multiplatform/platform/services';
import type { KeyEventsPort } from '@solid-multiplatform/platform/shortcuts';
import type { ColorSchemePort } from '@solid-multiplatform/platform/theme';
import { onNative } from '../events.js';

export function clipboard(): ClipboardPort {
  const native = __solid.clipboard!;
  // Async, so that the system's refusal is a rejection.
  return {
    readText: async () => native.read(),
    writeText: async (text) => native.write(text),
  };
}

export function openExternal(): OpenExternalPort {
  return { open: async (url) => __solid.system.openURL(url) };
}

export function deviceInfo(appVersion: string | undefined): DeviceInfoPort {
  return {
    async get(): Promise<DeviceInfo> {
      const info = __solid.system.info();
      return {
        platform: 'desktop',
        os: info.os,
        // As the runtime names it: `x86_64`, `aarch64`.
        arch: info.arch,
        model: info.model,
        osVersion: info.osVersion,
        appVersion,
      };
    },
  };
}

export function battery(): BatteryPort {
  return {
    async get() {
      const power = __solid.system.power();
      // A machine without a battery, or a system that does not say.
      if (
        power.state === 'none' ||
        power.state === 'unknown' ||
        power.percent === undefined
      ) {
        return undefined;
      }
      return {
        level: power.percent / 100,
        charging: power.state !== 'battery',
      };
    },
  };
}

export function memory(): MemoryPort {
  return {
    get() {
      const megabytes = __solid.system.info().memoryMb;
      return {
        deviceMemoryGb: megabytes > 0 ? megabytes / 1024 : undefined,
        // The system gives no low-memory signal: the SDK applies the app's
        // threshold to the size.
        lowMemory: false,
      };
    },
  };
}

export function keepAwake(): KeepAwakePort {
  const window = __solid.window!;
  return {
    async set(active) {
      // The runtime starts with the screen saver allowed.
      if (!window.allowScreenSaver(!active)) {
        throw new CapabilityError('keepAwake');
      }
    },
  };
}

export function colorScheme(): ColorSchemePort {
  const window = __solid.window!;
  // A system that does not say reads as light, the platform's own default.
  const current = () => (window.theme() === 'dark' ? 'dark' : 'light');
  return {
    current,
    subscribe: (listener) => onNative('theme', () => listener(current())),
  };
}

export function locale(): LocalePort {
  return {
    // Read each time: the user may change it while the app runs. Empty when
    // the system does not say, which the SDK reads as its own default.
    current: () => __solid.system.locales()[0] ?? '',
  };
}

export function keyEvents(target: EventTarget): KeyEventsPort {
  const primary = primaryModifier();
  return { target: () => target, primaryModifier: () => primary };
}

/** Command on a Mac's keyboard, Control on every other. */
export function primaryModifier(): 'meta' | 'ctrl' {
  return __solid.system.info().os === 'macos' ? 'meta' : 'ctrl';
}

export function lifecycle(): LifecyclePort {
  const window = __solid.window!;
  const active = (): boolean => {
    const state = window.state();
    return (
      state.focused && !state.minimized && !state.occluded && !state.hidden
    );
  };
  return {
    active,
    subscribe(listener) {
      let last = active();
      const check = (): void => {
        const now = active();
        if (now !== last) listener((last = now));
      };
      const stops = [
        onNative('focus', check),
        onNative('blur', check),
        onNative('windowstate', check),
      ];
      return () => stops.forEach((stop) => stop());
    },
  };
}
