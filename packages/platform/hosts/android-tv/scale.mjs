// The view is already measured in physical pixels. Android's UI density would
// apply a second scale to a TV scene expressed in logical 1920x1080 units.
export function tvBackingScale(
  viewWidth,
  viewHeight,
  appWidth = 1920,
  appHeight = 1080,
  logicalRatio = 1,
) {
  if (
    !(
      viewWidth > 0 &&
      viewHeight > 0 &&
      appWidth > 0 &&
      appHeight > 0 &&
      logicalRatio > 0
    )
  )
    return 1;
  return Math.min(viewWidth / appWidth, viewHeight / appHeight) / logicalRatio;
}
