import type { CaptionCue } from './captions';
export interface SubtitleSyncRecord {
    version: 1;
    playback_generation: string;
    media_identity: string;
    audio_identity: string;
    subtitle_hash: string;
    algorithm_version: string;
    revision: number;
    state: 'observing' | 'accepted' | 'ambiguous' | 'unavailable';
    manual: boolean;
    correction: {
        anchorUs: number;
        offsetUs: number;
        scale: number;
    } | null;
}
export interface SubtitleWindow {
    readonly texts: readonly string[];
    readonly deferred: boolean;
}
export declare class SubtitleSyncView {
    private readonly generation;
    private readonly subtitleHash;
    private readonly cues;
    private readonly prefixEnd;
    private record?;
    private seenRevision;
    private identity?;
    private manualSeconds;
    private frozen;
    private disposed;
    private pending?;
    private pendingAtSeconds?;
    private lastTitleSeconds?;
    constructor(cues: readonly CaptionCue[], generation: string, subtitleHash: string);
    accept(record: SubtitleSyncRecord): boolean;
    manualDelay(seconds: number): void;
    resume(): void;
    at(playerSeconds: number, originSeconds: number): SubtitleWindow;
    private subtitleTime;
    private lookup;
    dispose(): void;
}
