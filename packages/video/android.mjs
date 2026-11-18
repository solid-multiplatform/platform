import { Application, View } from '@nativescript/core';
import { NativePlayer, PlayerOperationError } from './native.mjs';

export function createAndroidPlayer(root, { target = 'android', bounds } = {}) {
  return new NativePlayer(
    target,
    'media3',
    (_req, emit) => {
      const context = Application.android.context;
      const player = new androidx.media3.exoplayer.ExoPlayer.Builder(
        context,
      ).build();
      class Surface extends View {
        createNativeView() {
          return new androidx.media3.ui.PlayerView(context);
        }
      }
      const view = new Surface();
      if (bounds) {
        view.horizontalAlignment = 'left';
        view.verticalAlignment = 'top';
        Object.assign(view, {
          marginLeft: bounds.x,
          marginTop: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
      }
      root.insertChild(view, 0);
      const loaded = () => {
        view.android.setUseController(false);
        view.android.setPlayer(player);
      };
      if (view.android) loaded();
      else view.once('loaded', loaded);
      let ready,
        failed,
        timer,
        volume = 1,
        muted = false;
      const time = () =>
        emit({
          time: {
            positionSeconds: Math.max(0, player.getCurrentPosition() / 1000),
            durationSeconds:
              player.getDuration() > 0 ? player.getDuration() / 1000 : null,
            seekable: player.isCurrentMediaItemSeekable(),
          },
        });
      const listener = new androidx.media3.common.Player.Listener({
        onPlaybackStateChanged(state) {
          if (state === 3) {
            time();
            ready?.();
          } else if (state === 4) emit({ state: 'ended' });
          else if (state === 2) emit({ state: 'buffering' });
        },
        onIsPlayingChanged(playing) {
          if (playing) emit({ state: 'playing' });
          else if (player.getPlaybackState() === 3) emit({ state: 'paused' });
        },
        onPlayerError() {
          const e = new PlayerOperationError(
            'prepare-failed',
            'Media3 playback failed',
          );
          emit({ state: 'error', error: e.toFailure() });
          failed?.(e);
        },
      });
      player.addListener(listener);
      return {
        prepare(url) {
          return new Promise((resolve, reject) => {
            ready = resolve;
            failed = reject;
            player.setMediaItem(androidx.media3.common.MediaItem.fromUri(url));
            player.prepare();
            timer = setInterval(time, 1000);
          });
        },
        play: () => player.play(),
        pause: () => player.pause(),
        seek: (s) => player.seekTo(Math.round(s * 1000)),
        setPictureMode(mode) {
          view.android.setResizeMode(mode === 'fill' ? 4 : 0);
        },
        setVolume(v) {
          volume = v;
          player.setVolume(muted ? 0 : v);
        },
        setMuted(v) {
          muted = v;
          player.setVolume(v ? 0 : volume);
        },
        dispose() {
          clearInterval(timer);
          player.removeListener(listener);
          view.android?.setPlayer(null);
          player.release();
          root.removeChild(view);
        },
      };
    },
    { canSetVolume: true },
  );
}
