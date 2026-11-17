import type { Vec4 } from '../../../renderers/webgl/internal/ShaderUtils.js';
import type { BorderGeometry } from '../../borderGeometry.js';
export declare function roundRect(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, width: number, height: number, radius: Vec4): void;
export declare function roundedRectWithBorder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: Vec4, g: BorderGeometry, borderColor: string, renderContext: () => void): void;
/**
 * Fill the border band of a node: outer box minus inner box, with the given
 * corner radii (zeros for the square Border shader).
 */
export declare function fillBorder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, g: BorderGeometry, outerRadius: Vec4, innerRadius: Vec4, borderColor: string): void;
export declare function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, projection: Vec4, radius: Vec4, pixelRatio: number): void;
export declare function strokeLine(ctx: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number, lineWidth: number): void;
