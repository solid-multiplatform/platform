import { tvBackingScale } from './scale.mjs';
import { Application, File, knownFolders, Http } from '@nativescript/core';
import type { Canvas } from '@nativescript/canvas';
import { TvPlatform } from '@solid-multiplatform/platform/nativescript';
import { setDefaultPlatform } from '@solid-multiplatform/renderer/platform';
import type { RendererMainSettings } from '@solid-multiplatform/renderer';
import { createNativeContext } from './gl-context.mjs';
import { httpArrayBuffer } from './http-buffer.android';
import { bindDisplayRefreshRate } from './refresh-rate.mjs';
import {
  currentDisplayRefreshRate,
  display,
} from '../nativescript/providers/android/display.ts';
import type { AndroidApp } from '../nativescript/providers/android/runtime.ts';

let surface: Canvas;
let tvSurface = false;
let webgl2 = true;
const glOptions = { threaded: true, desynchronized: false };

/** NativeScript's application object, as the Android providers read it. */
const androidApp = (): AndroidApp | undefined =>
  Application.android as unknown as AndroidApp | undefined;

/** The default display's current refresh rate, or 0 when there is none yet. */
const refreshRate = (): number => {
  const app = androidApp();
  if (app === undefined) return 0;
  try {
    return currentDisplayRefreshRate(app);
  } catch {
    return 0;
  }
};

/** The root uses the native view; probes and SVG rasterization get private canvases. */
export class AndroidPlatform extends TvPlatform {
  override present(): void {
    // Android presents the native surface after each frame.
  }
  /**
   * The panel's frame period (1000 / refresh rate): the uncapped loop's
   * nominal step after a wake, so a 120 Hz panel steps 8.33 ms there, not
   * the web's 16.67. 0 while there is no activity to ask.
   */
  override framePeriod(): number {
    const rate = refreshRate();
    return rate > 0 ? 1000 / rate : 0;
  }

  /** The display service's mode-change listener, for the nominal period. */
  override onFramePeriodChange(listener: (period: number) => void): () => void {
    const app = androidApp();
    if (app === undefined) return () => {};
    try {
      return (
        display(app).subscribe?.((info) => {
          if (info.refreshRate > 0) listener(1000 / info.refreshRate);
        }) ?? (() => {})
      );
    } catch {
      return () => {};
    }
  }
  override async fetch(url: string, type: any): Promise<unknown> {
    // Query strings distinguish renderer cache entries, not files in the APK.
    if (!/^https?:/.test(url))
      return super.fetch(
        url.startsWith('file:') ? url.split(/[?#]/)[0]! : url,
        type,
      );
    const response = await Http.request({ url, method: 'GET', timeout: 20000 });
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw new Error(
        `Image/data request failed (HTTP ${response.statusCode})`,
      );
    if (!response.content) throw new Error('Image/data response has no body');
    if (type === 'json') return response.content.toJSON();
    const bytes = httpArrayBuffer(response.content);
    if (type === 'arraybuffer') return bytes;
    return new Blob([bytes], {
      type: String(
        response.headers['Content-Type'] ||
          response.headers['content-type'] ||
          'application/octet-stream',
      ),
    });
  }
  override resolveSettings(
    settings: Partial<RendererMainSettings>,
  ): Partial<RendererMainSettings> {
    return {
      ...super.resolveSettings(settings),
      ...(tvSurface && settings.devicePhysicalPixelRatio === undefined
        ? {
            devicePhysicalPixelRatio: tvBackingScale(
              surface.android?.getWidth(),
              surface.android?.getHeight(),
              settings.appWidth,
              settings.appHeight,
              settings.deviceLogicalPixelRatio,
            ),
          }
        : {}),
      canvas: surface as any,
      forceWebGL2: webgl2,
    };
  }

  override createCanvas(): HTMLCanvasElement {
    return document.createElement('canvas');
  }

  override createImage(): HTMLImageElement {
    const image = super.createImage();
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(image),
      'src',
    )!;
    let objectURL: string | undefined;
    Object.defineProperty(image, 'src', {
      configurable: true,
      get() {
        return descriptor.get!.call(image);
      },
      set(value: string) {
        if (objectURL) URL.revokeObjectURL(objectURL);
        if (value.startsWith('file:')) value = value.split(/[?#]/)[0]!;
        const local = value.startsWith('file:///app/')
          ? knownFolders.currentApp().path + value.slice('file:///app'.length)
          : value.startsWith('file://')
            ? value.slice(7)
            : value;
        if (local.startsWith('/') && /\.svg$/i.test(local)) {
          let xml = File.fromPath(local).readTextSync();
          // The native decoder rasterizes at intrinsic size, before the renderer scales it.
          if (!/<svg[^>]*\bwidth=/.test(xml))
            xml = xml.replace(/<svg\b/, '<svg width="512" height="512"');
          objectURL = URL.createObjectURL(
            new Blob([xml], { type: 'image/svg+xml' }),
          );
          descriptor.set!.call(image, objectURL);
        } else {
          descriptor.set!.call(image, local);
        }
      },
    });
    image.addEventListener('load', () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = undefined;
    });
    image.addEventListener('error', () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = undefined;
    });
    return image;
  }
}

export function bindAndroidCanvas(canvas: Canvas, isTV = false) {
  tvSurface = isTV;
  surface = canvas;
  const selected = createNativeContext(canvas, glOptions);
  webgl2 = selected.webgl2;
  setDefaultPlatform(AndroidPlatform);
  // Ask for the panel's highest mode and follow it until unbound. Without
  // the request Android keeps the window at the display's default (60 Hz)
  // mode even on a 120 Hz panel.
  return bindDisplayRefreshRate(canvas);
}
