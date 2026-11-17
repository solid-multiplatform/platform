import { CoreContextTexture } from './CoreContextTexture.js';
export class CoreRenderer {
    options;
    mode;
    defaultTextureCoords = undefined;
    stage;
    //// Core Managers
    constructor(options) {
        this.options = options;
        this.stage = options.stage;
    }
}
//# sourceMappingURL=CoreRenderer.js.map