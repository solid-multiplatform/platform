import { For, createEffect, onCleanup, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { Config } from '../core/config.js';
import { useTheme } from '../sdk/theme.jsx';

export interface ActivityIndicatorProps {
  /** Diameter in logical units. Defaults to 20, scaled by the theme type. */
  size?: number;
  color?: number;
  /** Set false to draw the ring without spinning. Defaults to true. */
  animating?: boolean;
  /** Read by assistive technology; defaults to "Loading". */
  label?: string;
  x?: number;
  y?: number;
}

/**
 * Apple's activity indicator: eight fading spokes in a ring that spins while
 * something is loading. It is opt-in and frame-driven only while visible and
 * animating; with Reduce Motion on it draws a static ring. Nothing is
 * scheduled once it is removed or `animating` is false.
 */
export function ActivityIndicator(props: ActivityIndicatorProps): JSX.Element {
  const theme = useTheme();
  const size = () =>
    props.size ?? Math.max(16, Math.round(20 * (theme.typography.label / 13)));
  const bars = 8;
  const barWidth = () => Math.max(2, Math.round(size() * 0.11));
  const barHeight = () => Math.max(3, Math.round(size() * 0.28));
  const color = () => props.color ?? theme.colors.textMuted;
  let node: ElementNode | undefined;
  let animation: { stop(): void } | undefined;

  createEffect(() => {
    const animating = props.animating !== false && Config.animationsEnabled;
    if (node === undefined || !animating) {
      animation?.stop();
      animation = undefined;
      return;
    }
    if (animation !== undefined) return;
    animation = node.animate(
      { rotation: Math.PI * 2 },
      { duration: 900, loop: true, easing: 'linear' },
    );
  });
  onCleanup(() => {
    animation?.stop();
    animation = undefined;
  });

  return (
    <view
      ref={(el) => (node = el)}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={size()}
      height={size()}
      role="progressbar"
      ariaLabel={props.label ?? 'Loading'}
      skipFocus
      style={{ color: 0x00000000 }}
    >
      <For each={Array.from({ length: bars }, (_, index) => index)}>
        {(index) => (
          <view
            skipFocus
            width={size()}
            height={size()}
            rotation={(index * Math.PI * 2) / bars}
            style={{ color: 0x00000000 }}
          >
            <view
              skipFocus
              x={size() / 2 - barWidth() / 2}
              y={Math.round(size() * 0.04)}
              width={barWidth()}
              height={barHeight()}
              borderRadius={barWidth() / 2}
              color={color()}
              alpha={0.2 + (index / (bars - 1)) * 0.8}
            />
          </view>
        )}
      </For>
    </view>
  );
}
