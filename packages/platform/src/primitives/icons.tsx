import type { JSX } from 'solid-js';
import { iconSource, type FrameworkIcon } from '../sdk/icons.js';
import { Image } from './Image.jsx';

/**
 * The framework's icons: rasterised PNGs of hand-authored SVG paths, drawn
 * through the image path so every backend can show them (see
 * `sdk/icons.ts`). They are white, and the node's `color` tints them, so one
 * asset serves every theme.
 */
export function FrameworkIconView(props: {
  name: FrameworkIcon;
  size: number;
  color?: number;
}): JSX.Element {
  return (
    <Image
      src={iconSource(props.name)}
      width={props.size}
      height={props.size}
      color={props.color ?? 0xffffffff}
      fit="contain"
    />
  );
}

/** An × for closing a panel. */
export function CloseIcon(props: {
  size: number;
  color: number;
  thickness?: number;
}): JSX.Element {
  return (
    <FrameworkIconView name="close" size={props.size} color={props.color} />
  );
}

/** A chevron. `direction` is the way it points. */
export function ChevronIcon(props: {
  size: number;
  color: number;
  direction?: 'left' | 'right' | 'down';
  thickness?: number;
}): JSX.Element {
  return (
    <FrameworkIconView
      name={`chevron-${props.direction ?? 'down'}` as FrameworkIcon}
      size={props.size}
      color={props.color}
    />
  );
}

/** A check. */
export function CheckIcon(props: {
  size: number;
  color: number;
  thickness?: number;
}): JSX.Element {
  return (
    <FrameworkIconView name="check" size={props.size} color={props.color} />
  );
}
