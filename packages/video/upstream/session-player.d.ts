import { type PlaybackKind, type Player, type PlayerListener, type PlayerSnapshot, type PlayerState, type PlayerTime, type PlayerTracks, type PlayerFailure } from './types';
/** Internal session gate: adapters call `isCurrent` from every async callback. */
export declare abstract class SessionPlayer implements Player {
    abstract readonly capabilities: Player['capabilities'];
    private listeners;
    private currentSession;
    private nextSession;
    private currentSnapshot;
    get snapshot(): PlayerSnapshot;
    subscribe(listener: PlayerListener): () => void;
    protected startSession(kind: PlaybackKind): number;
    protected isCurrent(sessionId: number): boolean;
    /** An operation outside a live session is a programming error, not a failure. */
    protected activeSessionOrThrow(): number;
    /** Makes every previous callback inert. */
    protected invalidateSession(): void;
    protected update(sessionId: number, patch: {
        diagnostics?: PlayerSnapshot['diagnostics'];
        volume?: PlayerSnapshot['volume'];
        state?: PlayerState;
        time?: PlayerTime;
        tracks?: PlayerTracks;
        error?: PlayerFailure | null;
        qualities?: PlayerSnapshot['qualities'];
        selectedQualityId?: string;
        metadata?: PlayerSnapshot['metadata'];
        captions?: PlayerSnapshot['captions'];
        notice?: PlayerSnapshot['notice'];
    }): void;
    protected terminal(state: Extract<PlayerState, 'stopped' | 'disposed'>): void;
    protected fail(sessionId: number, error: PlayerFailure): void;
    private publish;
    abstract open(request: Parameters<Player['open']>[0]): Promise<void>;
    abstract play(): Promise<void>;
    abstract pause(): Promise<void>;
    abstract seek(positionSeconds: number): Promise<void>;
    abstract stop(): Promise<void>;
    abstract dispose(): Promise<void>;
    abstract selectAudioTrack(trackId: string): Promise<void>;
    abstract selectTextTrack(trackId: string | null): Promise<void>;
}
