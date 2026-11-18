import type {
  OpenPlayerRequest,
  PlayerCapabilities,
  PlayerSnapshot,
  PlayerListener,
  PlayerTrack,
  PlaybackSessionControllerOptions,
} from './upstream/index.js';
export { PlayerOperationError } from './upstream/index.js';
export interface NativeDriver {
  prepare(url: string): Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(seconds: number): void | Promise<void>;
  dispose(): void;
  selectAudioTrack?(id: string): void | Promise<void>;
  selectTextTrack?(id: string | null): void | Promise<void>;
  setMuted?(value: boolean): void | Promise<void>;
  setVolume?(value: number): void | Promise<void>;
  setPictureMode?(mode: 'fit' | 'fill'): void | Promise<void>;
}
export type NativePlatform =
  | 'android'
  | 'android-tv'
  | 'ios'
  | 'apple-tv'
  | 'roku'
  | 'desktop';
export class NativePlayer {
  constructor(
    platform: NativePlatform,
    engine: string,
    create: (
      request: OpenPlayerRequest,
      notify: (patch: Partial<PlayerSnapshot>) => void,
    ) => NativeDriver,
    features?: Partial<Omit<PlayerCapabilities, 'platform'>>,
  );
  readonly capabilities: Omit<PlayerCapabilities, 'platform'> & {
    platform: NativePlatform;
  };
  readonly snapshot: PlayerSnapshot;
  subscribe(listener: PlayerListener): () => void;
  open(request: OpenPlayerRequest): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  selectAudioTrack(id: string): Promise<void>;
  selectTextTrack(id: string | null): Promise<void>;
  setPictureMode(mode: 'fit' | 'fill'): Promise<void>;
  setVolume(value: number): Promise<void>;
  setMuted(value: boolean): Promise<void>;
}
type Controller = import('./upstream/index.js').PlaybackSessionController;
export const PlaybackSessionController: new (
  options: Omit<PlaybackSessionControllerOptions, 'player'> & {
    player: NativePlayer;
  },
) => Controller;
