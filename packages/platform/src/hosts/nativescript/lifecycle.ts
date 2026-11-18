import type { KeyBridge } from './KeyBridge.js';

/** The part of `RendererMain` the lifecycle binding drives. */
export interface PausableRenderer {
  pause(options?: { immediate?: boolean }): void;
  resume(): void;
}

/**
 * The part of NativeScript's `Application` the binding listens on. On iOS
 * and tvOS core raises `suspend` from `applicationDidEnterBackground` and
 * `resume` from `applicationDidBecomeActive`.
 */
export interface LifecycleEvents {
  on(event: 'suspend' | 'resume', handler: () => void): void;
  off(event: 'suspend' | 'resume', handler: () => void): void;
}

export interface LifecycleBinding {
  /** Stops listening. The renderer stays in whatever state it is in. */
  unbind(): void;
}

/**
 * The renderer to pause, or a function that returns it once it exists: an
 * app booted from its browser entry creates its renderer after the host has
 * bound the lifecycle, and `undefined` from the function means there is
 * nothing to pause yet.
 */
export type RendererSource =
  | PausableRenderer
  | (() => PausableRenderer | undefined);

/**
 * Stops the renderer while the app is in the background.
 *
 * @remarks
 * On `suspend` the bridge releases every held key, since the press that was
 * down when the app left has no release coming, and the renderer is asked
 * to pause at once; on `resume` it resumes. Apple kills an app that issues
 * GL calls from the background, so an app on this host binds this as soon
 * as it has a renderer. The pause is the renderer's immediate one: its loop
 * stops on its next tick before drawing anything, animations frozen where
 * they are rather than played out in the background, and
 * `RendererMain.isPaused` reports when it has (see `RendererMain.pause`).
 *
 * Pass the `Application` object, or anything with the same `on` and `off`,
 * and the renderer or a function that returns it (see {@link RendererSource}).
 */
export function bindLifecycle(
  renderer: RendererSource,
  bridge: KeyBridge,
  application: LifecycleEvents,
): LifecycleBinding {
  const current = (): PausableRenderer | undefined =>
    typeof renderer === 'function' ? renderer() : renderer;
  const suspend = (): void => {
    bridge.releaseAll();
    const target = current();
    if (target !== undefined) {
      target.pause({ immediate: true });
    }
  };
  // A native resume coincides with WindowManager relaying out the window
  // (visibility, insets, focus). Drawing in that vsync guarantees a missed
  // presentation deadline. Wait for two refresh cycles so the app's first
  // frame is submitted after the window has settled.
  const resume = (): void => {
    const target = current();
    if (target === undefined) return;
    const raf = (
      globalThis as {
        requestAnimationFrame?: (callback: () => void) => unknown;
      }
    ).requestAnimationFrame;
    if (typeof raf === 'function') raf(() => raf(() => target.resume()));
    else setTimeout(() => target.resume(), 32);
  };
  application.on('suspend', suspend);
  application.on('resume', resume);
  return {
    unbind(): void {
      application.off('suspend', suspend);
      application.off('resume', resume);
    },
  };
}
