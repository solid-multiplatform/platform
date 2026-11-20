import type { JSX } from 'solid-js';

/**
 * Icons drawn from bars, not typed as characters.
 *
 * A glyph like "×" or "‹" comes from whatever face the host happens to have,
 * sits on its own baseline, and is often missing from the MSDF atlases the
 * renderer ships — so a close button ends up a lowercase letter in the wrong
 * place. These are two bars with a rotation: crisp at any size, identical on
 * every backend, and they take the colour they are given.
 *
 * Coordinates are fractions of `size`; the thickness is in logical units.
 */
function bar(
  size: number,
  thickness: number,
  color: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): JSX.Element {
  const length = Math.hypot(x2 - x1, y2 - y1) * size;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return (
    <view
      x={((x1 + x2) / 2) * size - length / 2}
      y={((y1 + y2) / 2) * size - thickness / 2}
      width={length}
      height={thickness}
      rotation={angle}
      color={color}
    />
  );
}

const stroke = (size: number, thickness?: number): number =>
  thickness ?? Math.max(1.5, Math.round(size * 0.09 * 2) / 2);

/** An × for closing a panel. */
export function CloseIcon(props: {
  size: number;
  color: number;
  thickness?: number;
}): JSX.Element {
  const t = () => stroke(props.size, props.thickness);
  return (
    <view width={props.size} height={props.size}>
      {bar(props.size, t(), props.color, 0.3, 0.3, 0.7, 0.7)}
      {bar(props.size, t(), props.color, 0.7, 0.3, 0.3, 0.7)}
    </view>
  );
}

/** The three points a chevron is drawn through, as fractions of `size`. */
function chevronPoints(
  direction: 'left' | 'right' | 'down',
): [number, number, number, number, number, number] {
  if (direction === 'left') return [0.62, 0.26, 0.34, 0.5, 0.62, 0.74];
  if (direction === 'right') return [0.38, 0.26, 0.66, 0.5, 0.38, 0.74];
  return [0.28, 0.38, 0.5, 0.62, 0.72, 0.38];
}

/**
 * A chevron. `direction` is the way it points: a left chevron is the "‹"
 * shape on a month stepper, a down chevron is the "⌄" on a select.
 */
export function ChevronIcon(props: {
  size: number;
  color: number;
  direction?: 'left' | 'right' | 'down';
  thickness?: number;
}): JSX.Element {
  const t = () => stroke(props.size, props.thickness);
  const p = () => chevronPoints(props.direction ?? 'down');
  return (
    <view width={props.size} height={props.size}>
      {bar(props.size, t(), props.color, p()[0], p()[1], p()[2], p()[3])}
      {bar(props.size, t(), props.color, p()[2], p()[3], p()[4], p()[5])}
    </view>
  );
}

/** A check, the same shape the Choice primitive draws inside its box. */
export function CheckIcon(props: {
  size: number;
  color: number;
  thickness?: number;
}): JSX.Element {
  const t = () => stroke(props.size, props.thickness);
  return (
    <view width={props.size} height={props.size}>
      {bar(props.size, t(), props.color, 0.22, 0.54, 0.42, 0.74)}
      {bar(props.size, t(), props.color, 0.42, 0.74, 0.78, 0.28)}
    </view>
  );
}
