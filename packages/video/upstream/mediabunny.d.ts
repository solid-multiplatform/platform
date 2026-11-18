import { type InputTrack } from 'mediabunny';
import { SessionPlayer } from './session';
import { type OpenPlayerRequest, type PlayerCapabilities } from './types';
export { sessionMediaFetch } from './session-media-fetch';
/** A bounded two-frame / half-second audio pipeline; no full-file buffering or local encoding. */
export declare class MediabunnyAdapter extends SessionPlayer {
    private readonly canvas;
    readonly capabilities: PlayerCapabilities;
    private input?;
    private context?;
    private gain?;
    private videoSink?;
    private videoTrack?;
    private audioSink?;
    private videoIterator?;
    private audioIterator?;
    private nodes;
    private request?;
    private generation;
    private sourceGeneration;
    private running;
    private animation?;
    private frames;
    private videoEnd;
    private audioEnd;
    private audioTrack?;
    private scheduled;
    private qualityId;
    private adaptive;
    private switching;
    private lastSwitch;
    private videoChoices;
    private liveWindow?;
    private presented;
    private dropped;
    private previewPending;
    private openingGeneration;
    private performanceStart;
    private liveStalls;
    private bufferingSince;
    private lastLiveReconnect;
    private rejectedQualities;
    private playing;
    private position;
    private firstTimestamp;
    private duration;
    private observedTitleDuration;
    private anchor;
    private volume;
    private muted;
    private ticker?;
    private videoDone;
    private audioDone;
    private live;
    private liveRefresh?;
    /** Decoded-ahead window end in native seconds, past the live position. */
    private decodedEnd;
    /** Audio packets decoded ahead of the clock, scheduled as the clock drains. */
    private audioQueue;
    /** True while the audio producer is still filling the queue. */
    /** Bound on queued audio packets: enough readahead to feed the preseek gate. */
    private readonly audioQueueLimit;
    constructor(canvas: HTMLCanvasElement);
    open(request: OpenPlayerRequest): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(position: number): Promise<void>;
    setVolume(level: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    selectAudioTrack(id: string): Promise<void>;
    loadAudioTracks(): Promise<void>;
    private publishTracks;
    selectQuality(id: string): Promise<void>;
    private switchQuality;
    preview(position: number): Promise<Blob | null>;
    selectTextTrack(): Promise<void>;
    /** Keeps a rolling window fresh so the read cursor can follow its edge. */
    private refreshLiveWindow;
    private draw;
    private currentPosition;
    private time;
    private applyVolume;
    private videoLoop;
    private audioLoop;
    private present;
    private stopNodes;
    private decoderFailed;
    private cancelLoops;
    private release;
}
/** Registers the matching decoder when a track's own codec is not decodable yet. */
export declare function ensureDecodable(track: InputTrack | null | undefined): Promise<boolean>;
/** Video and audio codecs this client can decode, for the server's delivery choice. */
export declare function decodableCodecs(): Promise<{
    video: string[];
    audio: string[];
}>;
