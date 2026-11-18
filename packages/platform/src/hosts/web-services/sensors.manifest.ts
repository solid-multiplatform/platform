// Browser providers for: geolocation, sensors.
// Synchronous SDK functions read both (`watchPosition`, `watchSensor`), so
// they are the plain objects of ./sensors.ts rather than loaded on first use.
//
// Not here: maps and update delivery (the SDK opens a link through
// `openExternal` instead); contacts, calendar, biometrics and menus, which the
// SDK has no browser implementation for.
import type { ProviderMap } from '../../sdk/registry.js';
import { geolocation, sensors } from './sensors.js';

export const sensorsServices: ProviderMap = { geolocation, sensors };
