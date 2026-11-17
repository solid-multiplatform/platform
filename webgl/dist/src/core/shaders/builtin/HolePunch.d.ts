import type { ShaderType } from '../ShaderType.js';
export interface HolePunchProps {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Corner radius of the hole: a number or up to four. */
    radius: number | number[];
}
/**
 * Cuts a rounded rectangle out of the node (1.10 HolePunch). Row 0: node
 * size (xy) and hole position (zw); row 1: hole half size; row 2: radius.
 * The hole takes the node's colour away by its coverage alone,
 * `color * (1 - coverage)` (as `mix`, 1.10's arithmetic), so a translucent
 * node's hole is empty; 1.10 weighted the coverage by the colour's alpha
 * again (`min(colour alpha, coverage)`), the same for opaque content.
 */
export declare const HolePunch: ShaderType<HolePunchProps>;
