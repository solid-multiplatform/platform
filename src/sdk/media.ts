import { createSignal, type Accessor } from 'solid-js';
import { CapabilityError, type Store } from './services.js';

export interface Bookmark {
  /** Last position in seconds. */
  position: number;
  /** Media duration in seconds. */
  duration: number;
  /** Unix milliseconds of the last update. */
  updated: number;
}

export interface BookmarksOptions {
  storage: Store;
  key?: string;
  onError?(error: unknown): void;
}

export interface Bookmarks {
  entries: Accessor<Readonly<Record<string, Bookmark>>>;
  ready: Accessor<boolean>;
  get(id: string): Bookmark | undefined;
  hydrate(): Promise<void>;
  save(id: string, position: number, duration: number): Promise<void>;
  clear(id: string): Promise<void>;
  /**
   * Position to start playback at. Near the beginning or within
   * `endTolerance` seconds of the end starts from 0, the behaviour used by
   * Netflix/Roku resume prompts.
   */
  resume(id: string, options?: { min?: number; endTolerance?: number }): number;
  dispose(): void;
}

/**
 * Durable per-media playback positions. Storage flows through the
 * `settings`/`secureStorage` port, so the same code runs on web, mobile and
 * TV; the player only needs `resume()` on load and `save()` on pause/exit.
 */
export function createBookmarks(options: BookmarksOptions): Bookmarks {
  const key = options.key ?? 'media-bookmarks';
  const [entries, setEntries] = createSignal<
    Readonly<Record<string, Bookmark>>
  >({});
  const [ready, setReady] = createSignal(false);
  let writes = Promise.resolve();
  let disposed = false;

  const persist = () => {
    const raw = JSON.stringify(entries());
    writes = writes
      .then(() => (disposed ? undefined : options.storage.set(key, raw)))
      .catch((error) => options.onError?.(error));
    return writes;
  };

  return {
    entries,
    ready,
    get: (id) => entries()[id],
    async hydrate() {
      if (!disposed) {
        try {
          const raw = await options.storage.get(key);
          if (raw !== null && raw !== undefined) {
            const parsed = JSON.parse(raw) as Record<string, Bookmark>;
            if (parsed && typeof parsed === 'object') setEntries(parsed);
          }
        } catch (error) {
          options.onError?.(error);
        } finally {
          setReady(true);
        }
      }
    },
    async save(id, position, duration) {
      if (disposed) return;
      setEntries((current) => ({
        ...current,
        [id]: {
          position: Math.max(0, position),
          duration: Math.max(0, duration),
          updated: Date.now(),
        },
      }));
      await persist();
    },
    async clear(id) {
      if (disposed) return;
      setEntries((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await persist();
    },
    resume(id, resumeOptions = {}) {
      const bookmark = entries()[id];
      if (!bookmark) return 0;
      const min = resumeOptions.min ?? 5;
      const tolerance = resumeOptions.endTolerance ?? 10;
      if (bookmark.position < min) return 0;
      if (
        bookmark.duration > 0 &&
        bookmark.duration - bookmark.position <= tolerance
      ) {
        return 0;
      }
      return bookmark.position;
    },
    dispose() {
      disposed = true;
    },
  };
}

export type MediaAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto'
  | 'nexttrack'
  | 'previoustrack';

export interface MediaArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MediaMetadata {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaArtwork[];
}

export interface MediaPositionState {
  duration: number;
  position: number;
  playbackRate?: number;
}

export interface MediaSessionPort {
  setMetadata(metadata: MediaMetadata): void;
  setPlaybackState(state: 'none' | 'paused' | 'playing'): void;
  setPositionState?(state: MediaPositionState): void;
  setActionHandler(
    action: MediaAction,
    handler: (() => void) | undefined,
  ): void;
}

let mediaSessionPort: MediaSessionPort | undefined;

/** Register the host media-session implementation (Android MediaSession). */
export function setMediaSessionPort(port: MediaSessionPort | undefined): void {
  mediaSessionPort = port;
}

const webMediaSession = (): MediaSession | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { mediaSession?: MediaSession })
    .mediaSession;
};

export interface ConfigureMediaSessionOptions {
  metadata?: MediaMetadata;
  playbackState?: 'none' | 'paused' | 'playing';
  position?: MediaPositionState;
  actions?: Partial<Record<MediaAction, () => void>>;
}

/**
 * Publish now-playing metadata and hardware transport handlers. This is the
 * W3C Media Session API on web and a small port on Android/TV/Roku. Returns a
 * disposer that clears metadata and handlers when playback ends.
 */
