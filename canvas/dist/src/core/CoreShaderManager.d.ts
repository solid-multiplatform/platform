import { CoreShaderNode, type CoreShaderType } from './renderers/CoreShaderNode.js';
import type { CoreShaderProgram } from './renderers/CoreShaderProgram.js';
import type { Stage } from './Stage.js';
export type ShaderMap = Record<string, CoreShaderType>;
export type ExtractProps<Props> = {
    [K in keyof Props]: Props[K] extends {
        default: infer D;
    } ? D : Props[K];
};
export type PartialShaderProps<Props> = Partial<ExtractProps<Props>>;
export type ExtractShaderProps<T extends keyof ShaderMap> = ExtractProps<ShaderMap[T]['props']>;
export type OptionalShaderProps<T extends keyof ShaderMap> = PartialShaderProps<ShaderMap[T]['props']>;
export declare class CoreShaderManager {
    readonly stage: Stage;
    protected shTypes: ShaderMap;
    protected shCache: Map<string, CoreShaderProgram>;
    /**
     * valuesCache is used to store calculations that can be shared between shader nodes.
     */
    protected valuesCache: Map<string, Record<string, unknown>>;
    protected valuesCacheUsage: Map<string, number>;
    constructor(stage: Stage);
    registerShaderType(name: string, shType: CoreShaderType): void;
    /**
     * Loads a shader (if not already loaded) and returns a controller for it.
     *
     * @param shType
     * @param props
     * @returns
     */
    createShader<Name extends keyof ShaderMap>(name: Name, props?: Record<string, unknown>): CoreShaderNode | null;
    mutateShaderValueUsage(key: string, mutation: number): void;
    getShaderValues(key: string): Record<string, unknown> | undefined;
    setShaderValues(key: string, values: Record<string, unknown>): void;
    /**
     * Drop cached shader values no node holds any more. One pass, no copy:
     * deleting the current entry while iterating a Map is well defined.
     */
    cleanup(): void;
}
