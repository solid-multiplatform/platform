import type { PlayerTrack } from './types';
export interface CaptionCue {
    start: number;
    end: number;
    text: string;
}
/** Plain cue text is rendered as text, never inserted as HTML. */
export declare function parseWebVtt(text: string, offset?: number): CaptionCue[];
/** Caption extraction is requested only when the viewer opens the subtitle list. */
export declare class BrowserCaptions {
    private readonly changed;
    private tracks;
    private selected;
    private cues;
    private block;
    private generation;
    private loading;
    private abort;
    private readonly base;
    private readonly fetch;
    constructor(url: string, changed: (tracks: PlayerTrack[], selected: string | null, captions: string[]) => void);
    discover(): Promise<void>;
    select(id: string | null, position: number): Promise<void>;
    tick(position: number): void;
    private load;
    dispose(): void;
}
