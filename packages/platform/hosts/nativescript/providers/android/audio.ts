import type {
  AudioPlaybackState,
  AudioPort,
} from '../../../../src/sdk/audio.js';
import { mainHandler, sdk, type AndroidApp } from './runtime.js';

/**
 * One `android.media.MediaPlayer` for the track being played, with audio
 * focus held while it plays: another app taking focus pauses it, and getting
 * focus back resumes it. The player is released, and focus given up, when the
 * track stops, ends or fails; nothing is held while nothing plays.
 */
export function audio(app: AndroidApp): AudioPort {
  const AudioManager = android.media.AudioManager;
  const manager = (): android.media.AudioManager =>
    app.context.getSystemService(android.content.Context.AUDIO_SERVICE);
  const attributes = (): android.media.AudioAttributes =>
    new android.media.AudioAttributes.Builder()
      .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
      .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
      .build();
  let player: android.media.MediaPlayer | undefined;
  let focus: android.media.AudioFocusRequest | undefined;
  let focusListener:
    | android.media.AudioManager.OnAudioFocusChangeListener
    | undefined;
  let interrupted = false;
  let volume = 1;
  const listeners = new Set<(state: AudioPlaybackState) => void>();
  const emit = (state: AudioPlaybackState): void => {
    for (const each of listeners) each(state);
  };

  const listener = (): android.media.AudioManager.OnAudioFocusChangeListener =>
    (focusListener ??= new AudioManager.OnAudioFocusChangeListener({
      onAudioFocusChange(change) {
        if (!player) return;
        if (change === AudioManager.AUDIOFOCUS_GAIN) {
          if (interrupted) {
            player.start();
            emit('playing');
          }
          interrupted = false;
        } else if (player.isPlaying()) {
          // Lost for good or for a moment: stop sounding either way.
          interrupted = change !== AudioManager.AUDIOFOCUS_LOSS;
          player.pause();
          emit('interrupted');
        }
      },
    }));
  const requestFocus = (): void => {
    if (sdk() >= 26) {
      focus ??= new android.media.AudioFocusRequest.Builder(
        AudioManager.AUDIOFOCUS_GAIN,
      )
        .setAudioAttributes(attributes())
        .setOnAudioFocusChangeListener(listener(), mainHandler())
        .build();
      manager().requestAudioFocus(focus);
    } else
      manager().requestAudioFocus(
        listener(),
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN,
      );
  };
  const abandonFocus = (): void => {
    if (focus) manager().abandonAudioFocusRequest(focus);
    else if (focusListener) manager().abandonAudioFocus(focusListener);
    focus = undefined;
    focusListener = undefined;
    interrupted = false;
  };
  const release = (): void => {
    player?.release();
    player = undefined;
    abandonFocus();
  };

  return {
    play(track, options = {}) {
      release();
      const next = new android.media.MediaPlayer();
      player = next;
      if (options.volume !== undefined) volume = options.volume;
      return new Promise<void>((resolve, reject) => {
        next.setAudioAttributes(attributes());
        next.setVolume(volume, volume);
        next.setOnPreparedListener(
          new android.media.MediaPlayer.OnPreparedListener({
            onPrepared() {
              if (player !== next) return resolve();
              if (options.position)
                next.seekTo(Math.round(options.position * 1000));
              requestFocus();
              next.start();
              resolve();
            },
          }),
        );
        next.setOnErrorListener(
          new android.media.MediaPlayer.OnErrorListener({
            onError(_player, what, extra) {
              if (player === next) release();
              reject(new Error(`Audio playback failed (${what}, ${extra})`));
              return true;
            },
          }),
        );
        next.setOnCompletionListener(
          new android.media.MediaPlayer.OnCompletionListener({
            onCompletion() {
              if (player !== next) return;
              release();
              emit('ended');
            },
          }),
        );
        try {
          if (/^(file|content|android\.resource):/.test(track.url))
            next.setDataSource(app.context, android.net.Uri.parse(track.url));
          else next.setDataSource(track.url);
          next.prepareAsync();
        } catch (error) {
          if (player === next) release();
          reject(error as Error);
        }
      });
    },
    async pause() {
      interrupted = false;
      if (player?.isPlaying()) player.pause();
    },
    async resume() {
      if (!player) return;
      requestFocus();
      player.start();
    },
    async stop() {
      release();
    },
    async seek(position) {
      player?.seekTo(Math.round(position * 1000));
    },
    setVolume(next) {
      volume = next;
      player?.setVolume(next, next);
    },
    // Only what the app did not do itself: losing and regaining audio focus,
    // and the track's end.
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
