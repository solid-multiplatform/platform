/**
 * File and stream I/O on NativeScript's own background pool
 * (`org.nativescript.widgets.Async`, which every NativeScript app has), each
 * completion delivered on the main looper: no read or write runs on the UI
 * thread.
 */
import { exactBuffer } from './runtime.js';

const async = (): typeof org.nativescript.widgets.Async.File =>
  org.nativescript.widgets.Async.File;

function task<T>(
  run: (callback: org.nativescript.widgets.Async.CompleteCallback) => void,
  result: (value: unknown) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run(
      new org.nativescript.widgets.Async.CompleteCallback({
        onComplete: (value: unknown) => resolve(result(value)),
        onError: (error: string) => reject(new Error(String(error))),
      }),
    );
  });
}

const nothing = (): void => undefined;

export const readTextFile = (path: string): Promise<string> =>
  task((done) => async().readText(path, 'UTF-8', done, null), String);

export const readBytesFile = (path: string): Promise<Uint8Array> =>
  task(
    (done) => async().readBuffer(path, done, null),
    (buffer) => new Uint8Array(ArrayBuffer.from(buffer as java.nio.ByteBuffer)),
  );

export const writeTextFile = (path: string, text: string): Promise<void> =>
  task((done) => async().writeText(path, text, 'UTF-8', done, null), nothing);

export function writeBytesFile(path: string, bytes: Uint8Array): Promise<void> {
  // Held until the write completes: Java reads this memory directly.
  const buffer = exactBuffer(bytes);
  return task((done) => async().writeBuffer(path, buffer, done, null), nothing);
}

/** Copies a stream to its end and closes both. */
export function copyStream(
  input: java.io.InputStream,
  output: java.io.OutputStream,
): Promise<void> {
  const close = (): void => {
    input.close();
    output.close();
  };
  return task((done) => async().copy(input, output, done, null), nothing).then(
    close,
    (error: unknown) => {
      close();
      throw error;
    },
  );
}
