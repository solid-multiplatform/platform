import { SessionPlayer } from './session';
import type { NativeVideoEngine, NativeVideoPlatform, TauriVideoInvoker } from './tauri-native/types';
import { type OpenPlayerRequest } from './types';
export * from './tauri-native/types';
export * from './tauri-native/capabilities';
/**
 * The desktop playback seam. It implements the same Player contract as the TV
 * adapters directly over the raw tauri-plugin-video IPC commands
 * (`plugin:video|native_*`), so no @get-air/video dependency enters this
 * bundle: the command payloads, snapshots and wire errors are exactly the ones
 * the plugin's Rust side declares (tauri-plugin-video 0.4, protocol 1).
 *
 * What that engine actually exposes, and what this adapter honestly does not:
 * the native engines render through their own surface — a GTK GPU widget under
 * a WebView aperture on Linux, a WebView2 texture stream on the real video
 * element on Windows — never a canvas. Playback-rate changes and a buffering
 * signal are not part of the command protocol, so neither is reported nor
 * emulated here.
 */
export declare const TAURI_VIDEO_PROTOCOL_VERSION = 1;
export declare function isTauriRuntime(): boolean;
/** Resolves the real plugin bridge; outside Tauri this is an honest failure. */
export declare function resolveTauriVideoInvoker(): TauriVideoInvoker;
/**
 * The native engine keeps its own surface aligned with the anchor element: on
 * Linux the plugin places a GTK widget under a WebView aperture at the
 * element's CSS rectangle, so every layout change is forwarded through
 * native_layout and the DOM stack above the video is made transparent while a
 * native session is live.
 */
export declare class TauriNativeAdapter extends SessionPlayer {
    private readonly anchor;
    readonly capabilities: import("./types").PlayerCapabilities;
    private readonly invoker;
    private readonly platform;
    private readonly engine;
    private nativeEngines?;
    private request?;
    private sessionKey?;
    private native?;
    private startupRetry?;
    private seekGeneration;
    private pendingSeek?;
    private pictureMode;
    private requestedPlaying;
    private protocolVerified;
    private volume;
    private muted;
    private volumeFlush?;
    private timelineOffsetSeconds;
    private timelineDurationSeconds;
    private adoptEngineDuration;
    private observedTitleDuration;
    private pollTimer?;
    private firstFrameTimer?;
    private resizeObserver?;
    private stopCompositorObserver?;
    private readonly aperture;
    private textureStream?;
    private lastLayout?;
    private layoutDirty;
    private compositorDirty;
    private layoutInFlight;
    private layoutTimer?;
    constructor(anchor: HTMLVideoElement, invoker?: TauriVideoInvoker, options?: {
        platform?: NativeVideoPlatform;
        engine?: NativeVideoEngine;
    });
    open(request: OpenPlayerRequest): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionSeconds: number): Promise<void>;
    setPictureMode(mode: 'fit' | 'fill'): Promise<void>;
    setVolume(level: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    selectAudioTrack(trackId: string): Promise<void>;
    selectTextTrack(trackId: string | null): Promise<void>;
    private requireNativePlatform;
    /** The JS/Rust wire contract is verified before any stateful command runs. */
    private verifyProtocol;
    /**
     * Resolves the requested engine into the plugin's backend field. 'auto'
     * follows the plugin's documented preference order (GStreamer first). An
     * explicit engine the diagnostics say is not compiled fails here with a
     * typed `engine-unavailable` error instead of silently playing on another
     * engine; hosts offer only engines from `native_diagnostics`.
     */
    private resolveBackend;
    /**
     * Opens the native session, retrying the exact same delivery once when the
     * engine could not stand up its pipeline. A flaky provider that truncates
     * its first response (playbin3 typefind "Stream doesn't contain enough
     * data") recovers on a fresh engine session; only a repeated failure
     * reaches the session controller's delivery escalation.
     */
    private openNativeSession;
    private control;
    private acceptSnapshot;
    private publishSnapshot;
    /** The seek bar's length: the server total, raised only by an original file. */
    private time;
    private applyVolume;
    private flushVolume;
    private trackIndex;
    private throwOperation;
    private startPolling;
    private schedulePoll;
    private stopPolling;
    private poll;
    private retryDeferredStartup;
    private measureLayout;
    private startLayoutTracking;
    private stopLayoutTracking;
    private handleViewportChange;
    private requestLayout;
    private flushLayout;
    private releaseTextureStream;
    private watchFirstFrame;
    private clearFirstFrameWatchdog;
    private failNative;
    private closeSession;
    private teardownNative;
}
