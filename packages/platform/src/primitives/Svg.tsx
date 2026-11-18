import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { useTheme } from '../sdk/theme.jsx';
import {
  getIcon,
  iconDataUrl,
  svgDataUrl,
  type IconDefinition,
} from '../sdk/svg.js';
import { Image } from './Image.jsx';

export interface SvgProps {
  /** An SVG document (`<svg …>`) or an image URL. */
  source: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain';
  ref?: (node: ElementNode) => void;
}

/**
 * Render an SVG document as a texture. Full SVG is supported through the
 * host image decoder; browsers and desktop (sharp/librsvg) accept the encoded
 * data URL directly. For simple icons prefer `Icon`, which builds the SVG.
 */
export function Svg(props: SvgProps): JSX.Element {
  const source = () =>
    props.source.trimStart().startsWith('<svg')
      ? svgDataUrl(props.source)
      : props.source;
  return (
    <Image
      ref={props.ref}
      src={source()}
      placeholder={source()}
      x={props.x}
      y={props.y}
      width={props.width ?? 24}
      height={props.height ?? props.width ?? 24}
      fit={props.fit ?? 'contain'}
    />
  );
}

export interface IconProps {
  /** Name registered with `registerIcon`. */
  name?: string;
  /** Inline definition, instead of a registry name. */
  definition?: IconDefinition;
  /** Shorthand for `definition: { path }`. */
  path?: string;
  viewBox?: string;
  x?: number;
  y?: number;
  /** Square size. Overridden by explicit width/height. */
  size?: number;
  width?: number;
  height?: number;
  /** 0xRRGGBBAA. Defaults to the theme text colour. */
  color?: number;
  /** Stroke the path instead of filling it. */
  stroke?: boolean;
  strokeWidth?: number;
  fit?: 'cover' | 'contain';
  ref?: (node: ElementNode) => void;
}

/**
 * Path icon. Register icon sets once with `registerIcons`, then render by
 * name. The path is wrapped in a minimal SVG document, so the same definition
 * works on web, desktop and any host whose image decoder supports SVG.
 */
export function Icon(props: IconProps): JSX.Element {
  const theme = () => useTheme();
  const definition = (): IconDefinition | undefined => {
    if (props.definition) return props.definition;
    if (props.path !== undefined) {
      return { path: props.path, viewBox: props.viewBox };
    }
    return props.name ? getIcon(props.name) : undefined;
  };
  const width = () => props.width ?? props.size ?? 24;
  const height = () => props.height ?? props.size ?? width();
  const source = () => {
    const icon = definition();
    if (!icon) throw new Error(`Unknown icon: ${props.name ?? '(inline)'}`);
    return iconDataUrl(icon, {
      width: width(),
      height: height(),
      color: props.color ?? theme().colors.text,
      stroke: props.stroke,
      strokeWidth: props.strokeWidth,
    });
  };
  return (
    <Image
      ref={props.ref}
      src={source()}
      placeholder={source()}
      x={props.x}
      y={props.y}
      width={width()}
      height={height()}
      fit={props.fit ?? 'contain'}
    />
  );
}
