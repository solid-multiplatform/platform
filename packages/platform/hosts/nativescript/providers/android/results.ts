/**
 * The one place activity results and permission answers come back to.
 *
 * NativeScript raises `activityResult` and `activityRequestPermissions` on
 * the application object from the activity's own callbacks. One listener for
 * each is attached while a request is waiting and removed with the last
 * answer, so nothing listens while the app is idle.
 */
import {
  activityOf,
  strings,
  type AndroidApp,
  type AndroidAppEvents,
} from './runtime.js';

export interface ActivityResult {
  /** `Activity.RESULT_OK` (-1), `RESULT_CANCELED` (0) or the activity's own. */
  resultCode: number;
  intent: android.content.Intent | null;
}

interface Waiting {
  activity: android.app.Activity;
  resolve(data: never): void;
  reject(error: Error): void;
}

type Channel = 'activityResult' | 'activityRequestPermissions';

const waiting: Record<Channel, Map<number, Waiting>> = {
  activityResult: new Map(),
  activityRequestPermissions: new Map(),
};
const listeners = new WeakMap<AndroidApp, () => void>();
let sequence = 0;

const pending = (): number =>
  waiting.activityResult.size + waiting.activityRequestPermissions.size;

function listen(app: AndroidApp): void {
  if (listeners.has(app)) return;
  const settle =
    <K extends Channel>(channel: K) =>
    (data: AndroidAppEvents[K]): void => {
      const entry = waiting[channel].get(data.requestCode);
      if (!entry) return;
      waiting[channel].delete(data.requestCode);
      entry.resolve(data as never);
      release(app);
    };
  const result = settle('activityResult');
  const permissions = settle('activityRequestPermissions');
  // An activity destroyed while its request is open never gets the answer.
  const destroyed = (data: AndroidAppEvents['activityDestroyed']): void => {
    for (const channel of Object.values(waiting))
      for (const [code, entry] of channel)
        if (entry.activity === data.activity) {
          channel.delete(code);
          entry.reject(new Error('The activity was destroyed'));
        }
    release(app);
  };
  app.on('activityResult', result);
  app.on('activityRequestPermissions', permissions);
  app.on('activityDestroyed', destroyed);
  listeners.set(app, () => {
    app.off('activityResult', result);
    app.off('activityRequestPermissions', permissions);
    app.off('activityDestroyed', destroyed);
  });
}

function release(app: AndroidApp): void {
  if (pending() > 0) return;
  listeners.get(app)?.();
  listeners.delete(app);
}

function request<T>(
  app: AndroidApp,
  channel: Channel,
  start: (activity: android.app.Activity, code: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const activity = activityOf(app);
    // Request codes are 16 bits; this range is the providers' own.
    const code = 0x5300 + (sequence++ % 0x0800);
    waiting[channel].set(code, { activity, resolve, reject });
    listen(app);
    try {
      start(activity, code);
    } catch (error) {
      waiting[channel].delete(code);
      release(app);
      reject(error as Error);
    }
  });
}

/** Starts an activity and resolves with what it returns. */
export function startForResult(
  app: AndroidApp,
  intent: android.content.Intent,
): Promise<ActivityResult> {
  return request<ActivityResult>(app, 'activityResult', (activity, code) =>
    activity.startActivityForResult(intent, code),
  );
}

/** Shows the system permission prompt. Resolves once it has closed. */
export function promptPermissions(
  app: AndroidApp,
  names: readonly string[],
): Promise<void> {
  return request<unknown>(app, 'activityRequestPermissions', (activity, code) =>
    activity.requestPermissions(strings(names), code),
  ).then(() => undefined);
}

/** How many requests are waiting for an answer. For tests. */
export const pendingResults = pending;
