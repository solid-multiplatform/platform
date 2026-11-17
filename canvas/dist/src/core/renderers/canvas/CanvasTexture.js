import { assertTruthy } from '../../../utils.js';
import { formatRgba } from '../../lib/colorParser.js';
import { CoreContextTexture } from '../CoreContextTexture.js';
import { closeImageBitmap } from '../../textures/Texture.js';
export class CanvasTexture extends CoreContextTexture {
    image;
    tintCache;
    load() {
        const textureData = this.textureSource.textureData;
        this.textureSource.setState('loading');
        try {
            // Inside the try on purpose: `assertTruthy` throws in dev and is a no-op
            // in prod, so asserting outside would make `load` throw on one build and
            // silently continue on the other. Here both end on the same failed state.
            assertTruthy(textureData?.data, 'Texture data is null before load');
            const size = this.onLoadRequest(textureData.data);
            // `updateMemSize` below can drive the memory manager to free this very
            // texture, and `onLoadRequest` can too, so the freed check stays even
            // though nothing is awaited.
            if (this.textureSource.state === 'freed') {
                this.image = undefined;
                return;
            }
            // Detach rather than free: `onLoadRequest` retained the bitmap as
            // `this.image` and every frame draws from it, so closing it here would
            // make later drawImage calls throw. `release` closes it instead.
            this.textureSource.setState('loaded', size);
            this.textureSource.detachTextureData();
            this.updateMemSize();
        }
        catch (err) {
            this.textureSource.setState('failed', err);
            this.textureSource.freeTextureData();
            // Not re-thrown: `load` runs inside the frame, so callers read `state`
            // rather than having a texture failure unwind a frame.
        }
    }
    release() {
        // This backend took ownership of the bitmap at load (see `load`), so it
        // closes it here to release the native pixel memory deterministically.
        closeImageBitmap(this.image);
        this.image = undefined;
        this.tintCache = undefined;
    }
    free() {
        this.release();
        this.textureSource.setState('freed');
        this.setTextureMemUse(0);
        this.textureSource.freeTextureData();
    }
    updateMemSize() {
        // Counting memory usage for:
        // - main image
        // - tinted image
        const mult = this.tintCache ? 8 : 4;
        if (this.textureSource.dimensions) {
            this.setTextureMemUse(this.textureSource.dimensions.w *
                this.textureSource.dimensions.h *
                mult);
        }
    }
    hasImage() {
        return this.image !== undefined;
    }
    getImage(color) {
        const image = this.image;
        if (image === undefined) {
            return null;
        }
        if (color.isWhite) {
            if (this.tintCache) {
                this.tintCache = undefined;
                this.updateMemSize();
            }
            return image;
        }
        const key = formatRgba(color);
        if (this.tintCache?.key === key) {
            return this.tintCache.image;
        }
        const tintedImage = this.tintTexture(image, key);
        this.tintCache = {
            key,
            image: tintedImage,
        };
        this.updateMemSize();
        return tintedImage;
    }
    tintTexture(source, color) {
        const { width, height } = source;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            // fill with target color
            ctx.fillStyle = color;
            ctx.globalCompositeOperation = 'copy';
            ctx.fillRect(0, 0, width, height);
            // multiply with image, resulting in non-transparent tinted image
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
            // apply original image alpha
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
        }
        return canvas;
    }
    onLoadRequest(data) {
        if (data === null) {
            throw new Error('CanvasTexture: Texture data is null');
        }
        // CompressedData objects (KTX, PVR, ASTC) carry GPU-format mipmap buffers
        // that cannot be decoded by Canvas2D. Reject explicitly rather than falling
        // through silently and leaving this.image unassigned.
        if (typeof data === 'object' && 'mipmaps' in data) {
            throw new Error('CanvasTexture: Compressed texture data is not supported in Canvas2D render mode');
        }
        // TODO: canvas from text renderer should be able to provide the canvas directly
        // instead of having to re-draw it into a new canvas...
        if (data instanceof ImageData) {
            const canvas = document.createElement('canvas');
            canvas.width = data.width;
            canvas.height = data.height;
            const ctx = canvas.getContext('2d');
            if (ctx !== null)
                ctx.putImageData(data, 0, 0);
            this.image = canvas;
            return { w: data.width, h: data.height };
        }
        else if ((typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) ||
            data instanceof HTMLImageElement) {
            this.image = data;
            return { w: data.width, h: data.height };
        }
        return { w: 0, h: 0 };
    }
}
//# sourceMappingURL=CanvasTexture.js.map