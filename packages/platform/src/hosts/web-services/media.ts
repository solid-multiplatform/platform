/**
 * The browser's media services that can wait for their code. Loaded on first
 * use of any of them (see ./media.manifest.ts); nothing here runs at import.
 * The ones a browser allows only inside a user gesture are in ./media.sync.ts
 * instead.
 *
 * Every port reads its browser API when an operation is called and throws a
 * `CapabilityError` from the operation when this browser does not have it.
 */
import type { MediaCapabilitiesPort } from '../../sdk/drm.js';
import type { ThumbnailPort } from '../../sdk/media.js';
import { CapabilityError } from '../../sdk/registry.js';

/** A frame of a temporary `<video>`, drawn to a canvas. */
export const thumbnails: ThumbnailPort = {
  async capture(source, time) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = source;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new CapabilityError('thumbnails'));
    });
    video.currentTime = Math.max(0, time);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new CapabilityError('thumbnails');
    context.drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
  },
};

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

/** Probes Encrypted Media Extensions, Media Source and the display. */
export const mediaCapabilities: MediaCapabilitiesPort = {
  async get() {
    const drm: string[] = [];
    if (typeof navigator.requestMediaKeySystemAccess === 'function') {
      for (const scheme of COMMON_DRM) {
        try {
          await navigator.requestMediaKeySystemAccess(scheme, [
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
      typeof matchMedia === 'function' &&
      matchMedia('(dynamic-range: high)').matches;
    return { drm, codecs, hdr };
  },
};
