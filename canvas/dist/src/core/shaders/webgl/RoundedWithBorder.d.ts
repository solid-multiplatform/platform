import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { type RoundedWithBorderProps } from '../templates/RoundedWithBorderTemplate.js';
/**
 * Rows of the packed `uniform vec4 u_params[9]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export declare const RoundedWithBorderParams: {
    readonly U_BORDER_COLOR: 0;
    readonly U_FILL_COLOR: 1;
    readonly U_RADIUS: 2;
    readonly U_NODE: 3;
    readonly U_GROW: 4;
    readonly U_OUTER_BOX: 5;
    readonly U_INNER_BOX: 6;
    readonly U_OUTER_RADIUS: 7;
    readonly U_INNER_RADIUS: 8;
};
export declare const RoundedWithBorder: WebGlShaderType<RoundedWithBorderProps>;
