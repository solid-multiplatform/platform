import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import { type BorderGeometry } from '../borderGeometry.js';
import { type BorderProps } from '../templates/BorderTemplate.js';
export interface ComputedBorderValues {
    borderColor: string;
    border: BorderGeometry;
}
export declare const Border: CanvasShaderType<BorderProps, ComputedBorderValues>;
