/**
 * Every device service the browser can provide. The web host installs this
 * map; nothing in it is imported or constructed until an app first uses the
 * service.
 */
import type { ProviderMap } from '../../sdk/registry.js';
import { deviceServices } from './device.manifest.js';
import { mediaServices } from './media.manifest.js';
import { sensorsServices } from './sensors.manifest.js';

export const webServices: ProviderMap = {
  ...deviceServices,
  ...mediaServices,
  ...sensorsServices,
};
