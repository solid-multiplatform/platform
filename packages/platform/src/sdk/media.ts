import { createSignal, type Accessor } from 'solid-js';
import {
  CapabilityError,
  peekService,
  serviceAvailable,
  withService,
} from './registry.js';
import type { Store } from './services.js';

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

/** What a `seekto` handler is called with. */
export interface MediaSeekDetails {
  /** The position to seek to, in seconds. */
  seekTime: number;
}

/**
 * A media action's handler. The host calls the `seekto` handler with
 * {@link MediaSeekDetails}; the other actions' handlers take no argument.
 */
export type MediaActionHandler = (details: MediaSeekDetails) => void;

export type MediaActionHandlers = {
  [Action in Exclude<MediaAction, 'seekto'>]?: () => void;
} & { seekto?: MediaActionHandler };

export interface MediaSessionPort {
  setMetadata(metadata: MediaMetadata): void;
  setPlaybackState(state: 'none' | 'paused' | 'playing'): void;
  setPositionState?(state: MediaPositionState): void;
  setActionHandler(
    action: MediaAction,
    handler: MediaActionHandler | undefined,
  ): void;
}

export interface ConfigureMediaSessionOptions {
  metadata?: MediaMetadata;
  playbackState?: 'none' | 'paused' | 'playing';
  position?: MediaPositionState;
  actions?: MediaActionHandlers;
}

/**
 * Publish now-playing metadata and hardware transport handlers through the
 * host's `mediaSession` service: the W3C Media Session API on the web, a small
 * port on Android/TV/Roku. Returns a disposer that clears the handlers when
 * playback ends. Does nothing on a host without a media session.
 */
export function configureMediaSession(
  options: ConfigureMediaSessionOptions,
): () => void {
  const session = peekService('mediaSession');
  if (!session) return () => {};
  if (options.metadata) session.setMetadata(options.metadata);
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

export interface FullscreenPort {
  enter(element?: unknown): Promise<void>;
  exit(): Promise<void>;
  pictureInPicture?(element?: unknown): Promise<void>;
}

/** Enter fullscreen through the host's `fullscreen` service. */
export async function enterFullscreen(element?: unknown): Promise<void> {
  return withService('fullscreen', (port) => port.enter(element));
}

export async function exitFullscreen(): Promise<void> {
  return withService('fullscreen', (port) => port.exit());
}

/** Enter picture-in-picture for a video element, where the host can. */
export async function enterPictureInPicture(element?: unknown): Promise<void> {
  if (serviceAvailable('fullscreen') === 'unavailable')
    throw new CapabilityError('pictureInPicture');
  return withService('fullscreen', (port) => {
    if (!port.pictureInPicture) throw new CapabilityError('pictureInPicture');
    return port.pictureInPicture(element);
  });
}

export interface ThumbnailPort {
  /** Return a data URL or file URL for a frame at `time` seconds. */
  capture(source: string, time: number): Promise<string>;
}

declare module './registry.js' {
  interface ServiceProviders {
    mediaSession: MediaSessionPort;
    fullscreen: FullscreenPort;
    thumbnails: ThumbnailPort;
  }
}

/**
 * Capture a poster frame through the host's `thumbnails` service. The web
 * host seeks a temporary `<video>` and draws it to a canvas.
 */
export async function captureThumbnail(
  source: string,
  time = 0,
): Promise<string> {
  return withService('thumbnails', (port) => port.capture(source, time));
}

/**
 * Map hardware media keys to transport actions. TV remotes and keyboards
 * report several spellings (`MediaPlayPause`, `MediaTrackNext`, …); this
 * helper accepts all of them and returns a disposer. Without `target` it
 * listens on the host's `keyEvents` service, and does nothing where the host
 * has none.
 */
export function bindMediaKeys(
  actions: Partial<
    Record<
      'play' | 'pause' | 'playpause' | 'next' | 'previous' | 'stop',
      () => void
    >
  >,
  target: EventTarget | undefined = peekService('keyEvents')?.target(),
): () => void {
  const listener = (input: Event) => {
    // Native hosts deliver key events that are not browser KeyboardEvents.
    const event = input as KeyboardEvent;
    if (typeof event.key !== 'string') return;
    const key = event.key;
    const action =
      key === 'MediaPlayPause' || key === 'PlayPause'
        ? 'playpause'
        : key === 'MediaPlay' || key === 'Play'
          ? 'play'
          : key === 'MediaPause' || key === 'Pause'
            ? 'pause'
            : key === 'MediaTrackNext' || key === 'MediaNextTrack'
              ? 'next'
              : key === 'MediaTrackPrevious' || key === 'MediaPreviousTrack'
                ? 'previous'
                : key === 'MediaStop'
                  ? 'stop'
                  : undefined;
    if (!action) return;
    const handler = actions[action];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };
  target?.addEventListener('keydown', listener);
  return () => target?.removeEventListener('keydown', listener);
}
