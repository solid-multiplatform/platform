import { SessionPlayer } from './session';
import { type OpenPlayerRequest, type PlayerCapabilities } from './types';
export interface AvplayTrackInfo {
    readonly index: number;
    readonly type: 'VIDEO' | 'AUDIO' | 'TEXT';
    readonly extra_info: string;
}
export interface AvplayListener {
    onbufferingstart?: () => void;
    onbufferingcomplete?: () => void;
    oncurrentplaytime?: (milliseconds: number) => void;
    onstreamcompleted?: () => void;
    onerror?: (error: string) => void;
    onerrormsg?: (error: string, message: string) => void;
}
/** The small, injectable subset of Samsung's documented `webapis.avplay`. */
export interface AvplayManager {
    open(url: string): void;
    close(): void;
    prepareAsync(success: () => void, error?: (error: unknown) => void): void;
    play(): void;
    pause(): void;
    stop(): void;
    seekTo(milliseconds: number, success?: () => void, error?: (error: unknown) => void): void;
    getCurrentTime(): number;
    getDuration(): number;
    getTotalTrackInfo(): readonly AvplayTrackInfo[];
    setListener(listener: AvplayListener): void;
    setDisplayRect?(x: number, y: number, width: number, height: number): void;
    setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
    setSilentSubtitle(enabled: boolean): void;
    setStreamingProperty?(property: 'COOKIE' | 'USER_AGENT', value: string): void;
}
export declare const TIZEN_AVPLAY_CAPABILITIES: PlayerCapabilities;
export declare class TizenAvplayAdapter extends SessionPlayer {
    private readonly avplay;
    readonly capabilities: PlayerCapabilities;
    private pendingOpen;
    private pendingSeek;
    private lifecycleGeneration;
    private timelineOffsetSeconds;
    private timelineDurationSeconds;
    private adoptEngineDuration;
    private observedTitleDuration;
    private subtitleRequest?;
    private pauseRequested;
    private bufferingPosition;
    constructor(avplay?: AvplayManager);
    open(request: OpenPlayerRequest): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionSeconds: number): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    selectAudioTrack(trackId: string): Promise<void>;
    selectTextTrack(trackId: string | null): Promise<void>;
    private prepared;
    private preparationFailed;
    private listenerFor;
    private updateTimeFromEngine;
    private durationSeconds;
    private applyAuthorization;
    private findTrack;
    private applySubtitleIntent;
    private throwOperation;
    private resolvePending;
    private cancelPendingOpen;
    private afterSeek;
    private nativeSeek;
    private closeSafely;
    private setDisplayRect;
}
