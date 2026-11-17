import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';
import { type PrefixedType } from '../utils.js';
export interface ShadowProps {
    /**
     * Shadow Color
     *
     * @default 0x000000ff
     */
    color: number;
    /**
     * Shadow Projection [offsetX, offsetY, blur, spread]
     *
     * @default [0, 0, 5, 5]
     */
    projection: [number, number, number, number];
    /**
     * OffsetX of Shadow (center)
     *
     * @default 0
     */
    x: number;
    /**
     * OffsetY of Shadow (center)
     *
     * @default 0
     */
    y: number;
    /**
     * Blur along the edges of the Shadow
     *
     * @default 5
     */
    blur: number;
    /**
     * Spread of the shadow compared to node
     *
     * @default 5
     */
    spread: number;
}
export declare function getShadowProps<P extends string>(prefix?: P): PrefixedType<ShadowProps, P>;
export declare const ShadowTemplate: CoreShaderType<ShadowProps>;
