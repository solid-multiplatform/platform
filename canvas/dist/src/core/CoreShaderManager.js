import { CoreShaderNode, resolveShaderProps, } from './renderers/CoreShaderNode.js';
export class CoreShaderManager {
    stage;
    shTypes = {};
    shCache = new Map();
    /**
     * valuesCache is used to store calculations that can be shared between shader nodes.
     */
    valuesCache = new Map();
    valuesCacheUsage = new Map();
    constructor(stage) {
        this.stage = stage;
    }
    registerShaderType(name, shType) {
        /**
         * block name duplicates
         */
        if (this.shTypes[name] !== undefined) {
            console.warn(`ShaderType already exists with the name: ${name}. Breaking off registration.`);
            return;
        }
        /**
         * Check renderer if shader type is supported.
         */
        if (this.stage.renderer.supportsShaderType(shType) === false) {
            console.warn(`The renderer being used does not support this shader type. Breaking off registration.`);
            return;
        }
        this.shTypes[name] = shType;
    }
    /**
     * Loads a shader (if not already loaded) and returns a controller for it.
     *
     * @param shType
     * @param props
     * @returns
     */
    createShader(name, props) {
        const shType = this.shTypes[name];
        if (shType === undefined) {
            console.warn(`ShaderType not found falling back on renderer default shader`);
            return this.stage.defShaderNode;
        }
        let shaderKey = name;
        if (shType.props !== undefined) {
            /**
             * if props is undefined create empty obj to fill
             */
            props = props || {};
            /**
             * resolve shader values
             */
            resolveShaderProps(props, shType.props);
            if (shType.getCacheMarkers !== undefined) {
                shaderKey += `-${shType.getCacheMarkers(props)}`;
            }
        }
        if (this.stage.renderer.mode === 'canvas') {
            return this.stage.renderer.createShaderNode(shaderKey, shType, props);
        }
        /**
         * get shaderProgram by cacheKey
         */
        let shProgram = this.shCache.get(shaderKey);
        /**
         * if shaderProgram was not found create a new one
         */
        if (shProgram === undefined) {
            try {
                shProgram = this.stage.renderer.createShaderProgram(shType, props);
                this.shCache.set(shaderKey, shProgram);
            }
            catch (e) {
                // The renderer trips `isContextLost` when shader creation fails due to
                // a lost GL context. That is unrecoverable in-place (the consumer
                // reloads on the `contextLost` event), so fall back to the default
                // shader node instead of letting the throw propagate through the app's
                // reactive layer. A genuine GLSL compile error (context not lost) is a
                // real bug and is rethrown so it surfaces loudly.
                if (this.stage.isContextLost === true) {
                    return this.stage.defShaderNode;
                }
                throw e;
            }
        }
        return this.stage.renderer.createShaderNode(shaderKey, shType, props, shProgram);
    }
    mutateShaderValueUsage(key, mutation) {
        let usage = this.valuesCacheUsage.get(key) || 0;
        this.valuesCacheUsage.set(key, usage + mutation);
    }
    getShaderValues(key) {
        const values = this.valuesCache.get(key);
        if (values === undefined) {
            return undefined;
        }
        this.mutateShaderValueUsage(key, 1);
        return values;
    }
    setShaderValues(key, values) {
        this.valuesCache.set(key, values);
        this.mutateShaderValueUsage(key, 1);
    }
    /**
     * Drop cached shader values no node holds any more. One pass, no copy:
     * deleting the current entry while iterating a Map is well defined.
     */
    cleanup() {
        const usage = this.valuesCacheUsage;
        for (const [key, count] of usage) {
            if (count <= 0) {
                usage.delete(key);
                this.valuesCache.delete(key);
            }
        }
    }
}
//# sourceMappingURL=CoreShaderManager.js.map