import { PlayerOperationError } from './native.mjs';

const interrupted = () =>
  new PlayerOperationError('invalid-state', 'Playback interrupted');

// NativePlayer owns this driver from the start of open(), including while the
// worker is building the engine. A stop, replacement or timeout can cancel it.
export function pendingAndroidDriver(start, bind) {
  let driver, request, rejectPending, ready;
  let disposed = false;
  const acquire = () =>
    (ready ??= new Promise((resolve, reject) => {
      rejectPending = reject;
      request = start(
        (engine, preparedView) => {
          if (disposed) {
            engine.release();
            return;
          }
          let attached;
          try {
            attached = bind(engine, preparedView);
          } catch (error) {
            engine.release();
            reject(error);
            return;
          }
          if (disposed) attached.dispose();
          else {
            driver = attached;
            resolve(driver);
          }
        },
        (message) =>
          reject(new PlayerOperationError('prepare-failed', String(message))),
      );
    }));

  const handle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      request?.cancel();
      if (driver) driver.dispose();
      else rejectPending?.(interrupted());
    },
  };
  for (const op of [
    'prepare',
    'play',
    'pause',
    'seek',
    'setPictureMode',
    'setVolume',
    'setMuted',
    'selectAudioTrack',
    'selectTextTrack',
  ]) {
    handle[op] = (...args) => {
      if (disposed) throw interrupted();
      if (driver) return driver[op](...args);
      return acquire().then((active) => {
        if (disposed) throw interrupted();
        return active[op](...args);
      });
    };
  }
  return handle;
}
