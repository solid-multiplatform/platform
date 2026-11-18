import { type AvplayManager } from './tizen-avplay';
import { type NativeVideoEngine } from './tauri-native';
import type { HtmlMediaLike } from './vizio-html5';
import type { Player, PlayerPlatform } from './types';
export * from './types';
export * from './session';
export * from './tizen-avplay';
export * from './vizio-html5';
export * from './html5-fallback';
export * from './tauri-native';
export * from './platform-profiles';
export { parseWebVtt, type CaptionCue } from './captions';
export interface CreatePlayerOptions {
    readonly platform: PlayerPlatform;
    readonly video?: HtmlMediaLike;
    readonly canvas?: HTMLCanvasElement;
    readonly avplay?: AvplayManager;
    /** The native engine the desktop host requests; 'auto' follows the plugin's preference order. */
    readonly engine?: NativeVideoEngine;
}
/** One factory keeps the React UI independent of the TV's playback engine. */
export declare function createPlayer(options: CreatePlayerOptions): Player;
export * from './browser-capabilities';
export * from './browser-policy';
export { SubtitleSyncView, type SubtitleSyncRecord, type SubtitleWindow } from './subtitle-sync';
