import { withService } from './registry.js';

export interface MediaCapabilities {
  /** DRM key systems the host reports, e.g. `com.widevine.alpha`. */
  drm: string[];
  /** Codec strings, e.g. `video/mp4; codecs="avc1.42E01E"`. */
  codecs: string[];
  /** HDR display/decoder support. */
  hdr: boolean;
}

export interface MediaCapabilitiesPort {
  get(): Promise<MediaCapabilities>;
}

declare module './registry.js' {
  interface ServiceProviders {
    mediaCapabilities: MediaCapabilitiesPort;
  }
}

/** Media codec, DRM and HDR capabilities for the current host. */
export async function mediaCapabilities(): Promise<MediaCapabilities> {
  return withService('mediaCapabilities', (port) => port.get());
}

/** Whether the host can play a DRM key system (Widevine, FairPlay, …). */
export async function supportsDrm(scheme: string): Promise<boolean> {
  const capabilities = await mediaCapabilities();
  return capabilities.drm.includes(scheme);
}
