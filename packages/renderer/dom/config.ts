/**
 * Defaults the DOM backend reads while it lays out text. The platform passes
 * its own live configuration object, so later changes to it are seen here.
 */
export interface DomRendererConfig {
  fontSettings: {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    fontWeight?: number | string;
    [setting: string]: unknown;
  };
  rendererOptions?: { deviceLogicalPixelRatio?: number };
}

export let Config: DomRendererConfig = { fontSettings: {} };

export function configureDomRenderer(config: DomRendererConfig): void {
  Config = config;
}
