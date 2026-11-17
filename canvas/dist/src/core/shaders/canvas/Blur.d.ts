import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import { type BlurProps } from '../templates/BlurTemplate.js';
export interface ComputedBlurValues {
    filter: string;
}
/**
 * Canvas2D Blur backed by the native `ctx.filter = 'blur(Npx)'`. Browsers that
 * lack filter support (Chrome 38-52) will silently no-op — accept the
 * degradation rather than emulating a multi-pass blur in JS.
 */
export declare const Blur: CanvasShaderType<BlurProps, ComputedBlurValues>;
