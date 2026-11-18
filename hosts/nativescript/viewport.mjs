import { Config } from '@solid-multiplatform/platform';
import { Screen } from '@nativescript/core';
import {
  updateViewport,
  zeroInsets,
} from '@solid-multiplatform/platform/viewport';

export function bindMobileViewport(root, target) {
  Config.rendererOptions = { ...Config.rendererOptions, resizable: true };
  let keyboardInset = 0;
  const update = () => {
    const { width, height } = root.getActualSize();
    const scale = Screen.mainScreen.scale;
    let safeArea = zeroInsets;
    let reducedMotion = false;
    if (target === 'android' && root.android) {
      const view = root.android;
      const insets = view.getRootWindowInsets?.();
      if (insets && android.os.Build.VERSION.SDK_INT >= 30) {
        const types = android.view.WindowInsets.Type;
        const bars = insets.getInsets(
          types.systemBars() | types.displayCutout(),
        );
        safeArea = {
          top: bars.top / scale,
          right: bars.right / scale,
          bottom: bars.bottom / scale,
          left: bars.left / scale,
        };
        keyboardInset = insets.getInsets(types.ime()).bottom / scale;
      }
      reducedMotion =
        android.provider.Settings.Global.getFloat(
          view.getContext().getContentResolver(),
          'animator_duration_scale',
          1,
        ) === 0;
    } else if (target === 'ios' && root.ios) {
      const a = root.ios.safeAreaInsets;
      safeArea = { top: a.top, right: a.right, bottom: a.bottom, left: a.left };
      reducedMotion = UIAccessibilityIsReduceMotionEnabled();
    }
    updateViewport({
      width,
      height,
      scale,
      safeArea,
      keyboardInset,
      reducedMotion,
    });
  };
  const dispose = [];
  if (target === 'ios') {
    const center = NSNotificationCenter.defaultCenter;
    for (const name of [
      UIKeyboardWillChangeFrameNotification,
      UIKeyboardWillHideNotification,
      UIAccessibilityReduceMotionStatusDidChangeNotification,
    ]) {
      const token = center.addObserverForNameObjectQueueUsingBlock(
        name,
        null,
        NSOperationQueue.mainQueue,
        (n) => {
          if (name === UIKeyboardWillHideNotification) keyboardInset = 0;
          if (
            name === UIKeyboardWillChangeFrameNotification &&
            root.ios.window
          ) {
            const frame = n.userInfo.objectForKey(
              UIKeyboardFrameEndUserInfoKey,
            ).CGRectValue;
            const rect = root.ios.convertRectFromView(frame, null);
            const h = root.getActualSize().height;
            keyboardInset =
              rect.origin.y + rect.size.height >= h - 1
                ? Math.max(0, h - rect.origin.y)
                : 0;
          }
          update();
        },
      );
      dispose.push(() => center.removeObserver(token));
    }
  } else if (root.android) {
    const tree = root.android.getViewTreeObserver();
    const listener = new android.view.ViewTreeObserver.OnGlobalLayoutListener({
      onGlobalLayout: update,
    });
    tree.addOnGlobalLayoutListener(listener);
    dispose.push(() => {
      if (tree.isAlive()) tree.removeOnGlobalLayoutListener(listener);
    });
  }
  root.on('layoutChanged', update);
  update();
  return () => {
    root.off('layoutChanged', update);
    for (const release of dispose) release();
  };
}
