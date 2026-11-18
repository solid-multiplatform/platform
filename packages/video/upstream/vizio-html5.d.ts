import { SessionPlayer } from './session';
import { type OpenPlayerRequest, type PlayerCapabilities } from './types';
export interface HtmlTextTrack {
    readonly kind: string;
    readonly label: string;
    readonly language: string;
    mode: 'disabled' | 'hidden' | 'showing';
}
export interface HtmlMediaLike {
    crossOrigin?: string | null;
    readonly audioTracks?: ArrayLike<{
        label: string;
        language: string;
        enabled: boolean;
    }>;
    src: string;
    volume?: number;
    muted?: boolean;
    readonly videoWidth?: number;
    readonly videoHeight?: number;
    readonly readyState?: number;
    readonly seeking?: boolean;
    readonly webkitDecodedFrameCount?: number;
    readonly mozDecodedFrames?: number;
    getVideoPlaybackQuality?(): {
        readonly totalVideoFrames: number;
        readonly droppedVideoFrames?: number;
    };
    requestVideoFrameCallback?(callback: (now: number, metadata: {
        mediaTime: number;
        presentedFrames: number;
    }) => void): number;
    cancelVideoFrameCallback?(handle: number): void;
    currentTime: number;
    readonly duration: number;
    readonly buffered?: {
        readonly length: number;
        start(index: number): number;
        end(index: number): number;
    } | null;
    readonly paused: boolean;
    readonly ended: boolean;
    readonly error: {
        readonly code: number;
        readonly message?: string;
    } | null;
    readonly textTracks?: ArrayLike<HtmlTextTrack> & {
        addEventListener?(type: string, listener: () => void): void;
        removeEventListener?(type: string, listener: () => void): void;
    };
    canPlayType?(type: string): string;
    play(): Promise<void>;
    pause(): void;
    load(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    removeAttribute?(name: string): void;
}
export declare const VIZIO_HTML5_CAPABILITIES: PlayerCapabilities;
/**
 * Vizio SmartCast uses the browser-native path. It owns no delivery fallback:
 * the backend selects direct/copy/remux/audio/full transcode before this URL is
 * handed to the adapter and records the selected rung.
 */
export declare class VizioHtml5Adapter extends SessionPlayer {
    private readonly media;
    private readonly options;
    get capabilities(): PlayerCapabilities;
    private readonly handlers;
    private hls;
    private firstFrameTimer?;
    private expectedVideo;
    private frameProgressStart;
    private mediaPoll?;
    private controlGeneration;
    private frameCallback?;
    private frameObservationGeneration;
    private presentedFrame?;
    private frameObservation?;
    private videoFrameProgress;
    private lastMediaPosition;
    private frameProgressVerified;
    private startupDeadline?;
    private nativeHlsFallback;
    private pauseRequested;
    private activeKind;
    private timelineOffsetSeconds;
    private timelineDurationSeconds;
    private adoptEngineDuration;
    private observedTitleDuration;
    private subtitleRequest?;
    private subtitleTimer?;
    private readonly textTrackAdded;
    private pendingOpen;
    constructor(media: HtmlMediaLike, options?: {
        unreliableFrameReporting?: boolean;
    });
    open(request: OpenPlayerRequest): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionSeconds: number): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    selectAudioTrack(id: string): Promise<void>;
    selectQuality(id: string): Promise<void>;
    private tracks;
    selectTextTrack(trackId: string | null): Promise<void>;
    setVolume(level: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    private onVolume;
    private clearFirstFrameWatchdog;
    private startMediaObservation;
    private observePresentedFrames;
    private stopMediaObservation;
    private resetProgressObservation;
    private observeMediaProgress;
    private frameDiagnostics;
    private hasVideoFrame;
    private watchFirstFrame;
    /** The seek bar's length: the server total, raised only by an original file. */
    private titleDuration;
    private onMetadata;
    private onCanPlay;
    private applySubtitleIntent;
    private onPlay;
    private onPause;
    private onWaiting;
    private onTimeUpdate;
    /**
     * `progress` fires while data downloads even when `timeupdate` is silent
     * (mid-stall buffering, paused prefetch). Publishing here keeps the UI's
     * buffered ranges advancing during exactly the states where the viewer
     * watches the bar; ranges stay engine-reported, never invented.
     */
    private onProgress;
    private publishableTime;
    private engineBufferedRanges;
    private onEnded;
    private onError;
    private destroyHls;
    private cancelPendingOpen;
}
