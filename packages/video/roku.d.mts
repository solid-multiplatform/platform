import type { NativePlayer } from './native.mjs';
import type { PlayerSnapshot } from './upstream/index.js';

interface Bounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  visible?: boolean;
}

export interface RokuDrmOptions {
  /** Firmware key system name: `Widevine`, `PlayReady` or `FairPlay`. */
  keySystem?: string;
  /** The licence server the ContentNode names. */
  licenseServerURL?: string;
  /** Certificate passed to `Video.setCertificate` by the host bridge. */
  certificate?: unknown;
  /** Extra `drmParams` for the ContentNode. */
  params?: Record<string, unknown>;
}

export interface RokuMediaCapabilities {
  drm: string[];
  codecs: string[];
  hdr: boolean;
}

export interface RokuMediaSession {
  setMetadata?(metadata: {
    title: string;
    artist?: string;
    album?: string;
    artwork?: { src: string; sizes?: string; type?: string }[];
  }): void;
  setPlaybackState(state: 'none' | 'paused' | 'playing'): void;
  setPositionState?(state: {
    duration: number;
    position: number;
    playbackRate?: number;
  }): void;
  setActionHandler(
    action:
      | 'play'
      | 'pause'
      | 'stop'
      | 'seekbackward'
      | 'seekforward'
      | 'seekto'
      | 'nexttrack'
      | 'previoustrack',
    handler: ((details?: { seekTime: number }) => void) | undefined,
  ): void;
}

export interface RokuVideoOptions extends Bounds {
  /** The adapter's options. */
  streamFormat?: string;
  /** Request headers for the ContentNode's `httpHeaders` field. */
  httpHeaders?: Record<string, string>;
  drm?: RokuDrmOptions;
  /** A host-owned group beneath the app tree; defaults to the root. */
  layer?: object;
  /** Start muted. */
  muted?: boolean;
  /** Enable firmware trick play (default true). */
  trickPlay?: boolean;
  /** Firmware feature answers, e.g. `{ hevc: true, widevine: true }`. */
  features?: Record<string, boolean>;
  /** The host bridge installed by `hosts/roku/anchor.tsx`. */
  host?: {
    send(command: string): void;
    subscribe(listener: (event: unknown) => void): () => void;
    features?(): Record<string, boolean>;
    mediaSession?: RokuMediaSession;
  };
  mediaSession?: RokuMediaSession;
  metadata?: {
    title: string;
    artist?: string;
    album?: string;
    artwork?: { src: string; sizes?: string; type?: string }[];
  };
  onNext?(player: RokuPlayer): void;
  onPrevious?(player: RokuPlayer): void;
}

export interface RokuPlayer extends NativePlayer {
  readonly mediaCapabilities: RokuMediaCapabilities;
  readonly playbackCapabilities: Record<string, unknown>;
  readonly snapshot: PlayerSnapshot;
  /** Trick-play speed: positive forwards, negative rewinds, 1 resumes. */
  setRate(rate: number): Promise<void>;
  fastForward(multiplier?: number): Promise<void>;
  rewind(multiplier?: number): Promise<void>;
}

export function createRokuPlayer(
  root: object,
  options?: RokuVideoOptions,
): RokuPlayer;

export function rokuMediaCapabilities(
  features?: Record<string, boolean>,
): RokuMediaCapabilities;

export function rokuPlaybackCapabilities(
  features?: Record<string, boolean>,
): Record<string, unknown>;

export function rokuStreamFormat(url: string, format?: string): string;
