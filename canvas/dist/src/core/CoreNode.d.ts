import type { TextureOptions } from './CoreTextureManager.js';
import type { WebGlRenderer } from './renderers/webgl/WebGlRenderer.js';
import type { WebGlCtxTexture } from './renderers/webgl/WebGlCtxTexture.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import type { Stage } from './Stage.js';
import { Texture, type TextureCoords, type TextureLoadedEventHandler } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';
import { type Bound, type ClipRect, type RectWithValid } from './lib/utils.js';
import { Matrix3d } from './lib/Matrix3d.js';
import { RenderCoords } from './lib/RenderCoords.js';
import type { AnimationSettings } from './animations/CoreAnimation.js';
import type { IAnimationController } from '../common/IAnimationController.js';
import type { CoreShaderNode } from './renderers/CoreShaderNode.js';
export declare enum CoreNodeRenderState {
    Init = 0,
    OutOfBounds = 2,
    InBounds = 4,
    InViewport = 8
}
export declare enum UpdateType {
    /**
     * Child updates
     */
    Children = 1,
    /**
     * localTransform
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `localTransform`
     */
    Local = 2,
    /**
     * globalTransform
     *
     * * @remarks
     * CoreNode Properties Updated:
     * - `globalTransform`
     * - `renderBounds`
     * - `renderCoords`
     */
    Global = 4,
    /**
     * Clipping rect update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `clippingRect`
     */
    Clipping = 8,
    /**
     * Sort Z-Index Children update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `children` (sorts children by their `zIndex`)
     */
    SortZIndexChildren = 16,
    /**
     * Premultiplied Colors update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `premultipliedColorTl`
     * - `premultipliedColorTr`
     * - `premultipliedColorBl`
     * - `premultipliedColorBr`
     */
    PremultipliedColors = 32,
    /**
     * World Alpha update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `worldAlpha` = `parent.worldAlpha` * `alpha`
     *   (or just `alpha` when `ignoreParentAlpha` is enabled)
     */
    WorldAlpha = 64,
    /**
     * Is Renderable update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `isRenderable`
     *
     * Raised only when one of `updateIsRenderable`'s inputs can have changed:
     * a *changed* render state (the Global / Clipping blocks re-derive it, but
     * an unchanged classification cannot change the answer), a WorldAlpha
     * update, `RecalcUniforms` (which stands in for dimensions and shader
     * identity — see below), or an explicit raise from the texture, colour,
     * placeholder and shader writers. It is deliberately NOT raised on every
     * transform update: that made a translating node walk its whole input set
     * each frame to reach the answer it already had.
     */
    IsRenderable = 128,
    /**
     * RecalcUniforms
     *
     * @remarks
     * Raised exactly when the shader's uniform inputs can have changed: the
     * `w`/`h` setters, autosize texture application, text layout application,
     * shader assignment, and shader-prop writes.
     *
     * This flag is load-bearing beyond uniforms: `update()` bridges it to
     * `IsRenderable`, because dimensions (`hasDimensions()`) and shader
     * identity are the two `updateIsRenderable` inputs that a render-state
     * change cannot cover. A new `props.w`/`props.h` writer that forgets this
     * flag leaves both the uniforms and `isRenderable` stale.
     */
    RecalcUniforms = 256,
    /**
     * All
     *
     * @remarks
     * Derived from the members above so adding a flag can never leave this
     * value silently under-covering the set.
     */
    All = 511
}
/**
 * A custom data map which can be stored on an CoreNode
 *
 * @remarks
 * This is a map of key-value pairs that can be stored on an INode. It is used
 * to store custom data that can be used by the application.
 * The data stored can only be of type string, number or boolean.
 */
export type CustomDataMap = {
    [key: string]: string | number | boolean | undefined;
};
/**
 * Writable properties of a Node.
 */
