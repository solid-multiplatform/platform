import { type CoreNode } from '../CoreNode.js';
import type { Stage } from '../Stage.js';
export interface AdvShaderProp<T = any, Props = Record<string, unknown>> {
    /**
     * default value
     */
    default: T;
    resolve?: (this: AdvShaderProp<T, Props>, value: T, props: Props) => T;
    transform?: (start: T, end: T, progress: number) => T;
}
export type AdvancedShaderProp<T = any, Props = Record<string, unknown>> = (AdvShaderProp<T, Props> & {
    set: (value: T, props: Props) => void;
    get: (props: Props) => T;
}) | (AdvShaderProp<T, Props> & {
    set?: never;
    get?: never;
});
export type ShaderProp<T, Props> = T | AdvancedShaderProp<T, Props>;
export type ShaderProps<Props> = {
    [K in keyof Props]: ShaderProp<Props[K], Props>;
};
export declare function isAdvancedShaderProp(obj: any): obj is AdvancedShaderProp;
export declare function resolveShaderProps(props: Record<string, unknown>, propsConfig: ShaderProps<Record<string, unknown>>): void;
/**
 * CoreShaderType is a template for ShaderTypes the renderer.
 * You could view a ShaderType as a configuration object that contains methods,
 * and values that you can use to alter the way a node is drawn by the Renderer.
 */
export interface CoreShaderType<Props extends object = any> {
    /**
     * Values you use to draw the Shader
     */
    props?: ShaderProps<Props>;
    /**
     * used for making a cache key to check for reusability, currently only used for webgl ShaderTypes but might be needed for other types of renderer
     */
    getCacheMarkers?: (props: Props) => string;
    /**
     * timer that updates every loop, by default uses the stage elapsed time If you want to do a special calculation you can define a function.
     * When you calculate your own value you can use the Stage timing values deltaTime, lastFrameTime, and currentFrameTime;
     * the function also receives the node's resolved shader props. The value
     * reaches the shader as `u_time`, which is binary16 in a Mali-400 fragment
     * shader: return something small (e.g. a cycle position in [0, 1)) rather
     * than a millisecond clock, which overflows 65504 after about a minute.
     */
    time?: boolean | ((stage: Stage, props: Props) => number);
}
/**
 * CoreShaderNode is a base class that manages the shader prop values.
 * When a prop is being updated the CoreShaderNode will notify either the associated CoreNode,
 * or the Stage that there has been a change and a new render of the scene.
 */
export declare class CoreShaderNode<Props extends object = Record<string, unknown>> {
    readonly shaderKey: string;
    readonly stage: Stage;
    readonly shaderType: CoreShaderType<Props>;
    protected propsConfig: ShaderProps<Props> | undefined;
    readonly resolvedProps: Props | undefined;
    protected definedProps: Props | undefined;
    protected node: CoreNode | null;
    readonly time: CoreShaderType['time'];
    update: (() => void) | undefined;
    private updater;
    /**
     * The shader-value cache key currently held by this node (set by the
     * subclass `update()` after the most recent successful value resolution).
     * Tracked on the base so {@link detachNode} can release it on teardown.
     */
    valueKey: string;
    private _valueKeyCache;
    private _valueKeyDirty;
    private _lastW;
    private _lastH;
    constructor(shaderKey: string, type: CoreShaderType<Props>, stage: Stage, props?: Props);
    private defineProps;
    attachNode(node: CoreNode): void;
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
    protected installUpdater(updater: (node: CoreNode) => void): void;
    /**
     * Replace the backend's values object with a fresh, empty one for the
     * updater to fill, and return it.
     */
    protected resetValues(): Record<string, unknown>;
    /** Take a cached values object shared by nodes with the same value key. */
    protected adoptValues(_values: Record<string, unknown>): void;
    /**
     * Release this node's currently-held shader-value cache entry so the shader
     * manager's idle `cleanup()` can reclaim it, and detach from the owning node.
     *
     * Called from {@link CoreNode.destroy}. Mirrors the `prevKey` release done on
     * every value-key change in the subclass `update()`; without it a destroyed
     * node's last value-cache entry stays pinned at usage >= 1 forever and can
     * never be evicted.
     */
    detachNode(): void;
    createValueKey(): string;
    get props(): Props | undefined;
    set props(props: Props | undefined);
}
