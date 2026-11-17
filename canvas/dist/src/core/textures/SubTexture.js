import { assertTruthy } from '../../utils.js';
import { ImageTexture } from './ImageTexture.js';
import { Texture, TextureType, } from './Texture.js';
let subTextureId = 0;
/**
 * A Texture that is a sub-region of another Texture.
 *
 * @remarks
 * The parent texture can be a Sprite Sheet/Texture Atlas and set using the
 * {@link SubTextureProps.texture} prop. The sub-region relative to the parent
 * texture is defined with the {@link SubTextureProps.x},
 * {@link SubTextureProps.y}, {@link SubTextureProps.w}, and
 * {@link SubTextureProps.h} pixel values.
 */
export class SubTexture extends Texture {
    props;
    parentTexture;
    type = TextureType.subTexture;
    subtextureId = `subtexture-${subTextureId++}`;
    constructor(txManager, props) {
        super(txManager);
        this.props = props;
        assertTruthy(this.props.texture, 'SubTexture requires a parent texture');
        assertTruthy(this.props.texture instanceof ImageTexture, 'SubTexture requires an ImageTexture parent');
        // Resolve parent texture from cache or fallback to provided texture
        this.parentTexture = txManager.resolveParentTexture(this.props.texture);
        if (this.renderableOwners.size > 0) {
            this.parentTexture.setRenderableOwner(this.subtextureId, true);
        }
        // If parent texture is already loaded / failed, trigger loaded event manually
        // so that users get a consistent event experience.
        // We do this in a microtask to allow listeners to be attached in the same
        // synchronous task after calling loadTexture()
        queueMicrotask(() => {
            const parentTx = this.parentTexture;
            if (parentTx.state === 'loaded' && parentTx.dimensions !== null) {
                this.onParentTxLoaded(parentTx, parentTx.dimensions);
            }
            else if (parentTx.state === 'loading') {
                this.onParentTxLoading();
            }
            else if (parentTx.state === 'failed' && parentTx.error !== null) {
                this.onParentTxFailed(parentTx, parentTx.error);
            }
            else if (parentTx.state === 'freed') {
                this.onParentTxFreed();
            }
            parentTx.on('loading', this.onParentTxLoading);
            parentTx.on('loaded', this.onParentTxLoaded);
            parentTx.on('failed', this.onParentTxFailed);
            parentTx.on('freed', this.onParentTxFreed);
        });
    }
    onParentTxLoaded = () => {
        // We ignore the parent's passed dimensions, and simply use the SubTexture's
        // configured dimensions (because that's all that matters here)
        this.setState('loaded', {
            w: this.props.w,
            h: this.props.h,
        });
    };
    onParentTxFailed = (target, error) => {
        this.retryCount = this.parentTexture.retryCount - 1;
        this.setState('failed', error);
    };
    onParentTxLoading = () => {
        this.setState('loading');
    };
    onParentTxFreed = () => {
        this.setState('freed');
    };
    onChangeIsRenderable(isRenderable) {
        // Propagate the renderable owner change to the parent texture
        this.parentTexture.setRenderableOwner(this.subtextureId, isRenderable);
    }
    destroy() {
        // Detach from the parent texture's event emitter. The parent is typically a
        // long-lived shared atlas (preventCleanup), so without this each destroyed
        // SubTexture — and everything its handlers capture — would be retained by
        // the parent's listener lists for the rest of the session.
        const parentTx = this.parentTexture;
        parentTx.off('loading', this.onParentTxLoading);
        parentTx.off('loaded', this.onParentTxLoaded);
        parentTx.off('failed', this.onParentTxFailed);
        parentTx.off('freed', this.onParentTxFreed);
        super.destroy();
    }
    async getTextureSource() {
        // Check if parent texture is loaded
        return new Promise((resolve, reject) => {
            resolve({
                data: this.props,
            });
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static makeCacheKey(props) {
        return false;
    }
    static resolveDefaults(props) {
        return {
            texture: props.texture,
            x: props.x || 0,
            y: props.y || 0,
            w: props.w || 0,
            h: props.h || 0,
        };
    }
    static z$__type__Props;
}
//# sourceMappingURL=SubTexture.js.map