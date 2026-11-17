import { Platform } from '../Platform.js';
import type { Stage } from '../../Stage.js';
export declare class WebPlatform extends Platform {
    createCanvas(): HTMLCanvasElement;
    getElementById(id: string): HTMLElement | null;
    sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, logicalWidth: number, logicalHeight: number): void;
    startLoop(stage: Stage): void;
    createImageBitmap(blob: ImageBitmapSource, sxOrOptions?: number | ImageBitmapOptions, sy?: number, sw?: number, sh?: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;
    getTimeStamp(): number;
    addFont(font: FontFace): void;
}
