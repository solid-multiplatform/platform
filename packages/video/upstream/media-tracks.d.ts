import type { Input, InputAudioTrack, InputVideoTrack } from 'mediabunny';
import type { OpenPlayerRequest, PlayerQuality, PlayerTrack } from './types';
export { mediaLanguage } from './primitives';
export declare const trackId: (type: string, id: number) => string;
export declare function audioChoices(video: InputVideoTrack): Promise<{
    tracks: InputAudioTrack[];
    choices: PlayerTrack[];
}>;
export declare function chooseAudio(video: InputVideoTrack, request: OpenPlayerRequest): Promise<InputAudioTrack | null>;
export declare function videoChoices(input: Input): Promise<{
    tracks: InputVideoTrack[];
    choices: PlayerQuality[];
}>;
/** Conservative EWMA: cached/tiny transfers do not inflate the sustainable rate. */
export declare class AdaptiveQuality {
    private slow;
    private fast;
    private upgradeSince;
    sample(bytes: number, seconds: number): void;
    choose(qualities: readonly PlayerQuality[], current: string, bufferedSeconds: number, now: number): string;
}
