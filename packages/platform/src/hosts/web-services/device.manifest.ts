// Browser providers for: clipboard, share, haptics, device info, battery, memory, keep-awake, orientation, system bars, app review, external links, settings, lifecycle, connectivity, deep links, notifications, push, background jobs.
// Each entry loads its implementation from ./device.ts on first use.
import type { ProviderMap } from '../../sdk/registry.js';

export const deviceServices: ProviderMap = {};
