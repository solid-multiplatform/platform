import type { OpenPlayerRequest, PlayerTrack } from './types';
/** Presentation of the selected output; input indices belong to the server. */
export declare function subtitleIntent(request: OpenPlayerRequest, tracks: readonly PlayerTrack[]): string | null | undefined;
