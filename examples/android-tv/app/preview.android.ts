import { Application } from '@nativescript/core';

interface Result {
  complete(pixels: string): void;
  failed(reason: string): void;
}
declare const dev: {
  solidmultiplatform: {
    fixture: {
      PreviewResult: new (callbacks: Result) => Result;
      PreviewCommand: new (
        context: android.content.Context,
        result: Result,
      ) => {
        start(): void;
        cancel(): void;
      };
    };
  };
};

/** Android-only command exposed to this app. A host can pass it to shared UI as a capability. */
export function renderNativePreview() {
  const native = dev.solidmultiplatform.fixture;
  let cancel = () => {};
  const pixels = new Promise<string>((resolve, reject) => {
    const result = new native.PreviewResult({
      complete: resolve,
      failed: (reason) => reject(new Error(reason)),
    });
    const command = new native.PreviewCommand(
      Application.android.context,
      result,
    );
    cancel = () => command.cancel();
    command.start();
  });
  return { pixels, cancel };
}
