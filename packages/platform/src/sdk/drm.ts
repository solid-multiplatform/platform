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

let port: MediaCapabilitiesPort | undefined;

export function setMediaCapabilitiesPort(
  next: MediaCapabilitiesPort | undefined,
): void {
  port = next;
}

const COMMON_DRM = [
  'com.widevine.alpha',
  'com.apple.fps',
  'com.microsoft.playready',
];

const COMMON_CODECS = [
  'video/mp4; codecs="avc1.42E01E"',
  'video/webm; codecs="vp9"',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/webm; codecs="opus"',
];

const webCapabilities = async (): Promise<MediaCapabilities> => {
  const drm: string[] = [];
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav?.requestMediaKeySystemAccess) {
    for (const scheme of COMMON_DRM) {
      try {
        await nav.requestMediaKeySystemAccess(scheme, [
          {
            initDataTypes: ['cenc'],
            videoCapabilities: [
              { contentType: 'video/mp4; codecs="avc1.42E01E"' },
            ],
          },
        ]);
        drm.push(scheme);
      } catch {
        // Key system unavailable.
      }
    }
  }
  const codecs =
    typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported
      ? COMMON_CODECS.filter((codec) => MediaSource.isTypeSupported(codec))
      : [];
  const hdr =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(dynamic-range: high)').matches;
  return { drm, codecs, hdr };
};

/** Media codec, DRM and HDR capabilities for the current host. */
export async function mediaCapabilities(): Promise<MediaCapabilities> {
  if (port) return port.get();
  return webCapabilities();
}

/** Whether the host can play a DRM key system (Widevine, FairPlay, …). */
export async function supportsDrm(scheme: string): Promise<boolean> {
  const capabilities = await mediaCapabilities();
  return capabilities.drm.includes(scheme);
}
