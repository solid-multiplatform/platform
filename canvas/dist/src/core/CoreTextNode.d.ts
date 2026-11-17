import type { TextRenderer, TrProps, TextRenderInfo } from './text-rendering/TextRenderer.js';
import { CoreNode, type CoreNodeProps } from './CoreNode.js';
import type { Stage } from './Stage.js';
import type { RectWithValid } from './lib/utils.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import type { TextureLoadedEventHandler } from './textures/Texture.js';
export interface CoreTextNodeProps extends CoreNodeProps, TrProps {
    /**
     * Force Text Node to use a specific Text Renderer
     */
    textRendererOverride?: string | null;
    forceLoad: boolean;
}
export declare enum TextConstraint {
    'none' = 0,
    'width' = 1,
    'height' = 2,
    'both' = 3
}
export declare class CoreTextNode extends CoreNode implements CoreTextNodeProps {
    private textRenderer;
    private fontHandler;
    private _layoutGenerated;
    private _waitingForFont;
    private _containType;
    private _cachedLayout;
    /** Cached pre-transformed SDF vertex data — avoids per-glyph matrix math when static. */
    private _sdfCache;
    private textProps;
    private _renderInfo;
    private _type;
    constructor(stage: Stage, props: CoreTextNodeProps, textRenderer: TextRenderer);
    /**
     * Autosize is an image-only feature. A text node's `w`/`h` come from its
     * layout, and (on the canvas path) its texture is generated from that
     * layout — so sizing to the texture would be circular. The inherited
     * `onTextureLoaded` is overridden below and never calls through, so this
     * only closes the `set autosize` path.
     */
    protected applyAutosizeDimensions(): void;
    protected onTextureLoaded: TextureLoadedEventHandler;
    allowTextGeneration(): boolean;
    updateLocalTransform(): void;
    /**
     * Override CoreNode's update method to handle text-specific updates
     */
    update(delta: number, parentClippingRect: RectWithValid): void;
    /**
     * Override is renderable check for SDF text nodes
     */
    updateIsRenderable(): void;
    /**
     * Handle the result of text rendering for both Canvas and SDF renderers
     */
    private handleRenderResult;
    private emitTextLoadedEvent;
    /**
     * Override renderQuads to handle SDF vs Canvas rendering
     */
    renderQuads(renderer: CoreRenderer): void;
    destroy(isChild?: boolean): void;
    set w(value: number);
    get w(): number;
    set h(value: number);
    get h(): number;
    /** A layout input changed: regenerate the layout on the next update. */
    private invalidateLayout;
    get maxWidth(): number;
    set maxWidth(value: number);
    get maxHeight(): number;
    set maxHeight(value: number);
    get contain(): TrProps['contain'];
    set contain(value: TrProps['contain']);
    get text(): string;
    set text(value: string);
    get fontSize(): number;
    set fontSize(value: number);
    get fontFamily(): string;
    set fontFamily(value: string);
    get fontStyle(): TrProps['fontStyle'];
    set fontStyle(value: TrProps['fontStyle']);
    get textAlign(): TrProps['textAlign'];
    set textAlign(value: TrProps['textAlign']);
    get letterSpacing(): number;
    set letterSpacing(value: number);
    get lineHeight(): number;
    set lineHeight(value: number);
    get maxLines(): number;
    set maxLines(value: number);
    get verticalAlign(): TrProps['verticalAlign'];
    set verticalAlign(value: TrProps['verticalAlign']);
    get overflowSuffix(): string;
    set overflowSuffix(value: string);
    get wordBreak(): TrProps['wordBreak'];
    set wordBreak(value: TrProps['wordBreak']);
    get offsetY(): number;
    set offsetY(value: number);
    get color(): number;
    set color(value: number);
    get forceLoad(): boolean;
    set forceLoad(value: boolean);
    get renderInfo(): TextRenderInfo;
}
