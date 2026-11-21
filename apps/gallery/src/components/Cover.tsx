import type { JSX } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import type { Album } from '../data';
import { initials, R } from '../theme';

/**
 * Album art, generated: a two-colour gradient, a thin ring and a rule, and
 * the album's initials. No image files, so every platform draws the same
 * cover from the same data — and the gradient path is exercised on every
 * screen for free.
 */
export function Cover(props: {
  album: Album;
  size: number;
  radius?: number;
  x?: number;
  y?: number;
  /** Hide the lettering on very small covers. */
  label?: boolean;
  /** Hidden while a hero flight draws this cover instead. */
  hidden?: boolean;
  ref?: (node: ElementNode) => void;
}): JSX.Element {
  const size = () => props.size;
  const radius = () => props.radius ?? R.medium;
  const [a, b] = props.album.palette;
  return (
    <view
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={size()}
      height={size()}
      hidden={props.hidden}
      borderRadius={radius()}
      clipping
      linearGradient={{
        colors: [a, b],
        angle: props.album.angle,
        stops: [0, 1],
      }}
    >
      <view
        x={size() * 0.56}
        y={-size() * 0.18}
        width={size() * 0.78}
        height={size() * 0.78}
        borderRadius={size() * 0.39}
        border={{ width: 1, color: 0xffffff2e }}
      />
      <view
        x={-size() * 0.1}
        y={size() * 0.7}
        width={size() * 0.9}
        height={1}
        rotation={-0.18}
        color={0xffffff26}
      />
      {props.label === false ? null : (
        <>
          {/* Two lines, stacked from the same baseline grid: the initials
              above, the year under them, both inside the cover's bottom-left
              inset. The gap is a share of the initials' line box. */}
          <text
            x={size() * 0.09}
            y={size() * 0.62}
            fontSize={Math.max(12, size() * 0.16)}
            color={0xffffffdd}
            letterSpacing={1}
          >
            {initials(props.album.title)}
          </text>
          <text
            x={size() * 0.09}
            y={size() * 0.62 + Math.max(12, size() * 0.16) * 1.45}
            fontSize={Math.max(9, size() * 0.052)}
            color={0xffffff99}
          >
            {String(props.album.year)}
          </text>
        </>
      )}
    </view>
  );
}
