import type {
  MediaAction,
  MediaActionHandler,
  MediaMetadata,
  MediaPositionState,
  MediaSessionPort,
} from '../../../../src/sdk/media.js';
import { mainHandler, type AndroidApp } from './runtime.js';

type PlaybackState = 'none' | 'paused' | 'playing';

let Callback:
  | (new () => android.media.session.MediaSession.Callback)
  | undefined;
// The one live port's handlers. A Java subclass made by `extend` keeps the
// functions it was first given, so they reach the port through here.
let dispatch: ((action: MediaAction, position?: number) => void) | undefined;

/**
 * A platform `MediaSession`: what the system's now-playing surfaces show, and
 * where a remote's or headset's transport keys arrive. The session exists
 * only while there is something to say: it is created when the app publishes
 * a playback state or a handler, and released once the state is `none` and
 * the last handler is gone. Callbacks arrive on the main looper. Synchronous
 * to construct, for `configureMediaSession`.
 */
export function mediaSession(app: AndroidApp): MediaSessionPort {
  const State = android.media.session.PlaybackState;
  const ACTIONS: Record<MediaAction, number> = {
    play: State.ACTION_PLAY | State.ACTION_PLAY_PAUSE,
    pause: State.ACTION_PAUSE | State.ACTION_PLAY_PAUSE,
    stop: State.ACTION_STOP,
    seekbackward: State.ACTION_REWIND,
    seekforward: State.ACTION_FAST_FORWARD,
    seekto: State.ACTION_SEEK_TO,
    nexttrack: State.ACTION_SKIP_TO_NEXT,
    previoustrack: State.ACTION_SKIP_TO_PREVIOUS,
  };
  const handlers = new Map<MediaAction, MediaActionHandler>();
  let session: android.media.session.MediaSession | undefined;
  let metadata: MediaMetadata | undefined;
  let state: PlaybackState = 'none';
  let position: MediaPositionState | undefined;

  const publish = (): void => {
    if (state === 'none' && handlers.size === 0) {
      session?.setActive(false);
      session?.release();
      session = undefined;
      dispatch = undefined;
      return;
    }
    if (!session) {
      Callback ??= android.media.session.MediaSession.Callback.extend({
        onPlay: () => dispatch?.('play'),
        onPause: () => dispatch?.('pause'),
        onStop: () => dispatch?.('stop'),
        onSeekTo: (milliseconds) => dispatch?.('seekto', milliseconds / 1000),
        onSkipToNext: () => dispatch?.('nexttrack'),
        onSkipToPrevious: () => dispatch?.('previoustrack'),
        onFastForward: () => dispatch?.('seekforward'),
        onRewind: () => dispatch?.('seekbackward'),
      });
      dispatch = (action, seconds) =>
        // The web's handler for `seekto` is given the time; so is this one.
        (
          handlers.get(action) as
            | ((details?: { seekTime: number }) => void)
            | undefined
        )?.(seconds === undefined ? undefined : { seekTime: seconds });
      session = new android.media.session.MediaSession(
        app.context,
        'solid-multiplatform',
      );
      session.setCallback(new Callback(), mainHandler());
      session.setActive(true);
    }
    const Metadata = android.media.MediaMetadata;
    const details = new Metadata.Builder();
    if (metadata) {
      details.putString(Metadata.METADATA_KEY_TITLE, metadata.title);
      if (metadata.artist)
        details.putString(Metadata.METADATA_KEY_ARTIST, metadata.artist);
      if (metadata.album)
        details.putString(Metadata.METADATA_KEY_ALBUM, metadata.album);
      const art = metadata.artwork?.[0]?.src;
      if (art) details.putString(Metadata.METADATA_KEY_ART_URI, art);
    }
    if (position)
      details.putLong(
        Metadata.METADATA_KEY_DURATION,
        Math.round(position.duration * 1000),
      );
    session.setMetadata(details.build());
    let actions = 0;
    for (const action of handlers.keys()) actions |= ACTIONS[action];
    session.setPlaybackState(
      new State.Builder()
        .setActions(actions)
        .setState(
          state === 'playing'
            ? State.STATE_PLAYING
            : state === 'paused'
              ? State.STATE_PAUSED
              : State.STATE_NONE,
          position ? Math.round(position.position * 1000) : -1,
          state === 'playing' ? (position?.playbackRate ?? 1) : 0,
        )
        .build(),
    );
  };

  return {
    setMetadata(next) {
      metadata = next;
      if (session) publish();
    },
    setPlaybackState(next) {
      state = next;
      publish();
    },
    setPositionState(next) {
      position = next;
      if (session) publish();
    },
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
      publish();
    },
  };
}
