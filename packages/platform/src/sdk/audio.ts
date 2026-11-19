import { createSignal, type Accessor } from 'solid-js';
import {
  CapabilityError,
  loadService,
  peekService,
  serviceAvailable,
} from './registry.js';

export interface AudioTrack {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  /** Seconds. */
  duration?: number;
}

export interface AudioPlayOptions {
  /** Start position in seconds. */
  position?: number;
  volume?: number;
}

/**
 * What the host's player is doing. `interrupted` is a pause the app did not
 * ask for: another app took audio focus, a call came in, the output went
 * away. `playing` follows when the host resumes by itself.
 */
export type AudioPlaybackState = 'playing' | 'paused' | 'ended' | 'interrupted';

export interface AudioPort {
  play(track: AudioTrack, options?: AudioPlayOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): void;
  /**
   * Reports playback changes: at least the ones the app did not make
   * itself (an interruption, the host resuming, the track's end). Returns
   * the function that stops reporting. A host without them leaves this out.
   */
  subscribe?(listener: (state: AudioPlaybackState) => void): () => void;
}

declare module './registry.js' {
  interface ServiceProviders {
    audio: AudioPort;
  }
}

export interface AudioPlayer {
  track: Accessor<AudioTrack | undefined>;
  playing: Accessor<boolean>;
  volume: Accessor<number>;
  play(track: AudioTrack, options?: AudioPlayOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): void;
}

/**
 * Shared audio playback controller over the host's `audio` service (one
 * `HTMLAudioElement` on the web). Resume/bookmarks and the media session are
 * separate helpers, so a player can compose them.
 */
export function createAudioPlayer(
  options: { port?: AudioPort; volume?: number } = {},
): AudioPlayer {
  // The port, when it can be had without waiting. Each method then calls it
  // in the caller's own turn: browsers start playback only inside the user's
  // gesture. A provider that still has to load is awaited instead.
  const ready = () => options.port ?? peekService('audio');
  const [track, setTrack] = createSignal<AudioTrack | undefined>();
  const [playing, setPlaying] = createSignal(false);
  const [volume, setVolumeSignal] = createSignal(options.volume ?? 1);

  // The port's own playback changes (loss of audio focus, the track's end),
  // followed only from `play` or `resume` until `stop` or the track's end:
  // a player that plays nothing listens to nothing.
  let unfollow: (() => void) | undefined;
  const stopFollowing = () => {
    unfollow?.();
    unfollow = undefined;
  };
  const follow = (port: AudioPort) => {
    if (unfollow !== undefined || !port.subscribe) return;
    unfollow = port.subscribe((state) => {
      setPlaying(state === 'playing');
      if (state === 'ended') stopFollowing();
    });
  };

  return {
    track,
    playing,
    volume,
    async play(next, playOptions = {}) {
      const port = ready() ?? (await loadService('audio'));
      await port.play(next, {
        ...playOptions,
        volume: playOptions.volume ?? volume(),
      });
      setTrack(next);
      setPlaying(true);
      follow(port);
    },
    async pause() {
      const port = ready() ?? (await loadService('audio'));
      await port.pause();
      setPlaying(false);
    },
    async resume() {
      const port = ready() ?? (await loadService('audio'));
      await port.resume();
      setPlaying(true);
      follow(port);
    },
    async stop() {
      const port = ready() ?? (await loadService('audio'));
      stopFollowing();
      await port.stop();
      setPlaying(false);
      setTrack(undefined);
    },
    async seek(position) {
      const port = ready() ?? (await loadService('audio'));
      await port.seek(position);
    },
    setVolume(next) {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeSignal(clamped);
      if (options.port) return options.port.setVolume(clamped);
      if (serviceAvailable('audio') === 'unavailable')
        throw new CapabilityError('audio');
      // A provider that has not loaded yet is playing nothing; `play` hands
      // it the volume kept above.
      peekService('audio')?.setVolume(clamped);
    },
  };
}
