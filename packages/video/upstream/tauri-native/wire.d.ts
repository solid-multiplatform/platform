import { PlayerOperationError, type PlayerDiagnostics, type PlayerErrorCode, type PlayerTracks } from '../types';
import type { NativeLayout } from './aperture';
import type { NativeVideoSnapshot, NativeVideoTrack } from './types';
interface WebView2TextureStreamApi {
    getTextureStream(streamId: string): Promise<MediaStream>;
}
export declare function webView2TextureStream(): WebView2TextureStreamApi | undefined;
export declare function newSessionKey(): string;
export declare function nativeOperationError(cause: unknown, fallback: PlayerErrorCode, message: string): PlayerOperationError;
export declare function nativeDiagnostics(url: string, backend?: string): PlayerDiagnostics;
export declare function engineDuration(snapshot: NativeVideoSnapshot | undefined, kind?: 'vod' | 'live'): number | null;
export declare function hasEnded(snapshot: NativeVideoSnapshot | undefined, kind?: 'vod' | 'live'): boolean;
export declare function selectedCodec(snapshot: NativeVideoSnapshot, kind: 'video' | 'audio'): string | undefined;
export declare function sameLayout(a: NativeLayout | undefined, b: NativeLayout | undefined): boolean;
export declare function tracksFromNative(tracks: readonly NativeVideoTrack[]): PlayerTracks;
export {};
