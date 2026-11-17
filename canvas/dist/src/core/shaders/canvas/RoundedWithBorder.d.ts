import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import { type BorderGeometry } from '../borderGeometry.js';
import { type RoundedWithBorderProps } from '../templates/RoundedWithBorderTemplate.js';
import type { ComputedRoundedValues } from './Rounded.js';
export type ComputedRoundedWithBorderValues = ComputedRoundedValues & {
    borderColor: string;
    border: BorderGeometry;
};
export declare const RoundedWithBorder: CanvasShaderType<RoundedWithBorderProps, ComputedRoundedWithBorderValues>;
