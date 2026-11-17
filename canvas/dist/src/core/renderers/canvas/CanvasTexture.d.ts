import { type IParsedColor } from '../../lib/colorParser.js';
import { CoreContextTexture } from '../CoreContextTexture.js';
export declare class CanvasTexture extends CoreContextTexture {
    protected image: ImageBitmap | HTMLCanvasElement | HTMLImageElement | undefined;
    protected tintCache: {
        key: string;
        image: HTMLCanvasElement;
    } | undefined;
    load(): void;
    release(): void;
    free(): void;
    updateMemSize(): void;
    hasImage(): boolean;
    getImage(color: IParsedColor): ImageBitmap | HTMLCanvasElement | HTMLImageElement | null;
    protected tintTexture(source: ImageBitmap | HTMLCanvasElement | HTMLImageElement, color: string): HTMLCanvasElement;
    private onLoadRequest;
}
