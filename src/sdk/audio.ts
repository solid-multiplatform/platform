import { createSignal, type Accessor } from 'solid-js';
import { CapabilityError } from './services.js';

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

export interface AudioPort {
  play(track: AudioTrack, options?: AudioPlayOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): void;
}

let port: AudioPort | undefined;

export function setAudioPort(next: AudioPort | undefined): void {
  port = next;
}

const webAudio = (): AudioPort => {
  if (typeof Audio === 'undefined') throw new CapabilityError('audio');
  let element: HTMLAudioElement | undefined;
  let volume = 1;
  const ensure = () => {
    if (!element) {
      element = new Audio();
      element.preload = 'metadata';
      element.volume = volume;
    }
    return element;
  };
  return {
    async play(track, options = {}) {
      const audio = ensure();
      audio.src = track.url;
      if (options.volume !== undefined) {
        volume = Math.min(1, Math.max(0, options.volume));
        audio.volume = volume;
      }
      if (options.position) audio.currentTime = options.position;
      await audio.play();
    },
    async pause() {
      element?.pause();
    },
    async resume() {
      await element?.play();
    },
    async stop() {
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
    async seek(position) {
      if (element) element.currentTime = Math.max(0, position);
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      if (element) element.volume = volume;
    },
  };
};

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
 * Shared audio playback controller. Native hosts register `AudioPort`; on the
 * web the helper drives one `HTMLAudioElement`. Resume/bookmarks and the media
 * session are separate helpers, so a player can compose them.
 */
export function createAudioPlayer(
  options: { port?: AudioPort; volume?: number } = {},
): AudioPlayer {
  const backend = () => options.port ?? port ?? webAudio();
  const [track, setTrack] = createSignal<AudioTrack | undefined>();
  const [playing, setPlaying] = createSignal(false);
  const [volume, setVolumeSignal] = createSignal(options.volume ?? 1);

  return {
    track,
    playing,
    volume,
    async play(next, playOptions = {}) {
      await backend().play(next, {
        ...playOptions,
        volume: playOptions.volume ?? volume(),
      });
      setTrack(next);
      setPlaying(true);
    },
    async pause() {
      await backend().pause();
      setPlaying(false);
    },
    async resume() {
      await backend().resume();
      setPlaying(true);
    },
    async stop() {
      await backend().stop();
      setPlaying(false);
      setTrack(undefined);
    },
    async seek(position) {
      await backend().seek(position);
    },
    setVolume(next) {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeSignal(clamped);
      backend().setVolume(clamped);
    },
  };
}
