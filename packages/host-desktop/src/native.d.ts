// What the native runtime (packages/host-desktop/native) puts on the global
// object. Only this package reads it: apps use the platform's APIs.

/** A decoded image: 8-bit RGBA pixels, row by row from the top. */
interface SolidDecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Frees the pixels now rather than at the next collection. */
  close(): void;
}

interface SolidWindowSize {
  /** Layout units. */
  width: number;
  height: number;
  /** The drawing buffer, in pixels. */
  pixelWidth: number;
  pixelHeight: number;
}

interface SolidNative {
  /** The directory of the running script: relative asset paths start here. */
  readonly appDir: string;
  /** The window's WebGL-shaped context; absent in a run without a window. */
  readonly gl?: WebGLRenderingContext;
  readonly window?: {
    size(): SolidWindowSize;
    setSize(width: number, height: number): void;
    listen(
      listener: (
        kind: 'resize' | 'expose',
        width: number,
        height: number,
        pixelWidth: number,
        pixelHeight: number,
      ) => void,
    ): void;
  };
  readFile(
    path: string,
    done: (error: Error | null, data?: ArrayBuffer) => void,
  ): void;
  readText(
    path: string,
    done: (error: Error | null, text?: string) => void,
  ): void;
  decodeImage(
    encoded: ArrayBuffer | ArrayBufferView,
    x: number | undefined,
    y: number | undefined,
    width: number | undefined,
    height: number | undefined,
    premultiply: boolean,
    done: (error: Error | null, image?: SolidDecodedImage) => void,
  ): void;
  exit(code: number): void;
  stats(): { wakeups: number; frames: number; presents: number };
  write(stream: 1 | 2, text: string): void;
}

declare const __solid: SolidNative;
