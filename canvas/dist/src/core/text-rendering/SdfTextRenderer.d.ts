import type { Stage } from '../Stage.js';
import type { FontHandler, TextRenderInfo, TextRenderProps } from './TextRenderer.js';
import type { CoreTextNodeProps } from '../CoreTextNode.js';
import type { CoreRenderer } from '../renderers/CoreRenderer.js';
import { type TextLayout } from './TextRenderer.js';
/**
 * SDF Text Renderer - implements TextRenderer interface
 */
declare const SdfTextRenderer: {
    type: "sdf";
    font: FontHandler;
    renderText: (props: CoreTextNodeProps) => TextRenderInfo;
    renderQuads: (renderer: CoreRenderer, layout: TextLayout, _vertexBuffer: Float32Array, renderProps: TextRenderProps) => null;
    init: (stage: Stage) => void;
    cleanup: () => void;
};
export default SdfTextRenderer;
