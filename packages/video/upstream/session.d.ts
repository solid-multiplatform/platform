import { type PlaybackCapabilities, type PlaybackSessionView, type PlaybackStart, type Player, type PlayerSnapshot } from './types';
export * from './session-player';
/**
 * The catalog identity the controller needs to start playback. Applications
 * bind their own richer item and source types through the generic parameters.
 */
export interface PlaybackIntentItem {
    readonly id: string;
    readonly type: string;
}
export interface PlaybackIntentSource {
    readonly id: string;
}
/** A source is always explicit for ordinary VOD and Resume flows. */
export interface SessionStartIntent<Item extends PlaybackIntentItem = PlaybackIntentItem, Source extends PlaybackIntentSource = PlaybackIntentSource> {
    readonly item: Item;
    readonly source?: Source;
    readonly position?: number;
}
export interface TrackReplacement {
    readonly audioTrackIndex?: number;
    readonly subtitleTrackIndex?: number;
    readonly subtitlesOff?: boolean;
}
export interface PlaybackControllerActive<Item extends PlaybackIntentItem = PlaybackIntentItem, Source extends PlaybackIntentSource = PlaybackIntentSource> {
    readonly intent: SessionStartIntent<Item, Source>;
    readonly session: PlaybackSessionView;
    readonly request: PlaybackStart;
}
export type PlaybackControllerState = 'idle' | 'opening' | 'playing' | 'replacing' | 'preparing-next' | 'stopped' | 'error';
export interface PlaybackControllerSnapshot<Item extends PlaybackIntentItem = PlaybackIntentItem, Source extends PlaybackIntentSource = PlaybackIntentSource> {
    readonly state: PlaybackControllerState;
    readonly active: PlaybackControllerActive<Item, Source> | null;
    readonly error: Error | null;
}
export type PlaybackControllerListener<Item extends PlaybackIntentItem = PlaybackIntentItem, Source extends PlaybackIntentSource = PlaybackIntentSource> = (snapshot: PlaybackControllerSnapshot<Item, Source>) => void;
/**
 * The server playback port this controller coordinates. The application binds
 * its own API client; startPlayback rejections are `Error`s carrying an
 * HTTP-like `status` where 0 means transport failure.
 */
export interface PlaybackBackend {
    startPlayback(request: PlaybackStart, options?: {
        readonly signal?: AbortSignal;
    }): Promise<PlaybackSessionView>;
    stopPlayback(sessionId: string): Promise<void>;
    /** A local transport can explicitly forbid server conversion for its admitted session. */
    canConvertPlayback?(sessionId: string): boolean;
    remainingStartupBudget?(sessionId: string): Promise<number | undefined>;
}
export interface PlaybackSessionControllerOptions {
    readonly player: Player;
    readonly retireOnReplace?: boolean;
    readonly backend: PlaybackBackend;
    readonly capabilities: PlaybackCapabilities | (() => Promise<PlaybackCapabilities>);
}
/**
 * Coordinates the server's opaque playback session with one device adapter.
 * It never discovers or ranks a replacement source. On managed seeks/tracks it
 * starts one replacement for the same selected source and restores the old
 * session if the device cannot open the candidate.
 */
export declare class PlaybackSessionController<Item extends PlaybackIntentItem = PlaybackIntentItem, Source extends PlaybackIntentSource = PlaybackIntentSource> {
    private readonly options;
    private readonly listeners;
    private current;
    private nextGeneration;
    private operationGeneration;
    private readonly pendingStarts;
    private nextOperation;
    private prepareSession;
    private activePlayerSessionId;
    private retiringPresentation?;
    private pausedPlayerSessionId;
    private readonly recoveredSessions;
    /** The one next-operation Back is allowed to restore after adapter open. */
    private restoreRequestedOperation;
    private currentSnapshot;
    constructor(options: PlaybackSessionControllerOptions);
    get snapshot(): PlaybackControllerSnapshot<Item, Source>;
    subscribe(listener: PlaybackControllerListener<Item, Source>): () => void;
    start(intent: SessionStartIntent<Item, Source>): Promise<PlaybackControllerActive<Item, Source>>;
    /** Observe the actual adapter snapshot, including decoder failures after open. */
    recoverPlayback(snapshot: PlayerSnapshot): Promise<boolean>;
    seek(position: number): Promise<void>;
    /**
     * Repeated seeks: a replacement that is superseded before it starts is
     * abandoned at once instead of finishing a second managed session. Every
     * started session holds provider capacity, so rapid presses would otherwise
     * exhaust the provider's connection budget and be refused with 429.
     */
    seekFrom(resolvePosition: () => number, currentPosition: () => number): Promise<void>;
    replaceTracks(selection: TrackReplacement): Promise<void>;
    /**
     * The resolver is supplied by the UI/backend continuation flow. It must
     * provide the bounded next source already chosen by that flow; this module
     * never falls through to a different provider.
     */
    prepareNext(resolveNext: () => Promise<SessionStartIntent<Item, Source> | null>): Promise<void>;
    /**
     * Back requests restoration if AVPlay/HTML media has already switched to a
     * next candidate. Internal replacement and stop callers pass false: their
     * newer operation owns the adapter and an old operation must stay inert.
     */
    cancelNext(restoreOutgoing?: boolean): void;
    stop(options?: {
        releaseBeforePlayer?: boolean;
    }): Promise<void>;
    private transition;
    private restore;
    /** An invalidated UI operation either yields the current owner or AbortError. */
    private cancelledResult;
    private resolveCapabilities;
    private requireActive;
    private publish;
}
