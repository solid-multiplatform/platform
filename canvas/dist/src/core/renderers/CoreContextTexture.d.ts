import type { TextureMemoryManager } from '../TextureMemoryManager.js';
import type { Texture } from '../textures/Texture.js';
export declare abstract class CoreContextTexture {
    readonly textureSource: Texture;
    private memManager;
    state: 'freed' | 'loading' | 'loaded' | 'failed';
    constructor(memManager: TextureMemoryManager, textureSource: Texture);
    protected setTextureMemUse(byteSize: number): void;
    /**
     * Upload the texture to the GPU.
     *
     * @remarks
     * Synchronous by design. Every implementation's upload is straight-line GL /
     * canvas work with nothing to await, and this runs inside `drawFrame` via the
     * texture manager's per-frame budget. Returning a promise here used to push
     * the upload into a microtask continuation that drained after the frame
     * callback had already returned, which both hid the cost from the frame and
     * broke the budget in {@link CoreTextureManager.processUntil} (its clock ran
     * across the awaits rather than across the uploads).
     *
     * Never throws: a failure is recorded on `state` and on the texture source so
     * callers read it from the state machine instead of unwinding a frame.
     */
    abstract load(): void;
    abstract release(): void;
    abstract free(): void;
}
