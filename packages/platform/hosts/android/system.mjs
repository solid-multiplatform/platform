import { Application } from '@nativescript/core';
/** Apply a screen's system-bar preferences, restoring the previous state on disposal. */
export function setSystemBars({
  statusVisible = true,
  navigationVisible = true,
  lightStatusIcons = false,
  lightNavigationIcons = false,
} = {}) {
  const activity =
    Application.android.foregroundActivity ?? Application.android.startActivity;
  if (!activity) throw new Error('No foreground Android activity');
  const win = activity.getWindow(),
    decor = win.getDecorView();
  if (android.os.Build.VERSION.SDK_INT >= 30) {
    const c = win.getInsetsController(),
      t = android.view.WindowInsets.Type,
      insets = decor.getRootWindowInsets();
    if (!c || !insets)
      throw new Error('System bars require an attached window');
    const previous = c.getSystemBarsAppearance(),
      status = insets.isVisible(t.statusBars()),
      nav = insets.isVisible(t.navigationBars());
    const style = android.view.WindowInsetsController;
    const mask =
      style.APPEARANCE_LIGHT_STATUS_BARS |
      style.APPEARANCE_LIGHT_NAVIGATION_BARS;
    const apply = (type, visible) => (visible ? c.show(type) : c.hide(type));
    apply(t.statusBars(), statusVisible);
    apply(t.navigationBars(), navigationVisible);
    // Android's LIGHT_* flags select dark glyphs on a light background.
    c.setSystemBarsAppearance(
      (lightStatusIcons ? 0 : style.APPEARANCE_LIGHT_STATUS_BARS) |
        (lightNavigationIcons ? 0 : style.APPEARANCE_LIGHT_NAVIGATION_BARS),
      mask,
    );
    return () => {
      c.setSystemBarsAppearance(previous, mask);
      apply(t.statusBars(), status);
      apply(t.navigationBars(), nav);
    };
  }
  const before = decor.getSystemUiVisibility(),
    v = android.view.View;
  let flags = before;
  for (const [flag, on] of [
    [v.SYSTEM_UI_FLAG_FULLSCREEN, !statusVisible],
    [v.SYSTEM_UI_FLAG_HIDE_NAVIGATION, !navigationVisible],
    [v.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR, !lightStatusIcons],
    [v.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR, !lightNavigationIcons],
  ])
    flags = on ? flags | flag : flags & ~flag;
  decor.setSystemUiVisibility(flags);
  return () => decor.setSystemUiVisibility(before);
}
