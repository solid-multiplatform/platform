import type { PlaybackCapabilities, PlaybackKind, PlaybackSessionView, PlaybackStart, Player, PlayerFailure } from './types';
import type { PlaybackControllerState, PlaybackIntentItem, SessionStartIntent } from './session';
export declare function playbackRequest(intent: SessionStartIntent, capabilities: PlaybackCapabilities, position: number): PlaybackStart;
export declare function isOriginalDelivery(session: PlaybackSessionView): boolean;
export declare function adapterRequest(session: PlaybackSessionView, kind: PlaybackKind, position: number, paused: boolean): Parameters<Player['open']>[0];
export declare function itemKind(item: PlaybackIntentItem): PlaybackKind;
/** A settled controller is 'playing' (including paused) unless the adapter failed. */
export declare function playerState(player: Player): Extract<PlaybackControllerState, 'playing' | 'error'>;
export declare function asError(cause: unknown): Error;
/**
 * A delivery refusal is answered with the next delivery rung for the same
 * source: original delivery, then managed output, then a forced transcode.
 * Only a server delivery refusal (406) escalates. Transport failures
 * (status 0) never convert media, and validation (400) and every other
 * answer keep their own meaning.
 */
export declare function escalatePreparation(request: PlaybackStart, error: unknown): PlaybackStart | undefined;
/**
 * The retry request for a failed open or playback: the recovery rung plus the
 * failure's track selection and conversion reason, so the server converts
 * only what the device could not present.
 */
export declare function failureRetryRequest(recovery: PlaybackStart, failure: Pick<PlayerFailure, 'selection' | 'reason'> | undefined): PlaybackStart;
/** Keep the selected source while escalating only after the cheaper rung fails. */
export declare function recoveryRequest(session: PlaybackSessionView, request: PlaybackStart, code: PlayerFailure['code']): PlaybackStart | undefined;