export interface CoreNodeProps {
    /**
     * The x coordinate of the Node's Mount Point.
     *
     * @remarks
     * See {@link mountX} and {@link mountY} for more information about setting
     * the Mount Point.
     *
     * @default `0`
     */
    x: number;
    /**
     * The y coordinate of the Node's Mount Point.
     *
     * @remarks
     * See {@link mountX} and {@link mountY} for more information about setting
     * the Mount Point.
     *
     * @default `0`
     */
    y: number;
    /**
     * The width of the Node.
     *
     * @default `0`
     */
    w: number;
    /**
     * The height of the Node.
     *
     * @default `0`
     */
    h: number;
    /**
     * The alpha opacity of the Node.
     *
     * @remarks
     * The alpha value is a number between 0 and 1, where 0 is fully transparent
     * and 1 is fully opaque.
     *
     * @default `1`
     */
    alpha: number;
    /**
     * When enabled, the Node's world alpha is computed from its own
     * {@link alpha} only, ignoring the alpha inherited from its ancestors.
     *
     * @remarks
     * Normally `worldAlpha = parent.worldAlpha * alpha`, so fading a parent
     * fades every descendant with it. With `ignoreParentAlpha` enabled this
     * Node keeps rendering at its own alpha while its parent (and the rest of
     * the subtree) fades.
     *
     * Subtrees whose world alpha reaches exactly 0 are culled from rendering
     * entirely, so this Node still disappears once an ancestor hits alpha 0 —
     * the prop only has an effect while every ancestor's alpha is above 0.
     * This keeps the fully-transparent subtree cull free of bookkeeping.
     *
     * Descendants of this Node inherit from its world alpha as usual.
     *
     * @default `false`
     */
    ignoreParentAlpha: boolean;
    /**
     * Autosize
     *
     * @remarks
     * When enabled, the Node resizes to its texture's intrinsic dimensions as
     * soon as that texture loads, so an image displays at its natural size
     * without manual sizing. Any `w`/`h` given up front is overwritten on load.
     *
     * Enabling this after the texture has already loaded applies the size
     * immediately; swapping the texture re-applies it on the new load.
     *
     * @remarks
     * This is a texture-only feature and has no other effect:
     * - A Node with no texture is never resized, whatever its children do. To
     *   size a container to its content, compute and set `w`/`h` yourself.
     * - Text Nodes ignore it — their dimensions come from text layout, and on
     *   the canvas path their texture is generated *from* that layout.
     * @default `false`
     */
    autosize: boolean;
    /**
     * Clipping Mode
     *
     * @remarks
     * Enable Clipping Mode when you want to prevent the drawing of a Node and
     * its descendants from overflowing outside of the Node's x/y/width/height
     * bounds.
     *
     * Pass `true` to clip exactly to the Node's bounds, or pass a
     * `[top, right, bottom, left]` tuple to expand the clip rectangle outward
     * by the given pixel amounts on each side (negative values inset it).
     *
     * For WebGL, clipping is implemented using the high-performance WebGL
     * operation scissor. As a consequence, clipping does not work for
     * non-rectangular areas. So, if the element is rotated
     * (by itself or by any of its ancestors), clipping will not work as intended.
     *
     * @default `false`
     */
    clipping: boolean | [number, number, number, number];
    /**
     * The color of the Node.
     *
     * @remarks
     * The color value is a number in the format 0xRRGGBBAA, where RR is the red
     * component, GG is the green component, BB is the blue component, and AA is
     * the alpha component.
     *
     * Gradient colors may be set by setting the different color sub-properties:
     * {@link colorTop}, {@link colorBottom}, {@link colorLeft}, {@link colorRight},
     * {@link colorTl}, {@link colorTr}, {@link colorBr}, {@link colorBl} accordingly.
     *
     * @default `0xffffffff` (opaque white)
     */
    color: number;
    /**
     * The color of the top edge of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorTop: number;
    /**
     * The color of the bottom edge of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorBottom: number;
    /**
     * The color of the left edge of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorLeft: number;
    /**
     * The color of the right edge of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorRight: number;
    /**
     * The color of the top-left corner of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorTl: number;
    /**
     * The color of the top-right corner of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorTr: number;
    /**
     * The color of the bottom-right corner of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorBr: number;
    /**
     * The color of the bottom-left corner of the Node for gradient rendering.
     *
     * @remarks
     * See {@link color} for more information about color values and gradient
     * rendering.
     */
    colorBl: number;
    /**
     * Placeholder color shown while the Node's texture is not yet loaded.
     *
     * @remarks
     * When set to a non-zero color and the Node has a texture (e.g. {@link src}),
     * the Node renders a solid rectangle of this color until the texture
     * finishes loading, instead of rendering nothing. The placeholder renders
     * through the Node's shader, so rounded corners and borders apply to it.
     * It also shows again if the texture is freed under memory pressure (until
     * the reload completes) and remains if the texture permanently fails.
     *
     * The color value is a number in the format 0xRRGGBBAA. Set to `0` to
     * disable (default). Has no effect on Nodes without a texture.
     *
     * @default `0`
     */
    placeholderColor: number;
    /**
     * The Node's parent Node.
     *
     * @remarks
     * The value `null` indicates that the Node has no parent. This may either be
     * because the Node is the root Node of the scene graph, or because the Node
     * has been removed from the scene graph.
     *
     * In order to make sure that a Node can be rendered on the screen, it must
     * be added to the scene graph by setting it's parent property to a Node that
     * is already in the scene graph such as the root Node.
     *
     * @default `null`
     */
    parent: CoreNode | null;
    /**
     * The Node's z-index.
     *
     * @remarks
     * Max z-index of children under the same parent determines which child
     * is rendered on top. Higher z-index means the Node is rendered on top of
     * children with lower z-index.
     *
     * Max value is 1000 and min value is -1000. Values outside of this range will be clamped.
     */
    zIndex: number;
    /**
     * The Node's Texture.
     *
     * @remarks
     * The `texture` defines a rasterized image that is contained within the
     * {@link width} and {@link height} dimensions of the Node. If null, the
     * Node will use an opaque white {@link ColorTexture} when being drawn, which
     * essentially enables colors (including gradients) to be drawn.
     *
     * If set, by default, the texture will be drawn, as is, stretched to the
     * dimensions of the Node. This behavior can be modified by setting the TBD
     * and TBD properties.
     *
     * To create a Texture in order to set it on this property, call
     * {@link RendererMain.createTexture}.
     *
     * If the {@link src} is set on a Node, the Node will use the
     * {@link ImageTexture} by default and the Node will simply load the image at
     * the specified URL.
     *
     * Note: If this is a Text Node, the Texture will be managed by the Node's
     * {@link TextRenderer} and should not be set explicitly.
     */
    texture: Texture | null;
    /**
     * Options to associate with the Node's Texture
     */
    textureOptions: TextureOptions;
    /**
     * The Node's shader
     *
     * @remarks
     * The `shader` defines a {@link Shader} used to draw the Node. By default,
     * the Default Shader is used which simply draws the defined {@link texture}
     * or {@link color}(s) within the Node without any special effects.
     *
     * To create a Shader in order to set it on this property, call
     * {@link RendererMain.createShader}.
     *
     * Note: If this is a Text Node, the Shader will be managed by the Node's
     * {@link TextRenderer} and should not be set explicitly.
     */
    shader: CoreShaderNode<any> | null;
    /**
     * Image source
     *
     * @remarks
     * When set, the Node's {@link texture} is automatically set to an
     * {@link ImageTexture} using the source provided (with all other settings
     * being defaults).
     *
     * A URL string doubles as the texture's cache identity, so the same URL on
     * many Nodes resolves to one texture and one GPU upload. A `Blob` or
     * `ImageData` has no such identity, so it needs a {@link srcKey}. Without
     * one, every assignment allocates and uploads a new texture, and the result
     * is invisible to the texture cache for the rest of its life.
     */
    src: string | Blob | ImageData | null;
    /**
     * Cache key for a non-string {@link src}
     *
     * @remarks
     * Supplies the cache identity a `Blob` or `ImageData` does not have, and is
     * required for one: a keyless non-string source produces a texture the cache
     * never holds, which means no reuse between Nodes showing the same bytes and
     * no reachability from the memory manager's cache sweep, so its upload stays
     * resident until memory pressure frees it. Development builds warn when one
     * is missing.
     *
     * The key must be stable for the content and distinct across content
     * (`thumb:asset-1:42`); reusing a key for different bytes serves the first
     * texture to every later caller.
     *
     * Applied when the texture is built, so it must be set *before* `src` (the
     * same ordering {@link srcX}, {@link srcWidth} and {@link imageType} already
     * require). Setting it on its own does not rebuild the current texture.
     *
     * Has no effect when `src` is a string, because a URL is already the cache
     * key.
     *
     * @default `undefined`
     */
    srcKey?: string | null;
    /**
     * Scale to render the Node at
     *
     * @remarks
     * The scale value multiplies the provided {@link width} and {@link height}
     * of the Node around the Node's Pivot Point (defined by the {@link pivot}
     * props).
     *
     * Behind the scenes, setting this property sets both the {@link scaleX} and
     * {@link scaleY} props to the same value.
     *
     * NOTE: When the scaleX and scaleY props are explicitly set to different values,
     * this property returns `null`. Setting `null` on this property will have no
     * effect.
     *
     * @default 1.0
     */
    scale: number | null;
    /**
     * Scale to render the Node at (X-Axis)
     *
     * @remarks
     * The scaleX value multiplies the provided {@link width} of the Node around
     * the Node's Pivot Point (defined by the {@link pivot} props).
     *
     * @default 1.0
     */
    scaleX: number;
    /**
     * Scale to render the Node at (Y-Axis)
     *
     * @remarks
     * The scaleY value multiplies the provided {@link height} of the Node around
     * the Node's Pivot Point (defined by the {@link pivot} props).
     *
     * @default 1.0
     */
    scaleY: number;
    /**
     * Combined position of the Node's Mount Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Mount Point at the top-left corner of the Node.
     * - `0.5` defines it at the center of the Node.
     * - `1.0` defines it at the bottom-right corner of the node.
     *
     * Use the {@link mountX} and {@link mountY} props seperately for more control
     * of the Mount Point.
     *
     * When assigned, the same value is also passed to both the {@link mountX} and
     * {@link mountY} props.
     *
     * @default 0 (top-left)
     */
    mount: number;
    /**
     * X position of the Node's Mount Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Mount Point's X position as the left-most edge of the
     *   Node
     * - `0.5` defines it as the horizontal center of the Node
     * - `1.0` defines it as the right-most edge of the Node.
     *
     * The combination of {@link mountX} and {@link mountY} define the Mount Point
     *
     * @default 0 (left-most edge)
     */
    mountX: number;
    /**
     * Y position of the Node's Mount Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Mount Point's Y position as the top-most edge of the
     *   Node
     * - `0.5` defines it as the vertical center of the Node
     * - `1.0` defines it as the bottom-most edge of the Node.
     *
     * The combination of {@link mountX} and {@link mountY} define the Mount Point
     *
     * @default 0 (top-most edge)
     */
    mountY: number;
    /**
     * Combined position of the Node's Pivot Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Pivot Point at the top-left corner of the Node.
     * - `0.5` defines it at the center of the Node.
     * - `1.0` defines it at the bottom-right corner of the node.
     *
     * Use the {@link pivotX} and {@link pivotY} props seperately for more control
     * of the Pivot Point.
     *
     * When assigned, the same value is also passed to both the {@link pivotX} and
     * {@link pivotY} props.
     *
     * @default 0.5 (center)
     */
    pivot: number;
    /**
     * X position of the Node's Pivot Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Pivot Point's X position as the left-most edge of the
     *   Node
     * - `0.5` defines it as the horizontal center of the Node
     * - `1.0` defines it as the right-most edge of the Node.
     *
     * The combination of {@link pivotX} and {@link pivotY} define the Pivot Point
     *
     * @default 0.5 (centered on x-axis)
     */
    pivotX: number;
    /**
     * Y position of the Node's Pivot Point
     *
     * @remarks
     * The value can be any number between `0.0` and `1.0`:
     * - `0.0` defines the Pivot Point's Y position as the top-most edge of the
     *   Node
     * - `0.5` defines it as the vertical center of the Node
     * - `1.0` defines it as the bottom-most edge of the Node.
     *
     * The combination of {@link pivotX} and {@link pivotY} define the Pivot Point
     *
     * @default 0.5 (centered on y-axis)
     */
    pivotY: number;
    /**
     * Rotation of the Node (in Radians)
     *
     * @remarks
     * Sets the amount to rotate the Node by around it's Pivot Point (defined by
     * the {@link pivot} props). Positive values rotate the Node clockwise, while
     * negative values rotate it counter-clockwise.
     *
     * Example values:
     * - `-Math.PI / 2`: 90 degree rotation counter-clockwise
     * - `0`: No rotation
     * - `Math.PI / 2`: 90 degree rotation clockwise
     * - `Math.PI`: 180 degree rotation clockwise
     * - `3 * Math.PI / 2`: 270 degree rotation clockwise
     * - `2 * Math.PI`: 360 rotation clockwise
     */
    rotation: number;
    /**
     * Node data element for custom data storage (optional)
     *
     * @remarks
     * This property is used to store custom data on the Node as a key/value data store.
     * Data values are limited to string, numbers, booleans. Strings will be truncated
     * to a 2048 character limit for performance reasons.
     *
     * This is not a data storage mechanism for large amounts of data please use a
     * dedicated data storage mechanism for that.
     *
     * The custom data will be reflected in the inspector as part of `data-*` attributes
     *
     * @default `undefined`
     */
    data?: CustomDataMap;
    /**
     * Image Type to explicitly set the image type that is being loaded
     *
     * @remarks
     * This property must be used with a `src` that points at an image. In some cases
     * the extension doesn't provide a reliable representation of the image type. In such
     * cases set the ImageType explicitly.
     *
     * `regular` is used for normal images such as png, jpg, etc
     * `compressed` is used for ETC1/ETC2 compressed images with a PVR or KTX container
     * `svg` is used for scalable vector graphics
     *
     * @default `undefined`
     */
    imageType?: 'regular' | 'compressed' | 'svg' | null;
    /**
     * She width of the rectangle from which the Image Texture will be extracted.
     * This value can be negative. If not provided, the image's source natural
     * width will be used.
     */
    srcWidth?: number;
    /**
     * The height of the rectangle from which the Image Texture will be extracted.
     * This value can be negative. If not provided, the image's source natural
     * height will be used.
     */
    srcHeight?: number;
    /**
     * The x coordinate of the reference point of the rectangle from which the Texture
     * will be extracted.  `width` and `height` are provided. And only works when
     * createImageBitmap is available. Only works when createImageBitmap is supported on the browser.
     */
    srcX?: number;
    /**
     * The y coordinate of the reference point of the rectangle from which the Texture
     * will be extracted. Only used when source `srcWidth` width and `srcHeight` height
     * are provided. Only works when createImageBitmap is supported on the browser.
     */
    srcY?: number;
    /**
     * preventDestroy flag prevents the node and its children from being destroyed
     * when the parent is destroyed.
     * @default false
     */
    preventDestroy?: boolean;
    /**
     * The name of the framework component that created this node.
     *
     * @remarks
     * When set, the Inspector will create a custom HTML element with this name
     * so that the Chrome DevTools Elements panel displays the component name
     * instead of a generic `<div>`. The value should match the JSX component
     * name as written in source (e.g. `"MyButton"`).
     *
     * This is typically injected by a Babel plugin (e.g. `jsx-locator`) and is
     * only meaningful when the Inspector is enabled.
     *
     * @default `undefined`
     */
    componentName?: string;
    /**
     * The source file path of the framework component that created this node.
     *
     * @remarks
     * When set alongside {@link componentName}, the Inspector will attach a
     * `data-location` attribute to the DOM element, enabling click-to-source
     * navigation from Chrome DevTools.
     *
     * The value should be an absolute or project-relative path to the component
     * source file, optionally followed by `:line:column`
     * (e.g. `"/src/components/MyButton.tsx:12:3"`).
     *
     * @default `undefined`
     */
    componentLocation?: string;
}
/**
 * Grab all the number properties of type T
 */
