import { PlayerOperationError, type PlayerFailure, type MediaFailureReason } from './types';
declare let policy: {
    clientInspection: boolean;
    localRemux: boolean;
};
/** Rollout switches are supplied by the host, never inferred from user agent. */
export declare function configureBrowserPlayback(value: Partial<typeof policy>): void;
export declare function browserPlaybackPolicy(): Readonly<typeof policy>;
export declare function mediaFailure(cause: unknown, reason?: MediaFailureReason): PlayerOperationError;
export declare function canChangeMediaPath(failure: Pick<PlayerFailure, 'code' | 'reason'>): boolean;
export {};
