import { EventEmitter } from '../../common/EventEmitter.js';
/**
 * Close an ImageBitmap payload to release its native pixel memory now instead
 * of at some future GC. Safe to call with any `TextureData['data']` variant —
 * non-bitmap payloads are ignored. `close()` on an already-closed bitmap is a
 * spec-level no-op, so double-free across paths is harmless. The `close`
 * feature check guards embedded browsers that ship ImageBitmap without it.
 */
export const closeImageBitmap = (data) => {
    if (typeof ImageBitmap !== 'undefined' &&
        data instanceof ImageBitmap &&
        typeof data.close === 'function') {
        data.close();
    }
};
export var TextureType;
(function (TextureType) {
    TextureType[TextureType["generic"] = 0] = "generic";
    TextureType[TextureType["color"] = 1] = "color";
    TextureType[TextureType["image"] = 2] = "image";
    TextureType[TextureType["noise"] = 3] = "noise";
    TextureType[TextureType["subTexture"] = 4] = "subTexture";
})(TextureType || (TextureType = {}));
/**
 * Represents a source of texture data for a CoreContextTexture.
 *
 * @remarks
 * Texture sources are used to populate a CoreContextTexture when that texture
 * is loaded. Texture data retrieved by the CoreContextTexture by the
 * `getTextureData` method. It's the responsibility of the concerete `Texture`
 * subclass to implement this method appropriately.
 */
