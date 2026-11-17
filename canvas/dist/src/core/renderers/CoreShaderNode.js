import { UpdateType } from '../CoreNode.js';
export function isAdvancedShaderProp(obj) {
    return obj !== null && typeof obj === 'object' && obj.default !== undefined;
}
export function resolveShaderProps(props, propsConfig) {
    for (const key in propsConfig) {
        if (!isAdvancedShaderProp(propsConfig[key]) && props[key] === undefined) {
            props[key] = propsConfig[key];
            continue;
        }
        const pConfig = propsConfig[key];
        const hasValue = props[key] !== undefined;
        if (pConfig.resolve !== undefined) {
            props[key] = pConfig.resolve(props[key], props);
            continue;
        }
        if (hasValue && pConfig.set !== undefined) {
            pConfig.set(props[key], props);
            continue;
        }
        if (hasValue) {
            continue;
        }
        if (props[key] === undefined && pConfig.get === undefined) {
            /**
             * Array defaults are copied so per-node writes (advanced `set` props
             * mutate the resolved array in place) never reach the shader type's
             * module-level literal, which every node of that type shares.
             */
            const def = pConfig.default;
            props[key] = Array.isArray(def) === true ? def.slice() : def;
            continue;
        }
        props[key] = pConfig.get(props);
    }
}
/**
 * CoreShaderNode is a base class that manages the shader prop values.
 * When a prop is being updated the CoreShaderNode will notify either the associated CoreNode,
 * or the Stage that there has been a change and a new render of the scene.
 */
export class CoreShaderNode {
    shaderKey;
    stage;
    shaderType;
    propsConfig;
    resolvedProps = undefined;
    definedProps = undefined;
    node = null;
    time = undefined;
    update = undefined;
    updater = undefined;
    /**
     * The shader-value cache key currently held by this node (set by the
     * subclass `update()` after the most recent successful value resolution).
     * Tracked on the base so {@link detachNode} can release it on teardown.
     */
    valueKey = '';
    _valueKeyCache = '';
    _valueKeyDirty = true;
    _lastW = 0;
    _lastH = 0;
    constructor(shaderKey, type, stage, props) {
        this.shaderKey = shaderKey;
        this.stage = stage;
        this.shaderType = type;
        this.time = type.time;
        if (props !== undefined) {
            /**
             * props are already resolved by shadermanager
             */
            this.resolvedProps = props;
            this.defineProps(props);
        }
    }
    defineProps(props) {
        const definedProps = {};
        for (const key in props) {
            const propConfig = this.shaderType.props[key];
            const isAdvancedProp = isAdvancedShaderProp(propConfig);
            Object.defineProperty(definedProps, key, {
                get: () => {
                    return this.resolvedProps[key];
                },
                set: (value) => {
                    // this.resolvedProps![key as keyof Props] = value;
                    if (isAdvancedProp === true && propConfig.resolve !== undefined) {
                        this.resolvedProps[key] = propConfig.resolve(value, this.resolvedProps);
                    }
                    else if (isAdvancedProp === true && propConfig.set !== undefined) {
                        propConfig.set(value, this.resolvedProps);
                    }
                    else {
                        this.resolvedProps[key] = value;
                    }
                    this._valueKeyDirty = true;
                    if (this.update !== undefined && this.node !== null) {
                        this.node.setUpdateType(UpdateType.RecalcUniforms);
                    }
                    else {
                        this.stage.requestRender();
                    }
                },
            });
        }
        this.definedProps = definedProps;
    }
    attachNode(node) {
        this.node = node;
    }
    /**
     * Install the value-key cached `update()` for a shader type that has an
     * updater. The updater only runs for a value key not seen before; nodes with
     * equal keys share the resulting values object by reference (the WebGL
     * batcher relies on that — see WebGlShaderProgram.bindRenderOp). Without
     * props there is no key to cache on, so the updater runs on every update.
     *
     * Called by the backend subclass, whose {@link resetValues} and
     * {@link adoptValues} manage its values object (WebGL: `uniforms`,
     * Canvas: `computed`).
     */
    installUpdater(updater) {
        this.updater = updater;
        if (this.props === undefined) {
            this.update = () => {
                this.updater(this.node);
            };
            return;
        }
        this.update = () => {
            const prevKey = this.valueKey;
            const key = (this.valueKey = this.createValueKey());
            if (prevKey === key) {
                return;
            }
            const shManager = this.stage.shManager;
            if (prevKey.length > 0) {
                shManager.mutateShaderValueUsage(prevKey, -1);
            }
            const cached = shManager.getShaderValues(key);
            if (cached !== undefined) {
                this.adoptValues(cached);
                return;
            }
            const values = this.resetValues();
            this.updater(this.node);
            shManager.setShaderValues(key, values);
        };
    }
    /**
     * Replace the backend's values object with a fresh, empty one for the
     * updater to fill, and return it.
     */
    resetValues() {
        return {};
    }
    /** Take a cached values object shared by nodes with the same value key. */
    adoptValues(_values) {
        // no-op
    }
    /**
     * Release this node's currently-held shader-value cache entry so the shader
     * manager's idle `cleanup()` can reclaim it, and detach from the owning node.
     *
     * Called from {@link CoreNode.destroy}. Mirrors the `prevKey` release done on
     * every value-key change in the subclass `update()`; without it a destroyed
     * node's last value-cache entry stays pinned at usage >= 1 forever and can
     * never be evicted.
     */
    detachNode() {
        if (this.valueKey.length > 0) {
            this.stage.shManager.mutateShaderValueUsage(this.valueKey, -1);
            this.valueKey = '';
        }
        this.node = null;
    }
    createValueKey() {
        if (this._valueKeyDirty === false &&
            this.node !== null &&
            this.node.w === this._lastW &&
            this.node.h === this._lastH) {
            return this._valueKeyCache;
        }
        let valueKey = '';
        for (const key in this.resolvedProps) {
            valueKey += `${key}:${this.resolvedProps[key]};`;
        }
        valueKey += `node-width:${this.node.w}`;
        valueKey += `node-height:${this.node.h}`;
        this._valueKeyCache = valueKey;
        this._valueKeyDirty = false;
        this._lastW = this.node.w;
        this._lastH = this.node.h;
        return valueKey;
    }
    get props() {
        return this.definedProps;
    }
    set props(props) {
        if (props === undefined) {
            return;
        }
        for (const key in props) {
            this.props[key] = props[key];
        }
    }
}
//# sourceMappingURL=CoreShaderNode.js.map