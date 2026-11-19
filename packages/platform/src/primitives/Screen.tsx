import { createMemo, splitProps, useContext, type JSX } from 'solid-js';
import { AppScope, type DesignSize } from '../app/context.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Column } from './Column.jsx';
import type { ColumnProps } from './types.js';

export interface ScreenProps extends Omit<ColumnProps, 'padding' | 'scale'> {
  /**
   * The coordinate space the children are laid out in, scaled to the
   * viewport. Defaults to the project's `app.designSize` on TV targets;
   * without one the children use the viewport's own units.
   */
  designSize?: DesignSize;
  /**
   * What happens when the viewport's aspect ratio differs from the design's.
   * `extend` (the default) fills the viewport: the design space grows along
   * the spare axis, so lay out with flex. `contain` keeps the design size
   * exactly and centres it, leaving bars in the theme's background colour.
   */
  fit?: 'extend' | 'contain';
  /** Space between the safe area and the content, in design units. */
  padding?: number;
}

/**
 * The root of a screen: fills the viewport with the theme's background, keeps
 * its children inside the safe area, lays them out as a column and moves
 * focus between them. The column is inset rather than padded, so a `Spacer`
 * shares exactly the space inside the safe area. The geometry is computed
 * when the viewport changes, never per frame.
 */
export function Screen(props: ScreenProps): JSX.Element {
  const scope = useContext(AppScope);
  const theme = () => useTheme();
  const [local, rest] = splitProps(props, [
    'designSize',
    'fit',
    'padding',
    'gap',
    'children',
  ]);
  const frame = createMemo(() => {
    const v = viewport();
    const design = local.designSize ?? scope?.designSize;
    const scale = design
      ? Math.min(v.width / design.width, v.height / design.height)
      : 1;
    const contain = design !== undefined && local.fit === 'contain';
    const width = contain ? design.width : v.width / scale;
    const height = contain ? design.height : v.height / scale;
    // The bars `contain` leaves already keep content away from the edges.
    const barX = (v.width - width * scale) / 2;
    const barY = (v.height - height * scale) / 2;
    const pad = (local.padding as number | undefined) ?? theme().spacing(8);
    const inset = (edge: number, bar: number) =>
      Math.max(0, edge - bar) / scale + pad;
    const left = inset(v.safeArea.left, barX);
    const top = inset(v.safeArea.top, barY);
    const w = width - left - inset(v.safeArea.right, barX);
    const h = height - top - inset(v.safeArea.bottom, barY);
    return {
      scale,
      width: w,
      height: h,
      // A node scales about its centre: put the column's centre where the
      // centre of the padded design box lands on screen.
      x: barX + (left + w / 2) * scale - w / 2,
      y: barY + (top + h / 2) * scale - h / 2,
    };
  });
  return (
    <view
      width={viewport().width}
      height={viewport().height}
      color={theme().colors.background}
    >
      <Column
        scroll="none"
        alignItems="flexStart"
        autofocus
        {...rest}
        x={frame().x}
        y={frame().y}
        width={frame().width}
        height={frame().height}
        scale={frame().scale}
        gap={(local.gap as number | undefined) ?? theme().spacing(6)}
        flexBoundary="fixed"
      >
        {local.children as JSX.Element}
      </Column>
    </view>
  );
}