export class Texture extends EventEmitter {
    txManager;
    /**
     * The dimensions of the texture
     *
     * @remarks
     * Until the texture data is loaded for the first time the value will be
     * `null`.
     */
    _dimensions = null;
    _error = null;
    // aggregate state
    state = 'initial';
    renderableOwners = new Set();
    renderable = false;
    type = TextureType.generic;
    preventCleanup = false;
    ctxTexture;
    textureData = null;
    /**
     * Cache key under which this texture is registered in the
     * {@link CoreTextureManager} keyCache, or `null` if the texture is
     * not cached. Owned by the texture manager.
     */
    cacheKey = null;
    memUsed = 0;
    /**
     * Memory used by this texture in bytes
     *
     * @remarks
     * This is tracked by the TextureMemoryManager and updated when the texture
     * is loaded/freed. Set to 0 when texture is not loaded.
     */
    retryCount = 0;
    maxRetryCount;
    /**
     * Timestamp when texture was created (for startup grace period)
     */
    createdAt = Date.now();
    /**
     * Flag to track if grace period has expired to avoid repeated Date.now() calls
     */
    gracePeriodExpired = false;
    /**
     * Grace period in milliseconds to prevent premature cleanup during app startup
     * This helps prevent race conditions when bounds calculation is delayed
     */
    static STARTUP_GRACE_PERIOD = 2000; // 2 seconds
    constructor(txManager) {
        super();
        this.txManager = txManager;
        this.maxRetryCount = this.txManager.maxRetryCount;
    }
    get dimensions() {
        return this._dimensions;
    }
    get error() {
        return this._error;
    }
    /**
     * Checks if the texture is within the startup grace period.
     * During this period, textures are protected from cleanup to prevent
     * race conditions during app initialization.
     */
    isWithinStartupGracePeriod() {
        // If grace period already expired, return false immediately
        if (this.gracePeriodExpired === true) {
            return false;
        }
        // Check if grace period has expired now
        const hasExpired = Date.now() - this.createdAt >= Texture.STARTUP_GRACE_PERIOD;
        if (hasExpired) {
            // Cache the result to avoid future Date.now() calls
            this.gracePeriodExpired = true;
            return false;
        }
        return true;
    }
    /**
     * Checks if the texture can be safely cleaned up.
     * Considers the renderable state, startup grace period, and renderable owners.
     */
    canBeCleanedUp() {
        // Never cleanup if explicitly prevented
        if (this.preventCleanup) {
            return false;
        }
        // Don't cleanup if still within startup grace period
        if (this.isWithinStartupGracePeriod()) {
            return false;
        }
        // Don't cleanup a texture that is in the process of loading
        if (this.state === 'loading') {
            return false;
        }
        // Don't cleanup if not renderable
        if (this.renderable === true) {
            return false;
        }
        // Don't cleanup if there are still renderable owners
        if (this.renderableOwners.size > 0) {
            return false;
        }
        // Safe to cleanup
        return true;
    }
    /**
     * Add/remove an owner to/from the Texture based on its renderability.
     *
     * @remarks
     * Any object can own a texture, be it a CoreNode or even the state object
     * from a Text Renderer.
     *
     * When the reference to the texture that an owner object holds is replaced
     * or cleared it must call this with `renderable=false` to release the owner
     * association.
     *
     * @param owner
     * @param renderable
     */
    setRenderableOwner(owner, renderable) {
        const owners = this.renderableOwners;
        if (renderable === true) {
            if (owners.has(owner) === true) {
                return;
            }
            owners.add(owner);
            if (owners.size === 1) {
                this.renderable = true;
                this.onChangeIsRenderable?.(true);
                this.load();
            }
        }
        else {
            if (owners.delete(owner) === false) {
                return;
            }
            if (owners.size === 0) {
                this.renderable = false;
                this.onChangeIsRenderable?.(false);
                // note, not doing a cleanup here, cleanup is managed by the Stage/TextureMemoryManager
                // when it deems appropriate based on memory pressure
            }
        }
    }
    load() {
        if (this.retryCount > this.maxRetryCount) {
            // We've exceeded the max retry count, do not attempt to load again
            return;
        }
        this.txManager.loadTexture(this);
    }
    /**
     * Load the core context texture for this Texture.
     * The ctxTexture is created by the renderer and lives on the GPU.
     *
     * @returns
     */
    loadCtxTexture() {
        if (this.ctxTexture === undefined) {
            this.ctxTexture = this.txManager.renderer.createCtxTexture(this);
        }
        return this.ctxTexture;
    }
    /**
     * Free the core context texture for this Texture.
     *
     * @remarks
     * The ctxTexture is created by the renderer and lives on the GPU.
     */
    free() {
        this.ctxTexture?.free();
        // Null out the freed ctxTexture so a subsequent reload re-creates it via
        // getCtxTexture() instead of reusing a stale, already-freed reference.
        this.ctxTexture = undefined;
    }
    /**
     * Release the texture data and core context texture for this Texture without changing state.
     *
     * @remarks
     * The ctxTexture is created by the renderer and lives on the GPU.
     */
    release() {
        this.ctxTexture?.release();
        this.ctxTexture = undefined;
        this.freeTextureData();
    }
    /**
     * Destroy the texture.
     *
     * @remarks
     * This method is called when the texture is no longer needed and should be
     * cleaned up.
     */
    destroy() {
        // Only free GPU resources if we're in a state where they exist
        if (this.state === 'loaded') {
            this.free();
        }
        // Always free texture data regardless of state
        this.freeTextureData();
        // Drop any remaining subscribers so a texture destroyed while something
        // still holds a listener does not retain it (and its captures).
        this.removeAllListeners();
    }
    /**
     * Free the source texture data for this Texture.
     *
     * @remarks
     * The texture data is the source data that is used to populate the CoreContextTexture.
     * e.g. ImageData that is downloaded from a URL.
     *
     * An ImageBitmap payload is explicitly `close()`d: its pixels live in
     * browser-managed native memory, not the JS heap, so dropping the reference
     * alone leaves reclamation to a GC that may not run for a long time on an
     * idle TV app. Callers that retain the bitmap beyond `textureData` (the
     * Canvas2D backend keeps it as its render source) must use
     * {@link detachTextureData} instead.
     */
    freeTextureData() {
        queueMicrotask(this.freeTextureDataTask);
    }
    /**
     * Drop the `textureData` reference without closing an ImageBitmap payload.
     *
     * @remarks
     * For callers that have taken ownership of the underlying bitmap and keep
     * rendering from it (CanvasTexture holds it as `image`). The new owner is
     * responsible for closing it when it releases it.
     */
    detachTextureData() {
        queueMicrotask(this.detachTextureDataTask);
    }
    setState(state, errorOrDimensions) {
        if (this.state === state) {
            return;
        }
        let payload = null;
        if (state === 'loaded') {
            if (errorOrDimensions !== undefined &&
                'w' in errorOrDimensions === true &&
                'h' in errorOrDimensions === true &&
                errorOrDimensions.w !== undefined &&
                errorOrDimensions.h !== undefined) {
                this._dimensions = errorOrDimensions;
            }
            payload = this._dimensions;
        }
        else if (state === 'failed') {
            this._error = errorOrDimensions;
            payload = this._error;
            // increment the retry count for the texture
            // this is used to compare against maxRetryCount, if set
            // to determine if we should try loading again
            this.retryCount += 1;
            queueMicrotask(this.releaseTask);
        }
        else if (state === 'loading') {
            this._error = null;
            this._dimensions = null;
        }
        else {
            this._error = null;
        }
        // emit the new state
        this.state = state;
        this.emit(state, payload);
    }
    /**
     * Get the texture data for this texture.
     *
     * @remarks
     * This method is called by the CoreContextTexture when the texture is loaded.
     * The texture data is then used to populate the CoreContextTexture.
     *
     * @returns
     * The texture data for this texture.
     */
    async getTextureData() {
        if (this.textureData === null) {
            this.textureData = await this.getTextureSource();
        }
        return this.textureData;
    }
    /**
     * Task for queueMicrotask to free texture data.
     *
     * @remarks
     * This method is called in a microtask to free the texture data.
     */
    freeTextureDataTask = () => {
        const textureData = this.textureData;
        if (textureData !== null) {
            closeImageBitmap(textureData.data);
        }
        this.textureData = null;
    };
    /**
     * Task for queueMicrotask to detach texture data without closing it.
     */
    detachTextureDataTask = () => {
        this.textureData = null;
    };
    /**
     * Task for queueMicrotask to release the texture.
     *
     * @remarks
     * This method is called in a microtask to release the texture.
     */
    releaseTask = () => {
        this.release();
    };
    /**
     * Make a cache key for this texture.
     *
     * @remarks
     * Each concrete `Texture` subclass must implement this method to provide an
     * appropriate cache key for the texture type including the texture's
     * properties that uniquely identify a copy of the texture. If the texture
     * type does not support caching, then this method should return `false`.
     *
     * @param props
     * @returns
     * A cache key for this texture or `false` if the texture type does not
     * support caching.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static makeCacheKey(props) {
        return false;
    }
    /**
     * Resolve the default values for the texture's properties.
     *
     * @remarks
     * Each concrete `Texture` subclass must implement this method to provide
     * default values for the texture's optional properties.
     *
     * @param props
     * @returns
     * The default values for the texture's properties.
     */
    static resolveDefaults(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    props) {
        return {};
    }
}
//# sourceMappingURL=Texture.js.map