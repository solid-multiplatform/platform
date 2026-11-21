import type { JSX } from 'solid-js';
import { iconSource, type FrameworkIcon } from '@solid-multiplatform/platform';
import { Image } from '@solid-multiplatform/platform/primitives';

/** The app's icons, by the name the screens use. */
export type GlyphName =
  | 'library'
  | 'plus'
  | 'activity'
  | 'dots'
  | 'search'
  | 'filter'
  | 'calendar'
  | 'shuffle'
  | 'play';

const ICONS: Record<GlyphName, FrameworkIcon> = {
  library: 'library',
  plus: 'plus',
  activity: 'sliders',
  dots: 'more',
  search: 'search',
  filter: 'sliders',
  calendar: 'calendar',
  shuffle: 'play',
  play: 'play',
};

/**
 * An icon from the framework's set (`assets/icons`: SVG sources rasterised to
 * PNG so every backend decodes them). White artwork, tinted by the node's
 * colour, so one asset serves every theme.
 */
export function Glyph(props: {
  name: GlyphName;
  size: number;
  color: number;
}): JSX.Element {
  return (
    <Image
      src={iconSource(ICONS[props.name])}
      width={props.size}
      height={props.size}
      color={props.color}
      fit="contain"
    />
  );
}
