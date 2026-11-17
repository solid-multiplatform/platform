import type { CoreNode } from '../../CoreNode.js';
import { type Texture } from '../../textures/Texture.js';
import type { CoreContextTexture } from '../CoreContextTexture.js';
import { CoreRenderer, type CoreRendererOptions, type RendererCapabilities } from '../CoreRenderer.js';
import { CanvasShaderNode, type CanvasShaderType } from './CanvasShaderNode.js';
export declare class CanvasRenderer extends CoreRenderer {
    private context;
    private canvas;
    private readonly pixelRatio;
    private clearColor;
    private clearColorAlpha;
    private shaderContextNode;
    private shaderContextTexture;
    private shaderRenderContext;
    constructor(options: CoreRendererOptions);
    reset(): void;
    render(): void;
    addQuad(node: CoreNode, renderTexture?: Texture): void;
    renderContext(node: CoreNode, texture: Texture): void;
    /**
     * Renders a node's content (texture or color rect) into an arbitrary 2D
     * context instead of the main canvas. Used by shaders that need to
     * composite the node's content offscreen (e.g. EdgeFade alpha masks).
     *
     * The content is drawn at the node's global position — the caller is
     * responsible for setting a transform on `target` that maps it to the
     * desired location.
     */
    renderNodeContent(node: CoreNode, target: CanvasRenderingContext2D): void;
    createShaderNode(shaderKey: string, shaderType: Readonly<CanvasShaderType>, props?: Record<string, any>): CanvasShaderNode<Record<string, any>, Record<string, unknown>>;
    createShaderProgram(_shaderConfig: any): null;
    supportsShaderType(shaderType: Readonly<CanvasShaderType>): boolean;
    createCtxTexture(textureSource: Texture): CoreContextTexture;
    getBufferInfo(): null;
    getQuadCount(): null;
    getRenderOpCount(): null;
    getCapabilities(): RendererCapabilities;
    checkForOutOfMemory(): boolean;
    /**
     * Updates the clear color of the canvas renderer.
     *
     * @param color - The color to set as the clear color.
     */
    updateClearColor(color: number): void;
    getTextureCoords(node: CoreNode): import('../../textures/Texture.js').TextureCoords | undefined;
    getDefaultShaderNode(): null;
}
