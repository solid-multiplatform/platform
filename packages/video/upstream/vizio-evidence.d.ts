import type { PlaybackEngineEvidence } from './types';
/** Physical Conjure evidence, 2026-09-27. Firmware/engine changes invalidate it.
 * H.264: 1080p30/60; HEVC Main/Main10: 2160p24 SDR. No HDR claim.
 * See the media qualification report; frame callbacks are not usable on this firmware.
 */
export declare function qualifiedVizioEvidence(userAgent: string, mseTypeSupported: (mime: string) => boolean): PlaybackEngineEvidence[];
