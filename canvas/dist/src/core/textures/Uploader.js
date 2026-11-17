import { NULL } from '../nodes/NodeFlags.js';
import { F_GL_PREMULTIPLY, closeData, } from './TextureStore.js';
import { ENABLE_COMPRESSED_TEXTURES } from '../../common/flags.js';
import { TextureError, TextureErrorCode } from './TextureError.js';
/**
 * GPU bytes of an upload, 1.10's estimate: RGBA plus 10% driver padding
 * for an image, 4 bytes a pixel for raw bytes (a ColorTexture).
 */
export function uploadBytes(data, w, h) {
    return ArrayBuffer.isView(data) === true ? w * h * 4 : w * h * 4 * 1.1;
}
/** While animating, an upload of more pixels than this waits (spec 9.4)... */
export const ANIMATING_PIXELS = 500000;
/** ...for at most this many animated frames, so a looping animation cannot starve it. */
export const ANIMATING_WAIT = 30;
/**
 * The sink's upload, apart so that no try/catch sits in `run` or its loop
 * (Crankshaft, the optimizer up to Chrome 58, gives up on a function
 * containing one): what it threw, or null. 1.10 caught an upload error per texture
 * too, rather than let it unwind the frame (a source the context refuses,
 * such as a tainted canvas).
 */
function tryUpload(sink, id, source, w, h, premultiply) {
    try {
        sink.uploadTexture(id, source, w, h, premultiply);
        return null;
    }
    catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}
/**
 * tryUpload for a compressed container: what the upload threw, an error
 * for a format the device has no extension for, or null.
 */
function tryUploadCompressed(sink, id, data) {
    let supported;
    try {
        supported = sink.uploadCompressed(id, data);
    }
    catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
    if (supported === true) {
        return null;
    }
    return new TextureError(TextureErrorCode.TEXTURE_UPLOAD_FAILED, `Compressed texture format 0x${data.glInternalFormat.toString(16)} is not supported by this device`);
}
/**
 * Uploads decoded textures after a frame's draw (spec 9.4), so the GPU
 * works through the frame's draw calls while texImage2D copies pixels, and
 * a texture uploaded in frame N draws in frame N+1. While animating: at most
 * one upload per frame, and a larger one than 0.5 M pixels waits at the back
 * of the queue (time is 1 ms granular on device; pixels are the reliable
 * budget). Otherwise: uploads until the time limit, reading the clock once
 * per upload. The Renderer runs it on a frame with nothing to draw too (an
 * animation's delay), so that a large texture's wait counts there without a
 * draw of its own.
 */
