import { type BorderProps } from '../templates/BorderTemplate.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
/**
 * Rows of the packed `uniform vec4 u_params[5]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export declare const BorderParams: {
    readonly U_BORDER_COLOR: 0;
    readonly U_NODE: 1;
    readonly U_GROW: 2;
    readonly U_OUTER_BOX: 3;
    readonly U_INNER_BOX: 4;
};
export declare const Border: WebGlShaderType<BorderProps>;
