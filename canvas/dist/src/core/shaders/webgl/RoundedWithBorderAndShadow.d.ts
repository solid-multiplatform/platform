import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { type RoundedWithBorderAndShadowProps } from '../templates/RoundedWithBorderAndShadowTemplate.js';
/**
 * Rows of the packed `uniform vec4 u_params[12]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export declare const RoundedWithBorderAndShadowParams: {
    readonly U_BORDER_COLOR: 0;
    readonly U_SHADOW_COLOR: 1;
    readonly U_SHADOW_RAMP: 2;
    readonly U_RADIUS: 3;
    readonly U_NODE: 4;
    readonly U_OUTER_BOX: 5;
    readonly U_INNER_BOX: 6;
    readonly U_OUTER_RADIUS: 7;
    readonly U_INNER_RADIUS: 8;
    readonly U_SHADOW_BOX: 9;
    readonly U_SHADOW_RADIUS: 10;
    readonly U_GROW: 11;
};
export declare const RoundedWithBorderAndShadow: WebGlShaderType<RoundedWithBorderAndShadowProps>;
