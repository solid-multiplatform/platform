export class CoreContextTexture {
    textureSource;
    memManager;
    state = 'freed';
    constructor(memManager, textureSource) {
        this.memManager = memManager;
        this.textureSource = textureSource;
    }
    setTextureMemUse(byteSize) {
        this.memManager.setTextureMemUse(this.textureSource, byteSize);
    }
}
//# sourceMappingURL=CoreContextTexture.js.map