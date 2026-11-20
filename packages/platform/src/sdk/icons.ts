/**
 * Where the framework's rasterised icons live, per host.
 *
 * The icons under `assets/icons` are authored as SVG and rasterised to PNG by
 * `scripts/icons.mjs`: PNG is the one format every backend decodes (WebGL via
 * `createImageBitmap`, the canvas polyfill on Android, a poster on Roku),
 * while SVG is a browser/desktop luxury. A host sets the base once, the way it
 * sets the font directory: `./icons` on the web and the desktop,
 * `file:///app/icons` on Android, `pkg:/icons` on Roku.
 */
const ICON_NAMES = [
  'check',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'close',
] as const;

export type FrameworkIcon = (typeof ICON_NAMES)[number];

let base = './icons';

/** Set the directory the icons are served from. Trailing slashes are dropped. */
export function setIconBase(url: string): void {
  base = url.replace(/\/+$/, '');
}

export function iconBase(): string {
  return base;
}

/** The URL of one icon. */
export function iconSource(name: FrameworkIcon): string {
  return `${base}/${name}.png`;
}