export class Uploader {
    /**
     * `requestFrame` asks for the frame that carries on with what a run left
     * (the Renderer: a frame for the uploader alone, as for a decode; an
     * upload marks its own nodes, which ask for the draw).
     */
    constructor(store, sink, now, requestFrame, memory = null) {
        /**
         * Animated frames that sent a large texture back since the last large
         * upload, or since the queue was last empty.
         */
        this.waited = 0;
        this.store = store;
        this.sink = sink;
        this.now = now;
        this.requestFrame = requestFrame;
        this.memory = memory;
        const max = sink.maxTextureSize;
        this.maxSize = max > 0 ? max : Infinity;
    }
    /**
     * doNotExceedCriticalThreshold: while critical, uploads wait (spec 9.3: a
     * deferral, not a failure) for a cleanup to make room, which asks for a
     * frame (MemoryManager): the frame's own critical cleanup, or a later
     * one should the unwanted records still be within their grace period.
     * What nobody wants any more is released meanwhile rather than held at
     * the ceiling (1.10 failed it), and the check for room comes back only
     * for a texture someone still wants.
     */
    held() {
        const memory = this.memory;
        if (memory === null || memory.blocked === false) {
            return false;
        }
        if (this.store.releaseUnwantedDecoded() > 0) {
            memory.waitForRoom();
        }
        return true;
    }
    /**
     * Upload within the frame's budget; returns how many uploads ran (a
     * texture failed for good counts as one).
     */
    run(animating, timeLimit) {
        const store = this.store;
        // Nothing decoded: no clock read (the common frame).
        if (store.decodedCount === 0) {
            return 0;
        }
        if (this.held() === true) {
            // What the hold released may have drained the queue: no wait left.
            if (store.decodedCount === 0) {
                this.waited = 0;
            }
            return 0;
        }
        let uploaded = 0;
        if (animating === true) {
            uploaded = this.runAnimating();
        }
        else {
            const start = this.now();
            for (;;) {
                if (uploaded > 0 && this.held() === true) {
                    break;
                }
                const rec = store.nextDecoded();
                if (rec === NULL) {
                    break;
                }
                this.upload(rec);
                uploaded++;
                if (this.now() - start >= timeLimit) {
                    break;
                }
            }
        }
        if (store.decodedCount === 0) {
            // Drained: a large texture dropped while it waited leaves no wait
            // for the next one to inherit.
            this.waited = 0;
        }
        else {
            // Left over: the next frame carries on (it may not otherwise come).
            this.requestFrame();
        }
        return uploaded;
    }
    /**
     * Renderer.destroy: close the decoded data no upload will take now (an
     * ImageBitmap holds native memory until it is closed).
     */
    destroy() {
        const store = this.store;
        let rec = store.nextDecoded();
        while (rec !== NULL) {
            closeData(store.data[rec]);
            store.data[rec] = null;
            rec = store.nextDecoded();
        }
    }
    /**
     * One upload at most: the first decoded texture within ANIMATING_PIXELS.
     * A larger one goes to the back of the queue, so that it holds up nothing
     * behind it; a frame that sends one back counts a wait, and after
     * ANIMATING_WAIT of them the next one goes, whatever its size.
     */
    runAnimating() {
        const store = this.store;
        const holdLarge = this.waited < ANIMATING_WAIT;
        let held = 0;
        let rec = store.peekDecoded();
        while (rec !== NULL &&
            holdLarge === true &&
            store.w[rec] * store.h[rec] > ANIMATING_PIXELS) {
            store.rotateDecoded();
            held++;
            rec = held < store.decodedCount ? store.peekDecoded() : NULL;
        }
        if (held > 0) {
            this.waited++;
        }
        if (rec === NULL) {
            return 0;
        }
        store.nextDecoded();
        this.upload(rec);
        return 1;
    }
    /**
     * Upload `rec`, or fail it for good: larger than the device takes (WebGL
     * would refuse it without an exception, and it would sample black), or
     * refused by the upload (it throws).
     */
    upload(rec) {
        const store = this.store;
        const data = store.data[rec];
        const w = store.w[rec];
        const h = store.h[rec];
        const max = this.maxSize;
        if (w > max || h > max) {
            store.uploadFailed(rec, new TextureError(TextureErrorCode.TEXTURE_UPLOAD_FAILED, `Texture ${w}x${h} exceeds the maximum texture size of this device (${max})`));
            return;
        }
        // A large upload, idle or animated, starts the next one's wait afresh.
        if (w * h > ANIMATING_PIXELS) {
            this.waited = 0;
        }
        if (ENABLE_COMPRESSED_TEXTURES === true &&
            data.mipmaps !== undefined) {
            this.uploadCompressed(rec, data);
            return;
        }
        const error = tryUpload(this.sink, rec, data, w, h, (store.flags[rec] & F_GL_PREMULTIPLY) !== 0);
        if (error !== null) {
            this.failUpload(rec, error);
            return;
        }
        store.uploaded(rec, uploadBytes(data, w, h));
        if (this.memory !== null) {
            this.memory.checkCritical();
        }
    }
    /**
     * An upload refused `rec`: it fails for good, and the GL texture the
     * upload may have created goes with it (a failed record is never freed,
     * and the next record in its slot must start from a fresh one).
     */
    failUpload(rec, error) {
        this.sink.deleteTexture(rec);
        this.store.uploadFailed(rec, error);
    }
    /**
     * A compressed container. A KTX level 0 goes up block-padded
     * (compressed.ts), so its UV rect stops short of the padding (1.10
     * txCoords); PVR and ASTC go up at their own size. 1.10 counted the first
     * level's bytes. A device with no extension for the format, or an upload
     * that throws, fails it for good.
     */
    uploadCompressed(rec, data) {
        const store = this.store;
        const error = tryUploadCompressed(this.sink, rec, data);
        if (error !== null) {
            this.failUpload(rec, error);
            return;
        }
        if (data.type === 'ktx') {
            const block = data.blockInfo;
            store.u2[rec] = data.w / (Math.ceil(data.w / block.width) * block.width);
            store.v2[rec] =
                data.h / (Math.ceil(data.h / block.height) * block.height);
        }
        store.uploaded(rec, data.mipmaps[0].byteLength);
        if (this.memory !== null) {
            this.memory.checkCritical();
        }
    }
}
//# sourceMappingURL=Uploader.js.map