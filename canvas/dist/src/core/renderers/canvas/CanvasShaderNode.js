import { normalizeCanvasColor } from '../../lib/colorCache.js';
import { CoreShaderNode } from '../CoreShaderNode.js';
export class CanvasShaderNode extends CoreShaderNode {
    computed = {};
    applySNR;
    render;
    constructor(shaderKey, config, stage, props) {
        super(shaderKey, config, stage, props);
        this.applySNR = config.saveAndRestore || false;
        this.render = config.render;
        if (config.update !== undefined) {
            this.installUpdater(config.update);
        }
    }
    resetValues() {
        const computed = {};
        this.computed = computed;
        return computed;
    }
    adoptValues(values) {
        this.computed = values;
    }
    toColorString(rgba) {
        return normalizeCanvasColor(rgba, true);
    }
}
//# sourceMappingURL=CanvasShaderNode.js.map