export function configureMediaSession(
  options: ConfigureMediaSessionOptions,
): () => void {
  const session = mediaSessionPort;
  if (session) {
    session.setMetadata(options.metadata ?? { title: '' });
    session.setPlaybackState(options.playbackState ?? 'none');
    if (options.position) session.setPositionState?.(options.position);
    const actions = options.actions ?? {};
    for (const action of Object.keys(actions) as MediaAction[]) {
      session.setActionHandler(action, actions[action]);
    }
    return () => {
      for (const action of Object.keys(actions) as MediaAction[]) {
        session.setActionHandler(action, undefined);
      }
      session.setPlaybackState('none');
    };
  }

  const web = webMediaSession();
  if (!web) return () => {};
  const metadata = options.metadata;
  const MetadataCtor = (
    globalThis as unknown as {
      MediaMetadata?: new (init: unknown) => unknown;
    }
  ).MediaMetadata;
  if (metadata && MetadataCtor) {
    web.metadata = new MetadataCtor(metadata) as typeof web.metadata;
  }
  web.playbackState = options.playbackState ?? 'none';
  if (options.position && web.setPositionState) {
    try {
      web.setPositionState(options.position);
    } catch {
      // Ignore invalid position states (e.g. position > duration).
    }
  }
  const actions = options.actions ?? {};
  for (const action of Object.keys(actions) as MediaAction[]) {
    try {
      web.setActionHandler(action, actions[action] ?? null);
    } catch {
      // A browser may not support every action.
    }
  }
  return () => {
    for (const action of Object.keys(actions) as MediaAction[]) {
      try {
        web.setActionHandler(action, null);
      } catch {
        // Ignore unsupported actions during cleanup.
      }
    }
    web.playbackState = 'none';
  };
}

export interface FullscreenPort {
  enter(element?: unknown): Promise<void>;
  exit(): Promise<void>;
  pictureInPicture?(element?: unknown): Promise<void>;
}

let fullscreenPort: FullscreenPort | undefined;

export function setFullscreenPort(port: FullscreenPort | undefined): void {
  fullscreenPort = port;
}

const documentElement = (): HTMLElement | undefined =>
  typeof document === 'undefined' ? undefined : document.documentElement;

/** Enter fullscreen through the host port or the browser Fullscreen API. */
export async function enterFullscreen(element?: unknown): Promise<void> {
  if (fullscreenPort) return fullscreenPort.enter(element);
  const target = (element as HTMLElement | undefined) ?? documentElement();
  if (!target?.requestFullscreen) throw new CapabilityError('fullscreen');
  await target.requestFullscreen();
}

export async function exitFullscreen(): Promise<void> {
  if (fullscreenPort) return fullscreenPort.exit();
  if (typeof document === 'undefined' || !document.exitFullscreen) {
    throw new CapabilityError('fullscreen');
  }
  await document.exitFullscreen();
}

/** Enter picture-in-picture for a video element through the host or browser. */
export async function enterPictureInPicture(element?: unknown): Promise<void> {
  if (fullscreenPort?.pictureInPicture) {
    return fullscreenPort.pictureInPicture(element);
  }
  const video = element as
    | (HTMLVideoElement & {
        requestPictureInPicture?(): Promise<unknown>;
      })
    | undefined;
  if (!video?.requestPictureInPicture) {
    throw new CapabilityError('pictureInPicture');
  }
  await video.requestPictureInPicture();
}

export interface ThumbnailPort {
  /** Return a data URL or file URL for a frame at `time` seconds. */
  capture(source: string, time: number): Promise<string>;
}

let thumbnailPort: ThumbnailPort | undefined;

export function setThumbnailPort(port: ThumbnailPort | undefined): void {
  thumbnailPort = port;
}

/**
 * Capture a poster frame. Native hosts provide the port; on the web, pass a
 * video source and the helper uses a temporary `<video>` plus canvas.
 */
export async function captureThumbnail(
  source: string,
  time = 0,
): Promise<string> {
  if (thumbnailPort) return thumbnailPort.capture(source, time);
  if (typeof document === 'undefined') {
    throw new CapabilityError('thumbnail');
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.src = source;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new CapabilityError('thumbnail'));
  });
  video.currentTime = Math.max(0, time);
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new CapabilityError('thumbnail');
  context.drawImage(video, 0, 0);
  return canvas.toDataURL('image/png');
}
