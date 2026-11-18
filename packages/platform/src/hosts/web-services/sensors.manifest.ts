// Browser providers for: geolocation, sensors, maps, contacts, calendar, biometrics, menus, update delivery.
// Each entry loads its implementation from ./sensors.ts on first use.
import type { ProviderMap } from '../../sdk/registry.js';

export const sensorsServices: ProviderMap = {};
