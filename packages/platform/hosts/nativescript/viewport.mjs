import { Config, setColorScheme } from '@solid-multiplatform/platform';
import { Application, Screen } from '@nativescript/core';
import {
  updateViewport,
  zeroInsets,
} from '@solid-multiplatform/platform/viewport';

let SafeAreaObserver;
function observeSafeArea(view, update) {
  SafeAreaObserver ??= UIView.extend(
    {
      safeAreaInsetsDidChange() {
        UIView.prototype.safeAreaInsetsDidChange.call(this);
        this.onInsets?.();
      },
      didMoveToWindow() {
        UIView.prototype.didMoveToWindow.call(this);
        this.onInsets?.();
      },
    },
    { name: 'SolidViewportSafeAreaObserver' },
  );
  const observer = SafeAreaObserver.alloc().initWithFrame(view.bounds);
  observer.autoresizingMask = 2 | 16; // flexible width and height
  observer.userInteractionEnabled = false;
  observer.accessibilityElementsHidden = true;
  observer.onInsets = update;
  view.insertSubviewAtIndex(observer, 0);
  return () => {
    observer.onInsets = undefined;
    observer.removeFromSuperview();
  };
}

export function bindMobileViewport(root, target) {
  Config.rendererOptions = { ...Config.rendererOptions, resizable: true };
  let keyboardInset = 0;
  let systemBars = zeroInsets;
  let displayCutout = zeroInsets;
  const update = () => {
    // A rotation can deliver a layout callback before the new bounds exist,
    // and NativeScript returns undefined from getActualSize until then. Keep
    // the last published viewport instead of throwing inside the native
    // callback (and instead of publishing a zero-sized one).
    const size = root.getActualSize();
    if (!size || !(size.width > 0) || !(size.height > 0)) return;
    const { width, height } = size;
    const scale = Screen.mainScreen.scale;
    let safeArea = zeroInsets;
    let reducedMotion = false;
    if (target === 'android' && root.android) {
      const view = root.android;
      const insets = view.getRootWindowInsets?.();
      if (insets && android.os.Build.VERSION.SDK_INT >= 30) {
        const types = android.view.WindowInsets.Type;
        const system = insets.getInsets(types.systemBars());
        const cutout = insets.getInsets(types.displayCutout());
        const bars = insets.getInsets(
          types.systemBars() | types.displayCutout(),
        );
        safeArea = {
          top: bars.top / scale,
          right: bars.right / scale,
          bottom: bars.bottom / scale,
          left: bars.left / scale,
        };
        systemBars = {
          top: system.top / scale,
          right: system.right / scale,
          bottom: system.bottom / scale,
          left: system.left / scale,
        };
        displayCutout = {
          top: cutout.top / scale,
          right: cutout.right / scale,
          bottom: cutout.bottom / scale,
          left: cutout.left / scale,
        };
        keyboardInset = insets.getInsets(types.ime()).bottom / scale;
        const night =
          (view.getContext().getResources().getConfiguration().uiMode &
            android.content.res.Configuration.UI_MODE_NIGHT_MASK) ===
          android.content.res.Configuration.UI_MODE_NIGHT_YES;
        setColorScheme(night ? 'dark' : 'light');
      }
      reducedMotion =
        android.provider.Settings.Global.getFloat(
          view.getContext().getContentResolver(),
          'animator_duration_scale',
          1,
        ) === 0;
    } else if (target === 'ios' && root.ios) {
      const view = root.ios,
        window = view.window;
      const a = view.safeAreaInsets;
      safeArea = { top: a.top, right: a.right, bottom: a.bottom, left: a.left };
      if (window) {
        const rect = view.convertRectFromView(
          window.safeAreaLayoutGuide.layoutFrame,
          window,
        );
        safeArea = {
          top: Math.max(a.top, rect.origin.y),
          left: Math.max(a.left, rect.origin.x),
          right: Math.max(
            a.right,
            view.bounds.size.width - rect.origin.x - rect.size.width,
          ),
          bottom: Math.max(
            a.bottom,
            view.bounds.size.height - rect.origin.y - rect.size.height,
          ),
        };
      }
      reducedMotion = UIAccessibilityIsReduceMotionEnabled();
    }
    if (target === 'ios') {
      const style =
        root.ios?.traitCollection?.userInterfaceStyle ??
        UIScreen.mainScreen.traitCollection.userInterfaceStyle;
      setColorScheme(style === 2 ? 'dark' : 'light');
      systemBars = zeroInsets;
      displayCutout = zeroInsets;
    }
    updateViewport({
      width,
      height,
      scale,
      safeArea,
      keyboardInset,
      reducedMotion,
      systemBars,
      displayCutout,
      ime: { ...zeroInsets, bottom: keyboardInset },
    });
  };
  const dispose = [];
  if (target === 'ios') {
    dispose.push(observeSafeArea(root.ios, update));
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
  if (target === 'android') {
    // A rotation also raises NativeScript's own orientation event, before the
    // new window bounds exist. Measure once the window has been laid out: if
    // the root's layout change is coalesced with another pass, or delivered
    // while the old bounds are still attached, the viewport and every native
    // control bounded from it must still follow the window.
    const orientationChanged = () => {
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf === 'function') raf(() => raf(update));
      else update();
    };
    Application.on('orientationChanged', orientationChanged);
    dispose.push(() =>
      Application.off('orientationChanged', orientationChanged),
    );
  }
  root.on('layoutChanged', update);
  update();
  return () => {
    root.off('layoutChanged', update);
    for (const release of dispose) release();
  };
}
