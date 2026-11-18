import {
  createElement,
  insertNode,
  setProp,
  tmTransaction,
} from '@roku-sdk/solid';
import { NativePlayer, PlayerOperationError } from './native.mjs';

export function createRokuPlayer(
  parent,
  { x = 0, y = 0, width = 1920, height = 1080 } = {},
) {
  return new NativePlayer('roku', 'scenegraph', (_req, emit) => {
    const video = createElement('video'),
      content = createElement('contentNode');
    let settle,
      reject,
      position = 0,
      duration = null,
      live = true;
    const prop = (k, v) => setProp(video, k, v);
    const time = () =>
      emit({ time: { positionSeconds: position, durationSeconds: duration } });
    prop('translation', [x, y]);
    prop('width', width);
    prop('height', height);
    prop('enableUI', false);
    prop('notificationInterval', 1);
    prop('onPosition', (n) => {
      if (live) {
        position = Math.max(0, Number(n) / 1000);
        time();
      }
    });
    prop('onDuration', (n) => {
      if (live) {
        duration = Number(n) > 0 ? Number(n) / 1000 : null;
        time();
      }
    });
    prop('onState', (s) => {
      if (!live) return;
      if (s === 'playing' || s === 'paused' || s === 'buffering')
        emit({ state: s });
      if (s === 'playing' || s === 'paused' || s === 'finished') settle?.();
      if (s === 'finished') emit({ state: 'ended' });
      if (s === 'error') {
        const e = new PlayerOperationError(
          'prepare-failed',
          'SceneGraph playback failed',
        );
        emit({ state: 'error', error: e.toFailure() });
        reject?.(e);
      }
    });
    insertNode(parent, video);
    return {
      prepare(url) {
        return new Promise((resolve, fail) => {
          settle = resolve;
          reject = fail;
          setProp(content, 'url', url);
          prop('content', content);
          prop('control', 'play');
        });
      },
      play: () => prop('control', 'resume'),
      pause: () => prop('control', 'pause'),
      seek: (seconds) => prop('seek', seconds),
      setMuted: (value) => prop('mute', value),
      setPictureMode: (mode) =>
        prop('scaleMode', mode === 'fill' ? 'zoomToFill' : 'scaleToFit'),
      dispose() {
        live = false;
        prop('control', 'stop');
        tmTransaction.removeNode(parent, video);
      },
    };
  });
}
