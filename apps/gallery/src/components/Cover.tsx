import type { JSX } from 'solid-js';
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
}): JSX.Element {
  const size = () => props.size;
  const radius = () => props.radius ?? R.medium;
  const [a, b] = props.album.palette;
  return (
    <view
      x={props.x}
      y={props.y}
      width={size()}
      height={size()}
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
          <text
            x={size() * 0.08}
            y={size() - size() * 0.2}
            fontSize={Math.max(12, size() * 0.17)}
            color={0xffffffdd}
            letterSpacing={1}
          >
            {initials(props.album.title)}
          </text>
          <text
            x={size() * 0.08}
            y={size() - size() * 0.09}
            fontSize={Math.max(9, size() * 0.055)}
            color={0xffffff99}
          >
            {String(props.album.year)}
          </text>
        </>
      )}
    </view>
  );
}