type NumberProps<T> = {
    [Key in keyof T as NonNullable<T[Key]> extends number ? Key : never]: number;
};
/**
 * Properties of a Node used by the animate() function
 */
export interface CoreNodeAnimateProps extends NumberProps<CoreNodeProps> {
    /**
     * Shader properties to animate
     */
    shaderProps: Record<string, number>;
}
/**
 * A visual Node in the Renderer scene graph.
 *
 * @remarks
 * CoreNode is an internally used class that represents a Renderer Node in the
 * scene graph. See INode.ts for the public APIs exposed to Renderer users
 * that include generic types for Shaders.
 */
export declare class CoreNode extends EventEmitter {
    readonly stage: Stage;
    readonly children: CoreNode[];
    protected _id: number;
    readonly props: CoreNodeProps;
    /**
     * Lazily allocated on first `animateProp` call. Animations are rare across
     * the scene graph, so deferring the object literal avoids per-node GC
     * pressure during construction.
     */
    private _animations;
    renderOpBufferIdx: number;
    numQuads: number;
    /**
     * The single texture bound for this render op. A draw call samples exactly
     * one texture unit (see WebGlShaderProgram.bindTexture), so a quad whose
     * texture differs from the op's forces a new op instead of joining it.
     */
    renderOpTexture: WebGlCtxTexture | null;
    private hasShaderUpdater;
    hasShaderTimeFn: boolean;
    private hasColorProps;
    textureLoaded: boolean;
    /**
     * Last ownership value sent to the current texture via
     * {@link updateTextureOwnership}. Per (node, texture) pair — must reset to
     * `false` whenever the texture is swapped or released, or a stale `true`
     * would skip the re-registration that triggers `Texture.load()`.
     */
    private textureOwnership;
    /**
     * True while this node should render its `placeholderColor` instead of its
     * texture: `placeholderColor` is non-zero, a texture is set, and that
     * texture is not loaded. Read by the renderers' quad path to substitute the
     * stage's default (1x1 white) texture. Maintained by
     * {@link updatePlaceholderActive} — never written elsewhere.
     */
    placeholderActive: boolean;
    updateType: number;
    childUpdateType: number;
    globalTransform?: Matrix3d;
    localTransform?: Matrix3d;
    renderCoords?: RenderCoords;
    renderBound?: Bound;
    /**
     * Points at the shared `NO_CLIPPING_RECT` until this node actually
     * participates in clipping (either it clips, or an ancestor's clip rect
     * propagates down). Clipping is rare across the scene graph, so most nodes
     * never allocate their own rect — `calculateClippingRect` swaps in a private
     * object lazily the first time one is needed.
     */
    clippingRect: ClipRect;
    textureCoords?: TextureCoords;
    updateShaderUniforms: boolean;
    isRenderable: boolean;
    renderState: CoreNodeRenderState;
    isSimple: boolean;
    /**
     * `true` when `localTransform` is in identity-shape (ta=1, tb=0, tc=0, td=1)
     * — i.e. a pure translation. Lets the simple-path `updateLocalTransform`
     * skip redundant ta/tb/tc/td writes between frames. Defaults to `true`
     * because the matrix is eagerly allocated as an identity in the constructor.
     */
    _localIsTranslate: boolean;
    /**
     * Cached result of the texture `contain` resizeMode check used by
     * `updateLocalTransform` and `updateIsSimple`. Updated whenever the
     * texture or textureOptions change (via `updateIsSimple`), so the hot
     * paths can avoid the optional-chain + string compare on every frame.
     */
    _hasContainResize: boolean;
    /**
     * `true` when either mount axis is non-zero. A mount offset is a pure
     * translation, so mounted nodes stay `isSimple` — this flag lets the
     * simple path skip the two mount multiplies for the common `mount === 0`
     * case. Updated via `updateIsSimple` alongside `_hasContainResize`.
     */
    _hasMount: boolean;
    /**
     * `true` when `globalTransform` is in identity-shape (ta=1, tb=0, tc=0, td=1).
     * Propagates from parent: a node's global is translate-only iff the parent's
     * global is translate-only AND the node itself is `isSimple`. Default `true`
     * because freshly-constructed nodes have no transform applied yet, and the
     * Stage root is configured with an identity-shape global.
     */
    _globalIsTranslate: boolean;
    worldAlpha: number;
    premultipliedColorTl: number;
    premultipliedColorTr: number;
    premultipliedColorBl: number;
    premultipliedColorBr: number;
    destroyed: boolean;
    constructor(stage: Stage, props: CoreNodeProps);
    /**
     * Recompute {@link placeholderActive} after any of its inputs changed
     * (placeholderColor, texture, textureLoaded).
     *
     * @remarks
     * On a toggle this raises `PremultipliedColors` (the quad's vertex colors
     * switch between the placeholder color and the regular color props — this
     * also marks the quad dirty) and `IsRenderable` (a loading texture with a
     * placeholder is renderable). Both are processed in the same frame's update
     * pass, before quads are submitted.
     */
    private updatePlaceholderActive;
    loadTexture(): void;
    /**
     * Task for queueMicrotask to loadTexture
     *
     * @remarks
     * This method is called in a microtask to release the texture.
     */
    private loadTextureTask;
    unloadTexture(): void;
    /**
     * Size the node to its texture when `autosize` is set.
     *
     * @remarks
     * Autosize is texture-only: it takes the loaded texture's intrinsic
     * dimensions and nothing else. The write goes straight to `props` rather
     * than through the `w`/`h` setters, which CoreTextNode overrides to mean
     * max-width / max-height — hence the explicit `Local | RecalcUniforms`,
     * which is what those setters would otherwise have raised.
     *
     * Overridden to a no-op by CoreTextNode: a text node's dimensions come from
     * its layout, and its texture is generated *from* that layout, so sizing to
     * the texture would be circular.
     */
    protected applyAutosizeDimensions(w: number, h: number): void;
    /**
     * The one writer of `props.w`/`props.h`. Dimensions feed shader uniforms
     * (e.g. factored corner radius), and `RecalcUniforms` is also what makes
     * `update()` re-derive `isRenderable` — so every dimension change must
     * raise it. Route new w/h writers through here rather than writing props.
     *
     * Does not refresh packed texture coords; image-node callers follow up with
     * {@link refreshTextureCoords}. Text nodes skip that: their UVs come from
     * each freshly generated texture.
     */
    protected applySize(w: number, h: number): void;
    /**
     * Recompute packed texture coords. They are a function of the texture and,
     * when textureOptions (resizeMode, clipX/clipY) are set, of the node's
     * dimensions — so a load, a resize or an options change must refresh them.
     */
    private refreshTextureCoords;
    protected onTextureLoaded: TextureLoadedEventHandler;
    private onTextureFailed;
    private onTextureFreed;
    /**
     * Change types types is used to determine the scope of the changes being applied
     *
     * @remarks
     * See {@link UpdateType} for more information on each type
     *
     * @param type
     */
    setUpdateType(type: UpdateType): void;
    updateLocalTransform(): void;
    updateIsSimple(): void;
    /**
     * @todo: test for correct calculation flag
     * @param delta
     */
    update(delta: number, parentClippingRect: RectWithValid): void;
    /**
     * Classify this node against its visible region.
     *
     * The visible region is the viewport, narrowed by the node's clipping rect
     * when a clipping ancestor (or the node itself) applies one. `clippingRect`
     * is already the accumulated, parent-intersected rect maintained for the
     * scissor, so culling reuses it rather than tracking a second bound.
     *
     * `InViewport` means the render bounds intersect that region; `InBounds`
     * means they intersect it grown by the stage preload margin
     * (`[top, right, bottom, left]`), which keeps textures loading a runway
     * ahead of the node scrolling into view.
     */
    checkRenderBounds(): CoreNodeRenderState;
    updateRenderState(renderState: CoreNodeRenderState): void;
    /**
     * Checks if the node is renderable based on world alpha, dimensions and out of bounds status.
     */
    checkBasicRenderability(): boolean;
    /**
     * Updates the `isRenderable` property based on various conditions.
     */
    updateIsRenderable(): void;
    /**
     * Sets the renderable state and triggers changes if necessary.
     * @param isRenderable - The new renderable state
     */
    setRenderable(isRenderable: boolean): void;
    /**
     * Changes the renderable state of the node.
     */
    updateTextureOwnership(isRenderable: boolean): void;
    /**
     * Checks if the node is out of the viewport bounds.
     */
    isOutOfBounds(): boolean;
    /**
     * Checks if the node has dimensions (width/height)
     */
    hasDimensions(): boolean;
    /**
     * Recompute `renderCoords` and `renderBound` from `globalTransform` + w/h.
     *
     * @remarks
     * Both are derived from the same four corners, so the Global update block
     * produces them in a single pass. Computing them separately re-loads
     * `globalTransform`, re-tests the axis-aligned case, and reads the corners
     * back out of `renderCoords` only to write the same numbers into the bound.
     */
    updateGlobalGeometry(): void;
    /**
     * This function calculates the clipping rectangle for a node.
     *
     * The function then checks if the node is rotated. If the node requires clipping and is not rotated, a new clipping rectangle is created based on the node's global transform and dimensions.
     * If a parent clipping rectangle exists, it is intersected with the node's clipping rectangle (if it exists), or replaces the node's clipping rectangle.
     *
     * Finally, the node's parentClippingRect and clippingRect properties are updated.
     */
    calculateClippingRect(parentClippingRect: RectWithValid): void;
    /**
     * Destroy the node and cleanup all resources
     */
    destroy(isChild?: boolean): void;
    renderQuads(renderer: CoreRenderer): void;
    get renderTexture(): Texture | null;
    get renderTextureCoords(): TextureCoords | undefined;
    get width(): number;
    get height(): number;
    get time(): number;
    getTimerValue(): number;
    sortChildren(): void;
    removeChild(node: CoreNode): void;
    addChild(node: CoreNode): void;
    get id(): number;
    get data(): CustomDataMap | undefined;
    set data(d: CustomDataMap | undefined);
    get x(): number;
    set x(value: number);
    get absX(): number;
    get absY(): number;
    get y(): number;
    set y(value: number);
    get w(): number;
    set w(value: number);
    get h(): number;
    set h(value: number);
    get scale(): number;
    set scale(value: number);
    get scaleX(): number;
    set scaleX(value: number);
    get scaleY(): number;
    set scaleY(value: number);
    get mount(): number;
    set mount(value: number);
    get mountX(): number;
    set mountX(value: number);
    get mountY(): number;
    set mountY(value: number);
    get pivot(): number;
    set pivot(value: number);
    get pivotX(): number;
    set pivotX(value: number);
    get pivotY(): number;
    set pivotY(value: number);
    get rotation(): number;
    set rotation(value: number);
    get alpha(): number;
    set alpha(value: number);
    get ignoreParentAlpha(): boolean;
    set ignoreParentAlpha(value: boolean);
    get autosize(): boolean;
    set autosize(value: boolean);
    get clipping(): boolean | [number, number, number, number];
    set clipping(value: boolean | [number, number, number, number]);
    get color(): number;
    set color(value: number);
    /**
     * Whether any corner colour is non-transparent.
     *
     * @remarks
     * The corners are the ground truth: `color` and the edge props all resolve
     * down to them, both in `resolveNodeDefaults` and in the setters. This is the
     * single definition of the rule — the constructor and
     * {@link updateHasColorProps} both go through it, so a node can never be
     * classified one way at construction and the other way after a write.
     */
    private computeHasColorProps;
    /**
     * Recompute {@link hasColorProps} after a colour write.
     *
     * @remarks
     * Deriving from a single written component is wrong — clearing one corner
     * must not report "no colour" while the other three are opaque.
     * `IsRenderable` is raised only when the flag actually flips, since that is
     * the only input `updateIsRenderable` takes from it.
     */
    private updateHasColorProps;
    get placeholderColor(): number;
    set placeholderColor(value: number);
    get colorTop(): number;
    set colorTop(value: number);
    get colorBottom(): number;
    set colorBottom(value: number);
    get colorLeft(): number;
    set colorLeft(value: number);
    get colorRight(): number;
    set colorRight(value: number);
    get colorTl(): number;
    set colorTl(value: number);
    get colorTr(): number;
    set colorTr(value: number);
    get colorBl(): number;
    set colorBl(value: number);
    get colorBr(): number;
    set colorBr(value: number);
    get zIndex(): number;
    set zIndex(value: number);
    get parent(): CoreNode | null;
    set parent(newParent: CoreNode | null);
    get preventDestroy(): boolean | undefined;
    set preventDestroy(value: boolean | undefined);
    get shader(): CoreShaderNode<any> | null;
    set shader(shader: CoreShaderNode<any> | null);
    get src(): string | Blob | ImageData | null;
    set src(imageUrl: string | Blob | ImageData | null);
    get srcKey(): string | null;
    set srcKey(value: string | null);
    set imageType(type: 'regular' | 'compressed' | 'svg' | null);
    get imageType(): "regular" | "compressed" | "svg" | null;
    get srcHeight(): number | undefined;
    set srcHeight(value: number);
    get srcWidth(): number | undefined;
    set srcWidth(value: number);
    get srcX(): number | undefined;
    set srcX(value: number);
    get srcY(): number | undefined;
    set srcY(value: number);
    get texture(): Texture | null;
    set texture(value: Texture | null);
    set textureOptions(value: TextureOptions);
    get textureOptions(): TextureOptions;
    get componentName(): string | undefined;
    get componentLocation(): string | undefined;
    animate(props: Partial<CoreNodeAnimateProps>, settings: Partial<AnimationSettings>): IAnimationController;
    animateProp(name: string, value: number, settings: Partial<AnimationSettings>): IAnimationController;
    animateToTarget(prop: string): number | undefined;
    draw(renderer: WebGlRenderer): void;
}
export {};
