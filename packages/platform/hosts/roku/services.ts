import { jsonDeviceStorage } from './device-storage';
import type { ProviderMap } from '@solid-multiplatform/platform/services';

/** The Roku host's application services, for `installServices`. */
export function rokuServices(section: string): ProviderMap {
  return {
    settings: {
      async get(k) {
        return jsonDeviceStorage<string>(section, k).load();
      },
      async set(k, v) {
        await jsonDeviceStorage<string>(section, k).save(v);
      },
      async remove(k) {
        await jsonDeviceStorage<string>(section, k).clear();
      },
    },
  };
}
