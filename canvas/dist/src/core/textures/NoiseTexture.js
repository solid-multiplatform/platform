import { Texture, TextureType } from './Texture.js';
/**
 * Texture consisting of a random grid of greyscale pixels
 *
 * @remarks
 * The width and height of the NoiseTexture are defined by it's
 * {@link NoiseTextureProps.width} and {@link NoiseTextureProps.height}
 * properties. The {@link NoiseTextureProps.cacheId} prop can be varied in order
 * to bypass cache and get newly randomized texture data.
 */
export class NoiseTexture extends Texture {
    props;
    type = TextureType.noise;
    constructor(txManager, props) {
        super(txManager);
        this.props = props;
    }
    async getTextureSource() {
        const { w, h } = this.props;
        const size = w * h * 4;
        const pixelData8 = new Uint8ClampedArray(size);
        for (let i = 0; i < size; i += 4) {
            const v = Math.floor(Math.random() * 256);
            pixelData8[i] = v;
            pixelData8[i + 1] = v;
            pixelData8[i + 2] = v;
            pixelData8[i + 3] = 255;
        }
        // Noise Texture data ready - dimensions will be set during upload
        return {
            data: new ImageData(pixelData8, w, h),
        };
    }
    static makeCacheKey(props) {
        if (props.cacheId === undefined) {
            return false;
        }
        const resolvedProps = NoiseTexture.resolveDefaults(props);
        return `NoiseTexture,${resolvedProps.w},${resolvedProps.h},${resolvedProps.cacheId}`;
    }
    static resolveDefaults(props) {
        return {
            w: props.w ?? 128,
            h: props.h ?? 128,
            cacheId: props.cacheId ?? 0,
        };
    }
    static z$__type__Props;
}
//# sourceMappingURL=NoiseTexture.js.map