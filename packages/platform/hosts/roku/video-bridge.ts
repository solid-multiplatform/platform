import { peekService } from '../../src/sdk/registry.js';

export interface RokuVideoOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /**
   * The host's media-session port, added by {@link createRokuVideoApi} so the
   * adapter's play/pause/stop/seek handlers reach the app's media session.
   */
  mediaSession?: unknown;
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
 * it to the scene root and the host's `mediaSession` service.
 */
export function createRokuVideoApi(
  root: object,
  factory?: RokuVideoFactory,
): RokuVideoApi | undefined {
  if (!factory) return undefined;
  return {
    create: (options) =>
      factory(root, {
        ...options,
        mediaSession: peekService('mediaSession'),
      }),
  };
}
