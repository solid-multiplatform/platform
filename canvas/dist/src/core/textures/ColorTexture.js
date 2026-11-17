import { Texture, TextureType } from './Texture.js';
/**
 * Texture consisting of only a 1x1 color pixel
 *
 * @remarks
 * The pixel color is set with the {@link ColorTextureProps.color} prop.
 *
 * This is the default texture used for a Node if it's
 * {@link INodeProps.texture} prop is set to `null` (the default)
 *
 * Generally the 1x1 color pixel is stretched to whatever the set dimensions of
 * a Node are.
 */
export class ColorTexture extends Texture {
    type = TextureType.color;
    props;
    constructor(txManager, props) {
        super(txManager);
        this.props = props;
    }
    get color() {
        return this.props.color;
    }
    set color(color) {
        this.props.color = color;
    }
    /**
     * Build the 1x1 pixel synchronously.
     *
     * @remarks
     * A ColorTexture's bytes come out of nothing, so no part of its source is
     * genuinely async. The Stage uses this directly to load the default texture
     * synchronously during construction; the regular async load path wraps it
     * via {@link getTextureSource}.
     */
    buildTextureData() {
        const pixelData = new Uint8Array(4);
        if (this.color === 0xffffffff) {
            pixelData[0] = 255;
            pixelData[1] = 255;
            pixelData[2] = 255;
            pixelData[3] = 255;
        }
        else {
            pixelData[0] = (this.color >> 16) & 0xff; // Red
            pixelData[1] = (this.color >> 8) & 0xff; // Green
            pixelData[2] = this.color & 0xff; // Blue
            pixelData[3] = (this.color >>> 24) & 0xff; // Alpha
        }
        this.setState('fetched', { w: 1, h: 1 });
        return {
            data: pixelData,
            premultiplyAlpha: true,
        };
    }
    async getTextureSource() {
        return this.buildTextureData();
    }
    static makeCacheKey(props) {
        // Mirror the default from resolveDefaults so the key is stable whether
        // or not the caller has run defaults first.
        return `ColorTexture,${props.color || 0xffffffff}`;
    }
    static resolveDefaults(props) {
        return {
            color: props.color || 0xffffffff,
        };
    }
    static z$__type__Props;
}
//# sourceMappingURL=ColorTexture.js.map