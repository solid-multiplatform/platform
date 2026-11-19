import { Application } from '@nativescript/core';
import type { HistorySource } from '@solid-multiplatform/platform/host';
import type { BackDispatcher } from '@solid-multiplatform/platform';

/**
 * Android's hardware/gesture Back moves the host history one entry when
 * there is one. At the root it returns the press to the system, which leaves
 * the app, as it did before there was a history.
 *
 * A target that also delivers Back as a key (Android TV does) runs the app's
 * key handler first; this is for the form that has only touch.
 */
export function bindAndroidBack(
  history: HistorySource | undefined,
  dispatcher?: BackDispatcher,
) {
  // With a dispatcher, Back follows the framework's precedence chain: work in
  // flight, one synthetic mapped Back through the focus path, screen history,
  // then the root policy. The dispatcher's exit action leaves the app.
  if (dispatcher !== undefined) {
    const back = (args: { cancel?: boolean }) => {
      if (dispatcher.handle()) args.cancel = true;
    };
    Application.android.on('activityBackPressed', back);
    return () => Application.android.off('activityBackPressed', back);
  }
  const go = history?.go?.bind(history);
  const canGoBack = history?.canGoBack?.bind(history);
  if (go === undefined || canGoBack === undefined) {
    return () => {};
  }
  const back = (args: { cancel?: boolean }) => {
    if (!canGoBack()) return;
    args.cancel = true;
    go(-1);
  };
  Application.android.on('activityBackPressed', back);
  return () => Application.android.off('activityBackPressed', back);
}
