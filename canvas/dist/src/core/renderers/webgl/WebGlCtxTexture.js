import { uploadCompressedTexture } from '../../lib/textureCompression.js';
import { CoreContextTexture } from '../CoreContextTexture.js';
import { createTextureCoords, UNIT_TEXTURE_COORDS, isHTMLImageElement, } from './internal/RendererUtils.js';
import { ENABLE_COMPRESSED_TEXTURES, isProductionEnvironment, } from '../../../utils.js';
const TRANSPARENT_TEXTURE_DATA = new Uint8Array([0, 0, 0, 0]);
/**
 * A wrapper around a WebGLTexture that handles loading the texture data
 * from a Texture source and uploading it to the GPU as well as freeing
 * the uploaded texture.
 *
 * @remarks
 * When accessing the ctxTexture property, the texture will be loaded if
 * it hasn't been already. ctxTexture will always return a valid WebGLTexture
 * and trigger the loading/uploading of the texture's data if it hasn't been
 * loaded yet.
 */
export class WebGlCtxTexture extends CoreContextTexture {
    glw;
    _nativeCtxTexture = null;
    _w = 0;
    _h = 0;
    /**
     * The texture coordinates this texture's quads sample.
     *
     * @remarks
     * Shared by reference with every other texture that uses the unit square, so
     * it is `Readonly`: a writer that needs different coordinates replaces the
     * whole object via {@link createTextureCoords} rather than mutating in place.
     */
    txCoords = UNIT_TEXTURE_COORDS;
    constructor(glw, memManager, textureSource) {
        super(memManager, textureSource);
        this.glw = glw;
    }
    /**
     * GL error check with direct state marking
     * Uses cached error result to minimize function calls
     */
    checkGLError() {
        // Skip if already failed to prevent double-processing
        if (this.state === 'failed') {
            return true;
        }
        if (isProductionEnvironment === false) {
            const error = this.glw.getError();
            if (error !== 0) {
                this.state = 'failed';
                this.textureSource.setState('failed', new Error(`WebGL Error: ${error}`));
                return true;
            }
        }
        return false;
    }
    get ctxTexture() {
        if (this.state === 'freed') {
            this.load();
            return null;
        }
        return this._nativeCtxTexture;
    }
    get w() {
        return this._w;
    }
    get h() {
        return this._h;
    }
    /**
     * Load the texture data from the Texture source and upload it to the GPU
     *
     * @remarks
     * This method is called automatically when accessing the ctxTexture property
     * if the texture hasn't been loaded yet. But it can also be called manually
     * to force the texture to be pre-loaded prior to accessing the ctxTexture
     * property.
     */
    load() {
        // If the texture is already loading or loaded, there is nothing to do.
        if (this.state === 'loading' || this.state === 'loaded') {
            return;
        }
        this.state = 'loading';
        this.textureSource.setState('loading');
        this._nativeCtxTexture = this.createNativeCtxTexture();
        if (this._nativeCtxTexture === null) {
            this.state = 'failed';
            const error = new Error('Could not create WebGL Texture');
            this.textureSource.setState('failed', error);
            console.error('Could not create WebGL Texture');
            return;
        }
        try {
            const { w, h } = this.onLoadRequest();
            // A synchronous listener fired during the upload (state emits, memory
            // accounting) can free this very texture; do not resurrect it to
            // 'loaded'. CanvasTexture.load keeps the same success-path guard.
            if (this.state === 'freed') {
                return;
            }
            this.state = 'loaded';
            this._w = w;
            this._h = h;
            // Update the texture source's width and height so that it can be used
            // for rendering.
            this.textureSource.setState('loaded', { w, h });
            // The upload is complete and bound, so the CPU-side source bytes are
            // dead weight from here on.
            this.textureSource.freeTextureData();
        }
        catch (err) {
            // `onLoadRequest` reports memory use as it uploads, which can drive the
            // memory manager to free this very texture mid-call, so the freed check
            // stays even though nothing is awaited.
            if (this.state === 'freed') {
                return;
            }
            this.state = 'failed';
            const error = err instanceof Error ? err : new Error(String(err));
            this.textureSource.setState('failed', error);
            this.textureSource.freeTextureData();
            console.error(err);
            // Deliberately not re-thrown: `load` is called from inside the frame (and
            // from the `ctxTexture` getter), so a throw here would unwind a frame
            // rather than surface a texture problem. Callers read `state` instead.
        }
    }
    /**
     * Called when the texture data needs to be loaded and uploaded to a texture
     */
    onLoadRequest() {
        const { glw } = this;
        const textureData = this.textureSource.textureData;
        if (textureData === null || this._nativeCtxTexture === null) {
            throw new Error('Texture data or native texture is null ' + this.textureSource.type);
        }
        // No placeholder upload here: every branch below fully (re)uploads the
        // texture before this method returns, and there is no `await` in between,
        // so no frame can render an intermediate 1x1. The empty-texture case
        // (`tdata === null`) does its own 1x1 upload. Uploading a throwaway 1x1
        // first would be a wasted texImage2D + setTextureMemUse per texture.
        let w = 0;
        let h = 0;
        glw.activeTexture(0);
        const tdata = textureData.data;
        const format = glw.RGBA;
        const formatBytes = 4;
        const memoryPadding = 1.1; // Add padding to account for GPU Padding
        const isImageBitmap = typeof ImageBitmap !== 'undefined' && tdata instanceof ImageBitmap;
        // If textureData is null, the texture is empty (0, 0) and we don't need to
        // upload any data to the GPU.
        if (isImageBitmap ||
            tdata instanceof ImageData ||
            // not using typeof HTMLI mageElement due to web worker
            isHTMLImageElement(tdata) === true) {
            w = tdata.width;
            h = tdata.height;
            glw.bindTexture(this._nativeCtxTexture);
            // `premultiplyAlpha` carries the source's GL-upload intent: true when the
            // source pixels are straight and WebGL must premultiply (e.g. a straight
            // bitmap produced when the device ignores the createImageBitmap
            // premultiply option), false when the source is already premultiplied.
            glw.pixelStorei(glw.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!textureData.premultiplyAlpha);
            glw.texImage2D(0, format, format, glw.UNSIGNED_BYTE, tdata);
            // Check for errors after compressed texture operations
            if (this.checkGLError() === true) {
                throw this.textureSource.error || new Error('WebGL Error');
            }
            this.setTextureMemUse(h * w * formatBytes * memoryPadding);
        }
        else if (tdata === null) {
            w = 0;
            h = 0;
            // Reset to a 1x1 transparent texture
            glw.bindTexture(this._nativeCtxTexture);
            glw.texImage2D(0, format, 1, 1, 0, format, glw.UNSIGNED_BYTE, TRANSPARENT_TEXTURE_DATA);
            this.setTextureMemUse(TRANSPARENT_TEXTURE_DATA.byteLength);
        }
        else if (ENABLE_COMPRESSED_TEXTURES &&
            'mipmaps' in tdata &&
            tdata.mipmaps) {
            const { mipmaps, type, blockInfo } = tdata;
            uploadCompressedTexture[type](glw, this._nativeCtxTexture, tdata);
            // Check for errors after compressed texture operations
            if (this.checkGLError() === true) {
                throw this.textureSource.error || new Error('WebGL Error');
            }
            w = tdata.w;
            h = tdata.h;
            // Both ratios are <= 1: the denominator rounds the dimension up to a
            // whole number of blocks.
            // Allocates rather than mutating — the default is the shared
            // UNIT_TEXTURE_COORDS and writing through it would corrupt every texture.
            this.txCoords = createTextureCoords(0, 0, w / (Math.ceil(w / blockInfo.width) * blockInfo.width), h / (Math.ceil(h / blockInfo.height) * blockInfo.height));
            this.setTextureMemUse(mipmaps[0]?.byteLength ?? 0);
        }
        else if (tdata && tdata instanceof Uint8Array) {
            // Color Texture
            w = 1;
            h = 1;
            glw.bindTexture(this._nativeCtxTexture);
            glw.pixelStorei(glw.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!textureData.premultiplyAlpha);
            glw.texImage2D(0, format, w, h, 0, format, glw.UNSIGNED_BYTE, tdata);
            // Check for errors after compressed texture operations
            if (this.checkGLError() === true) {
                throw this.textureSource.error || new Error('WebGL Error');
            }
            this.setTextureMemUse(w * h * formatBytes);
        }
        else {
            throw new Error(`WebGlCoreCtxTexture.onLoadRequest: Unexpected textureData returned`);
        }
        return {
            w,
            h,
        };
    }
    /**
     * Free the WebGLTexture from the GPU
     *
     * @returns
     */
    free() {
        if (this.state === 'freed') {
            return;
        }
        this.state = 'freed';
        this.textureSource.setState('freed');
        this.release();
    }
    /**
     * Release the WebGLTexture from the GPU without changing state
     */
    release() {
        this._w = 0;
        this._h = 0;
        if (this._nativeCtxTexture !== null) {
            this.glw.deleteTexture(this._nativeCtxTexture);
            this.setTextureMemUse(0);
            this._nativeCtxTexture = null;
        }
        // if the texture still has source data, free it
        this.textureSource.freeTextureData();
    }
    /**
     * Create native context texture asynchronously
     *
     * @remarks
     * When this method resolves, the returned texture will be bound to the GL context state
     * and fully ready for use. This ensures proper GPU resource allocation timing.
     *
     * @returns Promise that resolves to the native WebGL texture or null on failure
     */
    createNativeCtxTexture() {
        const { glw } = this;
        const nativeTexture = glw.createTexture();
        if (!nativeTexture) {
            return null;
        }
        // On initial load request, create a 1x1 transparent texture to use until
        // the texture data is finally loaded.
        glw.activeTexture(0);
        glw.bindTexture(nativeTexture);
        // linear texture filtering
        glw.texParameteri(glw.TEXTURE_MAG_FILTER, glw.LINEAR);
        glw.texParameteri(glw.TEXTURE_MIN_FILTER, glw.LINEAR);
        // texture wrapping method
        glw.texParameteri(glw.TEXTURE_WRAP_S, glw.CLAMP_TO_EDGE);
        glw.texParameteri(glw.TEXTURE_WRAP_T, glw.CLAMP_TO_EDGE);
        return nativeTexture;
    }
}
//# sourceMappingURL=WebGlCtxTexture.js.map