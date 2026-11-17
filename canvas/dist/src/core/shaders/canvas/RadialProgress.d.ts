import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import { type RadialProgressProps } from '../templates/RadialProgressTemplate.js';
export interface ComputedRadialProgressValues {
    cx: number;
    cy: number;
    radius: number;
    colorChannels: number[][];
    trackColor: string | null;
}
export declare const RadialProgress: CanvasShaderType<RadialProgressProps, ComputedRadialProgressValues>;
