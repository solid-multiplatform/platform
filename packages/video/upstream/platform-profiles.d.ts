import type { PlaybackCapabilities, PlayerPlatform } from './types';
/**
 * Delivery capability profiles for each platform entry point
 * (design ADR 0003, platform matrix).
 *
 * These are the profiles the server consults while choosing a rung of its
 * delivery ladder: direct native file, original container for a client that
 * demuxes itself, or managed conversion. They are deliberately separate from
 * the engine `PlayerCapabilities` records the adapters declare. TV engines
 * and the desktop host are qualified by their own runtime — a desktop
 * browser decoder probe must never gate their delivery — and only the web
 * entry point is measured.
 */
/**
 * Samsung AVPlay: native H.264/HEVC/AAC decode up to 1080p. Direct play takes
 * the native envelope (H.264 copy, HEVC Main/SDR); whatever the envelope
 * refuses falls to managed conversion. The original-container rung is a
 * WebCodecs client contract and stays off.
 */
export declare const TIZEN_DELIVERY_CAPABILITIES: PlaybackCapabilities;
/**
 * Vizio SmartCast cast receiver: the receiver is the tv-web bundle running in
 * the TV's HTML engine — native HLS, then hls.js/MSE — with no WebCodecs
 * path. It claims only the measured baseline (H.264/AAC at 1080p): HEVC stays
 * unclaimed rather than assumed, the original-container rung stays off, and
 * every source this envelope refuses is served through the managed ladder
 * (copy/remux, then conversion only as necessary).
 */
export declare const VIZIO_DELIVERY_CAPABILITIES: PlaybackCapabilities;
/**
 * Web browser entry: the one platform whose delivery profile is measured
 * rather than declared. The probe reports the browser's real decoder
 * envelope, including the separate direct MP4/HLS fields and the WebCodecs
 * codec lists that gate the original-container rung. A browser that cannot
 * play managed HLS cannot use the supported streaming output at all, so the
 * gate rejects loudly. A successful probe is memoized; a failed one is
 * retried on the next session start.
 */
export declare function webDeliveryCapabilities(): Promise<PlaybackCapabilities>;
/**
 * Canonical per-platform dispatch for the tv-web entry point. Tizen, Vizio
 * and the Tauri desktop host resolve their declared profiles without ever
 * consulting a browser decoder probe; only `html5` is measured.
 */
export declare function deliveryCapabilitiesFor(platform: PlayerPlatform): () => Promise<PlaybackCapabilities>;
