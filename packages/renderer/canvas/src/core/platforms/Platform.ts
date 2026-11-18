import { type Stage } from '../Stage.js';
import type { RendererMainSettings } from '../../main-api/Renderer.js';

export abstract class Platform {
  /**
   * Adjusts the renderer settings before they take effect.
   *
   * @remarks
   * Called once from the RendererMain constructor with the settings the app
   * passed, before any default is applied. A host whose platform cannot
   * honour a setting returns a copy with it replaced: no image workers where
   * worker contexts lack the browser globals, the canvas view the host
   * already laid out. The base implementation returns the settings as they
   * are.
   */
  resolveSettings(
    settings: Partial<RendererMainSettings>,
  ): Partial<RendererMainSettings> {
    return settings;
  }

  /**
   * Creates a new canvas element.
   * @returns The created HTMLCanvasElement.
   */
  abstract createCanvas(): HTMLCanvasElement;

  /**
   * Get a DOM element by ID
   * @returns The DOM element (or null)
   */
  abstract getElementById(id: string): HTMLElement | null;

  /**
   * Sizes the canvas the renderer draws into.
   *
   * @remarks
   * `width` and `height` are the backing store in device pixels, derived from
   * `appWidth`/`appHeight` and both pixel ratios. `logicalWidth` and
   * `logicalHeight` are the presented size in the host's layout units, CSS
   * pixels on the web. Called once from the RendererMain constructor and again
   * whenever the dimensions or the pixel ratios change.
   */
  abstract sizeCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    logicalWidth: number,
    logicalHeight: number,
  ): void;

  /**
   * Starts the main rendering loop, calling the provided update function every frame.
   *
   * @remarks
   * The loop installs `stage.loopResume`, which requests one frame for a loop
   * that has none pending. A loop may stop scheduling while the stage has
   * nothing to do (`stage.needsTick()` is false): it then sets
   * `stage.loopAsleep` as the last thing its tick does, and the stage calls
   * `loopResume` when there is work again. One that never sets the flag is
   * never woken and has to keep itself running. It may also install
   * `stage.loopStop`, which cancels what the loop has pending.
   *
   * @param Stage - The stage for rendering
   */
  abstract startLoop(stage: Stage): void;

  /**
   * Abstracted createImageBitmap method.
   * @param blob - The image source to create the ImageBitmap from.
   * @param sxOrOptions - The source rectangle x coordinate or ImageBitmapOptions.
   * @param sy - The source rectangle y coordinate.
   * @param sw - The source rectangle width.
   * @param sh - The source rectangle height.
   * @param options - The ImageBitmapOptions.
   * @returns A promise that resolves with the created ImageBitmap.
   */
  abstract createImageBitmap(blob: ImageBitmapSource): Promise<ImageBitmap>;
  abstract createImageBitmap(
    blob: ImageBitmapSource,
    options: ImageBitmapOptions,
  ): Promise<ImageBitmap>;
  abstract createImageBitmap(
    blob: ImageBitmapSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): Promise<ImageBitmap>;
  abstract createImageBitmap(
    blob: ImageBitmapSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    options: ImageBitmapOptions,
  ): Promise<ImageBitmap>;

  /**
   * Retrieves the current timestamp in milliseconds.
   *
   * @remarks
   * Must be monotonic and should be sub-millisecond where the platform can
   * manage it: this clock drives `deltaTime`, the animation step and the FPS
   * sample, and a source that can jump backwards (a wall clock taking an NTP
   * correction) produces negative deltas on those paths. The epoch is
   * deliberately unspecified, so only differences between two readings are
   * meaningful.
   *
   * @returns The current timestamp.
   */
  abstract getTimeStamp(): number;

  /**
   * Adds a FontFace to the platforms FontFaceSet
   * @param font - The FontFace to add
   */
  abstract addFont(font: FontFace): void;
}

export type PlatformConstructor = new () => Platform;

let defaultPlatform: PlatformConstructor | null = null;

/**
 * Registers the platform a renderer uses when its settings name none.
 *
 * @remarks
 * A host that boots an app written for the browser sets its platform here
 * before the app runs, so the app's own renderer settings need not know
 * about it. `null` restores the web platform. A `platform` setting still
 * takes precedence.
 */
export const setDefaultPlatform = (
  platform: PlatformConstructor | null,
): void => {
  defaultPlatform = platform;
};

export const getDefaultPlatform = (): PlatformConstructor | null =>
  defaultPlatform;
