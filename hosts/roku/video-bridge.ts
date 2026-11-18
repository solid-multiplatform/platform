export interface RokuVideoOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export type RokuVideoFactory = (
  root: object,
  options?: RokuVideoOptions,
) => unknown;

export interface RokuVideoApi {
  create(options?: RokuVideoOptions): unknown;
}

/**
 * Expose the optional Roku video adapter to app code without making the base
 * runtime depend on the video package. The app entry exports
 * `createVideoPlayer` (usually wrapping `createRokuPlayer`), and the host binds
 * it to the scene root.
 */
export function createRokuVideoApi(
  root: object,
  factory?: RokuVideoFactory,
): RokuVideoApi | undefined {
  if (!factory) return undefined;
  return { create: (options) => factory(root, options) };
}
