import type { PlaybackCapabilities } from './types';
export { supportsNativeHls } from './primitives';
export interface BrowserProbeEnvironment {
    readonly media: {
        canPlayType(type: string): string;
    };
    readonly decodingInfo?: (configuration: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>;
    readonly mseSupported: boolean;
    readonly mseTypeSupported: (type: string) => boolean;
    readonly timeoutMs?: number;
}
export interface BrowserPlaybackProbe {
    readonly capabilities: PlaybackCapabilities;
    readonly canPlayManagedHls: boolean;
    readonly protocols: {
        readonly nativeHls: boolean;
        readonly mseHls: boolean;
        readonly selectedHls: 'mediabunny' | 'native' | 'mse' | 'unsupported';
    };
    readonly evidence: readonly string[];
}
/** Probe each executable decoding path separately; actual track preparation remains authoritative. */
export declare function probeBrowserPlaybackCapabilities(environment?: BrowserProbeEnvironment, options?: {
    mediabunny?: boolean;
}): Promise<BrowserPlaybackProbe>;
