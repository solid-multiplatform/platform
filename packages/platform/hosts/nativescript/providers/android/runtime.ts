/**
 * What every Android provider starts from: the application object the host
 * hands over, and the few lookups they all repeat. Importing this module runs
 * nothing.
 */

/** The NativeScript activity events the providers listen to. */
export interface AndroidAppEvents {
  activityResult: {
    requestCode: number;
    resultCode: number;
    intent: android.content.Intent | null;
  };
  activityRequestPermissions: {
    requestCode: number;
    grantResults: androidNative.Array<number> | null;
  };
  activityNewIntent: { intent: android.content.Intent | null };
  activityDestroyed: { activity: android.app.Activity };
  activityResumed: { activity: android.app.Activity };
  activityPaused: { activity: android.app.Activity };
}

/**
 * The part of NativeScript's `Application.android` the providers use. The
 * host passes that object; the providers never import NativeScript's core
 * themselves.
 */
export interface AndroidApp {
  readonly context: android.content.Context;
  readonly foregroundActivity?: android.app.Activity | null;
  readonly startActivity?: android.app.Activity | null;
  on<K extends keyof AndroidAppEvents>(
    event: K,
    handler: (data: AndroidAppEvents[K]) => void,
  ): void;
  off<K extends keyof AndroidAppEvents>(
    event: K,
    handler: (data: AndroidAppEvents[K]) => void,
  ): void;
}

export const sdk = (): number => android.os.Build.VERSION.SDK_INT;

/** The activity on screen. Throws where the app has none. */
export function activityOf(app: AndroidApp): android.app.Activity {
  const activity = app.foregroundActivity ?? app.startActivity;
  if (!activity) throw new Error('No foreground Android activity');
  return activity;
}

let handler: android.os.Handler | undefined;

/** A handler on the main looper, where every provider callback is delivered. */
export const mainHandler = (): android.os.Handler =>
  (handler ??= new android.os.Handler(android.os.Looper.getMainLooper()));

/** A Java `String[]`. */
export function strings(
  values: readonly string[],
): androidNative.Array<string> {
  const array: androidNative.Array<string> = Array.create(
    java.lang.String,
    values.length,
  );
  for (let i = 0; i < values.length; i++) array[i] = values[i]!;
  return array;
}

/** The UTF-8 bytes of a string, as a Java `byte[]`. */
export const utf8 = (text: string): androidNative.Array<number> =>
  new java.lang.String(text).getBytes('UTF-8');

/** The string a Java `byte[]` of UTF-8 holds. */
export const fromUtf8 = (bytes: androidNative.Array<number>): string =>
  String(new java.lang.String(bytes, 'UTF-8'));

/** The message of a Java exception or a JavaScript error. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * An ArrayBuffer holding exactly these bytes, for a Java method that takes a
 * `java.nio.ByteBuffer`. Copies only when the view covers part of its buffer.
 */
export function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer;
  if (
    buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
  )
    return buffer;
  return bytes.slice().buffer;
}
