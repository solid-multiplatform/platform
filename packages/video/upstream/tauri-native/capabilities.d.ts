import type { PlaybackCapabilities, PlayerCapabilities } from '../types';
export declare const TAURI_NATIVE_PLAYER_CAPABILITIES: PlayerCapabilities;
/**
 * The desktop no-transcode delivery profile handed to the backend's session
 * ladder: a broad native codec and container set with direct delivery
 * preferred. The server's own container, single-stream and HDR rules still
 * decide the rung; this client never requests managed-only or forced output.
 */
export declare const TAURI_NATIVE_DELIVERY_CAPABILITIES: PlaybackCapabilities;
