import type { MemoryPort } from '@solid-multiplatform/platform/device';

/** Physical memory. The SDK applies its own low-memory threshold to it. */
export function memory(): MemoryPort {
  return {
    get: () => ({
      deviceMemoryGb: NSProcessInfo.processInfo.physicalMemory / 2 ** 30,
      lowMemory: false,
    }),
  };
}
