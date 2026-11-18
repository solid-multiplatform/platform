import {
  WebPlatform,
  setDefaultPlatform,
} from '@solid-multiplatform/renderer/platform';
import type { RendererMainSettings } from '@solid-multiplatform/renderer';
interface NativeScriptCanvas {
  getContext(type: string, options?: unknown): unknown;
}

/**
 * Renderer target that swallows the canvas insertion.
 *
 * @remarks
 * The renderer appends its canvas to the target it is given, or finds by
 * id. On NativeScript the Canvas view already sits in the layout, so this
 * is what {@link TvPlatform.getElementById} answers every id with, and what
 * an app passes as the target itself to keep the renderer off
 * `document.getElementById`.
 */
export const stubTarget = {
  appendChild(): void {},
} as unknown as HTMLElement;

/** The Canvas view a renderer whose settings name none draws into. */
let boundCanvas: HTMLCanvasElement | null = null;

/**
 * Registers the Canvas view for a renderer whose settings name no canvas,
 * and makes {@link TvPlatform} the platform of one whose settings name no
 * platform.
 *
 * @remarks
 * For an app written for the browser and booted here unchanged: its own
 * `createRenderer()` then draws into this view through this platform, with
 * the settings {@link TvPlatform.resolveSettings} corrects. An app that
 * passes `rendererSettings(canvas, screen)` names both and needs neither.
 */
export function bindCanvas(canvas: NativeScriptCanvas): void {
  boundCanvas = canvas as unknown as HTMLCanvasElement;
  setDefaultPlatform(TvPlatform);
}

/**
 * What the host holds every app to, whatever its settings say: the platform
 * applies these over them, and the `rendererSettings` preset copies them in
 * too, for a renderer without the `resolveSettings` hook.
 */
export const HOST_SETTINGS: Partial<RendererMainSettings> = {
  // The plugin's WebGL1 context has no vertex array objects, although its GL
  // lists the extension, so the renderer binds every attribute on every
  // program switch: 137 GL calls per frame against 32 on WebGL2, measured on
  // an Apple TV HD and both simulators. The frame rate is the same either
  // way on that scene; the call count is the reason. An app's own choice
  // was made for browsers.
  forceWebGL2: true,
  // Worker contexts lack the polyfill, so decoding stays on the main thread.
  numImageWorkers: 0,
  // The polyfill's createImageBitmap honours the premultiply option and its
  // file-backed requests carry a MIME type: both startup probes are skipped.
  createImageBitmapSupport: 'full',
  premultiplyAlphaHonored: true,
  // The inspector draws into the DOM.
  inspector: false,
};

/**
 * Platform for the NativeScript runtime on Apple TV and iOS.
 *
 * @remarks
 * Canvas sizing differs from {@link WebPlatform}, the canvas and the target
 * come from the host rather than the DOM, and the settings the host cannot
 * honour are corrected. The clock is inherited on purpose: the runtime
 * implements `performance.now()` natively from its monotonic platform
 * clock, and its `requestAnimationFrame` stamps frames on that same
 * timeline, so `deltaTime` and `elapsedTime` stay on one clock.
 * `CACurrentMediaTime` is monotonic too, but it counts from boot, and
 * mixing it with the frame stamps would put `elapsedTime` days off. The
 * loop runs on the runtime's `requestAnimationFrame`, and
 * `createImageBitmap` is the polyfill's.
 */
export class TvPlatform extends WebPlatform {
  /** The view {@link bindCanvas} registered; throws before that. */
  override createCanvas(): HTMLCanvasElement {
    if (boundCanvas === null) {
      throw new Error(
        'TvPlatform: no Canvas view to draw into. Call bindCanvas(view) first, or pass the view as the `canvas` setting.',
      );
    }
    return boundCanvas;
  }

  /** The {@link stubTarget}, whatever the id: the view is in the layout. */
  override getElementById(_id: string): HTMLElement | null {
    return stubTarget;
  }

  /**
   * The app's settings with {@link HOST_SETTINGS} over them. The host's win
   * on purpose, so an app cannot override one through its settings; a
   * subclass that overrides this method can, named as the `platform`.
   */
  override resolveSettings(
    settings: Partial<RendererMainSettings>,
  ): Partial<RendererMainSettings> {
    return Object.assign({}, settings, HOST_SETTINGS);
  }

  override sizeCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    _logicalWidth: number,
    _logicalHeight: number,
  ): void {
    // The Canvas view's numeric `width`/`height` setters size the GL surface
    // in device pixels and leave the layout alone. Its style block is the
    // view's layout, where a `px` unit is a device pixel and a width also
    // rewrites the surface, so the web path's style write would shrink both.
    // The host owns the layout: a canvas sized 100% of its parent.
    canvas.width = width;
    canvas.height = height;
  }
}
