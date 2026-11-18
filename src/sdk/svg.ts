export interface IconDefinition {
  /** SVG path `d` data. */
  path: string;
  /** SVG viewBox. Defaults to `0 0 24 24`. */
  viewBox?: string;
  /** Fill rule for compound paths. Defaults to `nonzero`. */
  fillRule?: 'nonzero' | 'evenodd';
}

export interface IconRenderOptions {
  width?: number;
  height?: number;
  color?: number;
  /** Draw the path as a stroke instead of a fill. */
  stroke?: boolean;
  strokeWidth?: number;
}

const registry = new Map<string, IconDefinition>();

/** Register a named path icon, e.g. from an icon set. */
export function registerIcon(name: string, definition: IconDefinition): void {
  registry.set(name, definition);
}

export function registerIcons(
  definitions: Record<string, IconDefinition>,
): void {
  for (const [name, definition] of Object.entries(definitions)) {
    registerIcon(name, definition);
  }
}

export function getIcon(name: string): IconDefinition | undefined {
  return registry.get(name);
}

export function clearIconRegistry(): void {
  registry.clear();
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const colorParts = (color: number) => ({
  /** #rrggbb */
  hex: `#${(color >>> 8).toString(16).padStart(6, '0').slice(-6)}`,
  opacity: (color & 0xff) / 255,
});

/** Encode an SVG document as a data URL consumable by `Image`. */
export function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Build the SVG document for a path icon. The result is a self-contained
 * document, so it can be URL-encoded for an image texture or written to disk.
 */
export function iconSvg(
  definition: IconDefinition,
  options: IconRenderOptions = {},
): string {
  const width = options.width ?? 24;
  const height = options.height ?? width;
  const viewBox = definition.viewBox ?? '0 0 24 24';
  const color = colorParts(options.color ?? 0xffffffff);
  const paint = options.stroke
    ? `fill="none" stroke="${color.hex}" stroke-opacity="${color.opacity}" stroke-width="${options.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"`
    : `fill="${color.hex}" fill-opacity="${color.opacity}" fill-rule="${definition.fillRule ?? 'nonzero'}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${escapeXml(viewBox)}"><path d="${escapeXml(definition.path)}" ${paint}/></svg>`;
}

/** Build a data URL for a named or inline icon. */
export function iconDataUrl(
  icon: string | IconDefinition,
  options: IconRenderOptions = {},
): string {
  const definition = typeof icon === 'string' ? registry.get(icon) : icon;
  if (!definition) {
    throw new Error(`Unknown icon: ${String(icon)}`);
  }
  return svgDataUrl(iconSvg(definition, options));
}
