import { View } from '@nativescript/core';
import { NativePlayer, PlayerOperationError } from './native.mjs';

export function createApplePlayer(root, { target = 'ios', bounds } = {}) {
  return new NativePlayer(
    target,
    'avplayer',
    (_request, emit) => {
      if (typeof SolidPlayback === 'undefined')
        throw new PlayerOperationError(
          'engine-unavailable',
          'The app must compile SolidPlayback.swift',
        );
      const native = SolidPlayback.make();
      class Surface extends View {
        createNativeView() {
          return native;
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
      native.observe((state, position, duration) => {
        if (state === 'error') {
          emit({
            state,
            error: new PlayerOperationError(
              'prepare-failed',
              'AVPlayer item failed',
            ).toFailure(),
          });
          return;
        }
        emit({
          state,
          time: {
            positionSeconds: position,
            durationSeconds: duration > 0 ? duration : null,
          },
        });
      });
      const tracks = () => emit({ tracks: JSON.parse(native.tracksJSON()) });
      function select(kind, id) {
        if (!native.selectKindIdentifier(kind, id))
          throw new PlayerOperationError(
            'unsupported-operation',
            'Unavailable media track',
          );
        tracks();
      }
      return {
        async prepare(url) {
          await new Promise((resolve, reject) =>
            native.prepareURLCompletion(url, (error) =>
              error
                ? reject(
                    new PlayerOperationError('prepare-failed', String(error)),
                  )
                : resolve(),
            ),
          );
          tracks();
        },
        play: () => native.play(),
        pause: () => native.pause(),
        seek: (s) =>
          new Promise((resolve, reject) =>
            native.seekSecondsCompletion(s, (ok) =>
              ok
                ? resolve()
                : reject(
                    new PlayerOperationError('seek-failed', 'Seek interrupted'),
                  ),
            ),
          ),
        setVolume: (v) => native.volume(v),
        setMuted: (v) => native.mute(v),
        setPictureMode: (mode) => native.fill(mode === 'fill'),
        selectAudioTrack: (id) => select('audio', id),
        selectTextTrack: (id) => select('text', id),
        dispose() {
          native.close();
          root.removeChild(view);
        },
      };
    },
    {
      canSetVolume: true,
      canSelectAudioTrack: true,
      canSelectTextTrack: true,
      canDisableTextTrack: true,
    },
  );
}
