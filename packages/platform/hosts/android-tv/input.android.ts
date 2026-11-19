import { Application } from '@nativescript/core';
import type { HistorySource } from '@solid-multiplatform/platform/host';
import type { BackDispatcher } from '@solid-multiplatform/platform';
import type { KeyBridge } from '@solid-multiplatform/platform/nativescript';
import { createInputController } from './input.mjs';

export function bindAndroidInput(
  bridge: KeyBridge,
  view: android.view.View,
  history?: HistorySource,
  dispatcher?: BackDispatcher,
) {
  const input = createInputController(bridge);
  view.setFocusable(true);
  view.setFocusableInTouchMode(true);
  view.setOnKeyListener(
    new android.view.View.OnKeyListener({
      onKey: (_view, code, event) =>
        input.key(event.getAction(), code, event.getRepeatCount()),
    }),
  );
  const back = (args: any) => {
    // The app's Back key handler runs first. An unhandled press goes through
    // the host's dispatcher (screen history, then the exit action); the old
    // history-only path stays for a host that has no dispatcher.
    if (input.back()) {
      args.cancel = true;
      return;
    }
    if (dispatcher !== undefined) {
      if (dispatcher.handle({ synthesize: false })) args.cancel = true;
      return;
    }
    if (history?.canGoBack?.() && history.go !== undefined) {
      args.cancel = true;
      history.go(-1);
    }
  };
  const release = () => input.release();
  const focus = () => view.requestFocus();
  Application.android.on('activityBackPressed', back);
  Application.on('suspend', release);
  Application.on('resume', focus);
  view.requestFocus();
  return () => {
    input.release();
    view.setOnKeyListener(null as any);
    Application.android.off('activityBackPressed', back);
    Application.off('suspend', release);
    Application.off('resume', focus);
  };
}
