import { jsonDeviceStorage } from './device-storage';
import { services } from '@solid-multiplatform/platform/services';

export function rokuServices(section: string) {
  return services({
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
  });
}
