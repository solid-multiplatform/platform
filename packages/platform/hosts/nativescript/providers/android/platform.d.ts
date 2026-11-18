/* eslint-disable no-redeclare -- the namespaces below merge into the typings' own */
// What the stock NativeScript Android typings leave out. Everything the
// providers use beyond `@nativescript/types` is declared here, and nowhere
// else.

// The runtime gives every Java class a static `extend`, which makes a Java
// subclass whose overridden methods are the given JavaScript functions. The
// typings declare it for none, so it is declared here for the abstract
// classes the providers subclass.
declare namespace android.net.ConnectivityManager.NetworkCallback {
  function extend(implementation: {
    onAvailable?(network: android.net.Network): void;
    onLost?(network: android.net.Network): void;
  }): new () => android.net.ConnectivityManager.NetworkCallback;
}

declare namespace android.hardware.biometrics.BiometricPrompt.AuthenticationCallback {
  function extend(implementation: {
    onAuthenticationSucceeded?(
      result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult,
    ): void;
    onAuthenticationError?(code: number, message: string): void;
  }): new () => android.hardware.biometrics.BiometricPrompt.AuthenticationCallback;
}

declare namespace android.content.AsyncQueryHandler {
  function extend(implementation: {
    onQueryComplete?(
      token: number,
      cookie: unknown,
      cursor: android.database.Cursor | null,
    ): void;
  }): new (
    resolver: android.content.ContentResolver,
  ) => android.content.AsyncQueryHandler;
}

declare namespace android.content.BroadcastReceiver {
  function extend(implementation: {
    onReceive(
      context: android.content.Context,
      intent: android.content.Intent,
    ): void;
  }): new () => android.content.BroadcastReceiver;
}

// The runtime passes an ArrayBuffer where Java takes a java.nio.ByteBuffer,
// sharing its memory, and wraps a ByteBuffer as an ArrayBuffer.
interface ArrayBufferConstructor {
  from(buffer: java.nio.ByteBuffer): ArrayBuffer;
}

declare namespace java.nio.channels {
  interface WritableByteChannel {
    write(source: ArrayBuffer): number;
  }
}

declare namespace org.nativescript.widgets.Async.File {
  function writeBuffer(
    path: string,
    content: ArrayBuffer,
    callback: org.nativescript.widgets.Async.CompleteCallback,
    context: unknown,
  ): void;
}

// Google Play in-app review: an optional library the app adds. `appReview`
// exists only where these classes are on the classpath.
declare namespace com.google.android.gms.tasks {
  class Task<T> extends java.lang.Object {
    isSuccessful(): boolean;
    getResult(): T;
    addOnCompleteListener(listener: OnCompleteListener<T>): Task<T>;
  }
  class OnCompleteListener<T> extends java.lang.Object {
    constructor(implementation: { onComplete(task: Task<T>): void });
  }
}

declare namespace com.google.android.play.core.review {
  class ReviewInfo extends java.lang.Object {}
  class ReviewManager extends java.lang.Object {
    requestReviewFlow(): com.google.android.gms.tasks.Task<ReviewInfo>;
    launchReviewFlow(
      activity: android.app.Activity,
      info: ReviewInfo,
    ): com.google.android.gms.tasks.Task<java.lang.Void>;
  }
  class ReviewManagerFactory extends java.lang.Object {
    static create(context: android.content.Context): ReviewManager;
  }
}

// The stock typings have no `android.media.session` package.
declare namespace android.media.session {
  class MediaSession extends java.lang.Object {
    constructor(context: android.content.Context, tag: string);
    setCallback(
      callback: MediaSession.Callback | null,
      handler: android.os.Handler,
    ): void;
    setActive(active: boolean): void;
    setMetadata(metadata: android.media.MediaMetadata | null): void;
    setPlaybackState(state: PlaybackState | null): void;
    release(): void;
  }
  namespace MediaSession {
    class Callback extends java.lang.Object {}
    namespace Callback {
      function extend(implementation: {
        onPlay?(): void;
        onPause?(): void;
        onStop?(): void;
        onSeekTo?(position: number): void;
        onSkipToNext?(): void;
        onSkipToPrevious?(): void;
        onFastForward?(): void;
        onRewind?(): void;
      }): new () => Callback;
    }
  }
  class PlaybackState extends java.lang.Object {
    static STATE_NONE: number;
    static STATE_PAUSED: number;
    static STATE_PLAYING: number;
    static ACTION_STOP: number;
    static ACTION_PAUSE: number;
    static ACTION_PLAY: number;
    static ACTION_REWIND: number;
    static ACTION_SKIP_TO_PREVIOUS: number;
    static ACTION_SKIP_TO_NEXT: number;
    static ACTION_FAST_FORWARD: number;
    static ACTION_SEEK_TO: number;
    static ACTION_PLAY_PAUSE: number;
  }
  namespace PlaybackState {
    class Builder extends java.lang.Object {
      constructor();
      setActions(actions: number): Builder;
      setState(state: number, position: number, speed: number): Builder;
      build(): PlaybackState;
    }
  }
}

// The stock typings have no `android.app.job` package.
declare namespace android.app.job {
  class JobInfo extends java.lang.Object {
    static NETWORK_TYPE_ANY: number;
  }
  namespace JobInfo {
    class Builder extends java.lang.Object {
      constructor(id: number, service: android.content.ComponentName);
      setMinimumLatency(milliseconds: number): Builder;
      setRequiredNetworkType(type: number): Builder;
      build(): JobInfo;
    }
  }
  class JobScheduler extends java.lang.Object {
    static RESULT_SUCCESS: number;
    schedule(job: JobInfo): number;
    cancel(id: number): void;
  }
}

// Arguments Java accepts as null where the typings say they cannot be.
declare namespace java.security {
  interface KeyStore {
    load(parameter: null): void;
    getKey(alias: string, password: null): java.security.Key | null;
  }
}

declare namespace android.content {
  interface AsyncQueryHandler {
    startQuery(
      token: number,
      cookie: unknown,
      uri: android.net.Uri,
      projection: androidNative.Array<string>,
      selection: string | null,
      selectionArguments: androidNative.Array<string> | null,
      order: string | null,
    ): void;
  }
}

// `java.util.function` is missing from the typings and cannot be declared as
// a namespace: its name is a reserved word. `geolocation.ts` reads it through
// this shape.
interface JavaUtilFunction {
  Consumer: new <T>(implementation: {
    accept(value: T): void;
  }) => java.lang.Object;
}
