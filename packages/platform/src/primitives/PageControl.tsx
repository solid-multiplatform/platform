import { For, type JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';

export interface PageControlProps {
  count: number;
  index: number | (() => number);
  onChange?(index: number): void;
  x?: number;
  y?: number;
  /** The visible dot diameter. Defaults to 8. */
  dotSize?: number;
  color?: number;
  activeColor?: number;
  /** Accessible name; defaults to "Page". */
  label?: string;
}

/**
 * Apple's page control: one dot per page, the current page filled in the
 * accent colour. The dots are a compact indicator; each has a 44-unit hit
 * target so a tap can jump to that page, and the whole control is skipped by
 * focus until an app chooses to wrap it.
 */
export function PageControl(props: PageControlProps): JSX.Element {
  const theme = useTheme();
  const current = () =>
    typeof props.index === 'function' ? props.index() : props.index;
  const dot = () => props.dotSize ?? 8;
  const target = () => Math.max(44, dot() + 16);
  const width = () => Math.max(0, props.count * target());
  const height = () => target();
  return (
    <view
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      role="group"
      ariaLabel={props.label ?? 'Page'}
    >
      <For each={Array.from({ length: Math.max(0, props.count) }, (_, i) => i)}>
        {(index) => (
          <view
            skipFocus
            role="button"
            x={index * target()}
            y={0}
            width={target()}
            height={height()}
            onEnter={() => props.onChange?.(index)}
            onMouseClick={() => props.onChange?.(index)}
            cursorStyle={props.onChange === undefined ? undefined : 'pointer'}
            ariaLabel={`${props.label ?? 'Page'} ${index + 1}`}
          >
            <view
              skipFocus
              x={(target() - dot()) / 2}
              y={(height() - dot()) / 2}
              width={dot()}
              height={dot()}
              borderRadius={dot() / 2}
              color={
                index === current()
                  ? (props.activeColor ?? theme.colors.primary)
                  : (props.color ?? theme.colors.textMuted)
              }
            />
          </view>
        )}
      </For>
    </view>
  );
}
