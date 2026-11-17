import { getNewId, premultiplyColorABGR, EMIT_BOUNDS_EVENTS, isProductionEnvironment, } from '../utils.js';
import { Texture, TextureType, } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';
import { copyRect, intersectRect, createBound, updateScissor, } from './lib/utils.js';
import { Matrix3d } from './lib/Matrix3d.js';
import { RenderCoords } from './lib/RenderCoords.js';
import { createAnimation } from './animations/CoreAnimation.js';
import { removeChild, sortByZIndexStable } from './lib/collectionUtils.js';
import { WORDS_PER_QUAD } from './renderers/webgl/internal/RendererUtils.js';
export var CoreNodeRenderState;
(function (CoreNodeRenderState) {
    CoreNodeRenderState[CoreNodeRenderState["Init"] = 0] = "Init";
    CoreNodeRenderState[CoreNodeRenderState["OutOfBounds"] = 2] = "OutOfBounds";
    CoreNodeRenderState[CoreNodeRenderState["InBounds"] = 4] = "InBounds";
    CoreNodeRenderState[CoreNodeRenderState["InViewport"] = 8] = "InViewport";
})(CoreNodeRenderState || (CoreNodeRenderState = {}));
const NO_CLIPPING_RECT = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    valid: false,
    scissorX: 0,
    scissorY: 0,
    scissorW: 0,
    scissorH: 0,
};
export var UpdateType;
(function (UpdateType) {
    /**
     * Child updates
     */
    UpdateType[UpdateType["Children"] = 1] = "Children";
    /**
     * localTransform
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `localTransform`
     */
    UpdateType[UpdateType["Local"] = 2] = "Local";
    /**
     * globalTransform
     *
     * * @remarks
     * CoreNode Properties Updated:
     * - `globalTransform`
     * - `renderBounds`
     * - `renderCoords`
     */
    UpdateType[UpdateType["Global"] = 4] = "Global";
    /**
     * Clipping rect update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `clippingRect`
     */
    UpdateType[UpdateType["Clipping"] = 8] = "Clipping";
    /**
     * Sort Z-Index Children update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `children` (sorts children by their `zIndex`)
     */
    UpdateType[UpdateType["SortZIndexChildren"] = 16] = "SortZIndexChildren";
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
    UpdateType[UpdateType["PremultipliedColors"] = 32] = "PremultipliedColors";
    /**
     * World Alpha update
     *
     * @remarks
     * CoreNode Properties Updated:
     * - `worldAlpha` = `parent.worldAlpha` * `alpha`
     *   (or just `alpha` when `ignoreParentAlpha` is enabled)
     */
    UpdateType[UpdateType["WorldAlpha"] = 64] = "WorldAlpha";
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
    UpdateType[UpdateType["IsRenderable"] = 128] = "IsRenderable";
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
    UpdateType[UpdateType["RecalcUniforms"] = 256] = "RecalcUniforms";
    /**
     * All
     *
     * @remarks
     * Derived from the members above so adding a flag can never leave this
     * value silently under-covering the set.
     */
    UpdateType[UpdateType["All"] = 511] = "All";
})(UpdateType || (UpdateType = {}));
/**
 * A visual Node in the Renderer scene graph.
 *
 * @remarks
 * CoreNode is an internally used class that represents a Renderer Node in the
 * scene graph. See INode.ts for the public APIs exposed to Renderer users
 * that include generic types for Shaders.
 */
export class CoreNode extends EventEmitter {
    stage;
    children = [];
    _id = getNewId();
    props;
    /**
     * Lazily allocated on first `animateProp` call. Animations are rare across
     * the scene graph, so deferring the object literal avoids per-node GC
     * pressure during construction.
     */
    _animations = null;
    // WebGL Render Op State
    renderOpBufferIdx = 0;
    numQuads = 0;
    /**
     * The single texture bound for this render op. A draw call samples exactly
     * one texture unit (see WebGlShaderProgram.bindTexture), so a quad whose
     * texture differs from the op's forces a new op instead of joining it.
     */
    renderOpTexture = null;
    hasShaderUpdater = false;
    hasShaderTimeFn = false;
    hasColorProps = false;
    textureLoaded = false;
    /**
     * Last ownership value sent to the current texture via
     * {@link updateTextureOwnership}. Per (node, texture) pair — must reset to
     * `false` whenever the texture is swapped or released, or a stale `true`
     * would skip the re-registration that triggers `Texture.load()`.
     */
    textureOwnership = false;
    /**
     * True while this node should render its `placeholderColor` instead of its
     * texture: `placeholderColor` is non-zero, a texture is set, and that
     * texture is not loaded. Read by the renderers' quad path to substitute the
     * stage's default (1x1 white) texture. Maintained by
     * {@link updatePlaceholderActive} — never written elsewhere.
     */
    placeholderActive = false;
    // Literal 0 rather than a named member: UpdateType is a regular (non-const)
    // enum, so every named access is a property lookup at runtime, and the
    // update loop already compares against 0 directly.
    updateType = 0;
    childUpdateType = 0;
    globalTransform;
    localTransform;
    renderCoords;
    renderBound;
    /**
     * Points at the shared `NO_CLIPPING_RECT` until this node actually
     * participates in clipping (either it clips, or an ancestor's clip rect
     * propagates down). Clipping is rare across the scene graph, so most nodes
     * never allocate their own rect — `calculateClippingRect` swaps in a private
     * object lazily the first time one is needed.
     */
    clippingRect = NO_CLIPPING_RECT;
    textureCoords;
    updateShaderUniforms = false;
    isRenderable = false;
    renderState = CoreNodeRenderState.Init;
    isSimple = true;
    /**
     * `true` when `localTransform` is in identity-shape (ta=1, tb=0, tc=0, td=1)
     * — i.e. a pure translation. Lets the simple-path `updateLocalTransform`
     * skip redundant ta/tb/tc/td writes between frames. Defaults to `true`
     * because the matrix is eagerly allocated as an identity in the constructor.
     */
    _localIsTranslate = true;
    /**
     * Cached result of the texture `contain` resizeMode check used by
     * `updateLocalTransform` and `updateIsSimple`. Updated whenever the
     * texture or textureOptions change (via `updateIsSimple`), so the hot
     * paths can avoid the optional-chain + string compare on every frame.
     */
    _hasContainResize = false;
    /**
     * `true` when either mount axis is non-zero. A mount offset is a pure
     * translation, so mounted nodes stay `isSimple` — this flag lets the
     * simple path skip the two mount multiplies for the common `mount === 0`
     * case. Updated via `updateIsSimple` alongside `_hasContainResize`.
     */
    _hasMount = false;
    /**
     * `true` when `globalTransform` is in identity-shape (ta=1, tb=0, tc=0, td=1).
     * Propagates from parent: a node's global is translate-only iff the parent's
     * global is translate-only AND the node itself is `isSimple`. Default `true`
     * because freshly-constructed nodes have no transform applied yet, and the
     * Stage root is configured with an identity-shape global.
     */
    _globalIsTranslate = true;
    worldAlpha = 1;
    premultipliedColorTl = 0;
    premultipliedColorTr = 0;
    premultipliedColorBl = 0;
    premultipliedColorBr = 0;
    destroyed = false;
    constructor(stage, props) {
        super();
        this.stage = stage;
        // Eagerly allocate the local/global transform matrices as identity.
        // This keeps the field's hidden class monomorphic (Matrix3d, not
        // Matrix3d|undefined) from construction onward and lets the simple
        // / translate-only fast paths take effect on the very first update.
        this.localTransform = Matrix3d.identity();
        this.globalTransform = Matrix3d.identity();
        //inital update type
        // The first pass runs only the blocks nothing else can derive:
        //
        // - Local seeds localTransform, and its block raises Global, which in turn
        //   raises the render-state check, Children and IsRenderable.
        // - Clipping is here so a node added under an already settled (non-moving)
        //   clipping ancestor still inherits that ancestor's clipping rect — the
        //   rect doubles as the node's visible region for culling, so it must
        //   never be left stale.
        // - WorldAlpha derives worldAlpha from the parent's (which the node cannot
        //   read at construction time), and its block raises PremultipliedColors.
        //
        // Everything else is raised on demand: SortZIndexChildren and Children by
        // addChild, RecalcUniforms by the shader setter. Autosize needs no seed —
        // it is applied straight from the texture's dimensions in
        // `applyAutosizeDimensions`, called by onTextureLoaded.
        let initialUpdateType = UpdateType.Local | UpdateType.Clipping | UpdateType.WorldAlpha;
        // Use the incoming props object directly — resolveNodeDefaults already
        // creates a fresh object with a consistent shape.  Save fields that are
        // re-applied through setters, then null them on props so the setters
        // detect the change.
        const { texture, shader, src, parent } = props;
        const p = (this.props = props);
        p.texture = null;
        p.shader = null;
        p.src = null;
        p.scale = null;
        // Same rule the colour setters use — assigned directly rather than through
        // updateHasColorProps() so construction does not raise a redundant
        // IsRenderable (the first pass derives it) or walk to the parent.
        this.hasColorProps = this.computeHasColorProps();
        // Only set non-default values
        if (p.zIndex !== 0) {
            this.zIndex = p.zIndex;
        }
        if (parent !== null) {
            parent.addChild(this);
        }
        // Assign saved values through setters only when they differ from defaults.
        // In the common JSX path these are all unset, so each unconditional setter
        // call would either short-circuit on equality or — for shader — fire a
        // redundant setUpdateType traversal up the parent chain.
        if (texture !== null) {
            this.texture = texture;
        }
        if (shader === null || shader === this.stage.defShaderNode) {
            // Default shader — bypass the setter; props.shader was reset to null
            // above and just needs to point at the default.
            p.shader = this.stage.defShaderNode;
        }
        else {
            this.shader = shader;
        }
        if (src !== null) {
            this.src = src;
        }
        this.setUpdateType(initialUpdateType);
        this.updateIsSimple();
    }
    //#region Textures
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
    updatePlaceholderActive() {
        const active = this.props.placeholderColor !== 0 &&
            this.props.texture !== null &&
            this.textureLoaded === false;
        if (active !== this.placeholderActive) {
            this.placeholderActive = active;
            this.setUpdateType(UpdateType.PremultipliedColors | UpdateType.IsRenderable);
        }
    }
    loadTexture() {
        if (this.props.texture === null) {
            return;
        }
        // If texture is already loaded / failed, trigger loaded event manually
        // so that users get a consistent event experience.
        // We do this in a microtask to allow listeners to be attached in the same
        // synchronous task after calling loadTexture()
        queueMicrotask(this.loadTextureTask);
    }
    /**
     * Task for queueMicrotask to loadTexture
     *
     * @remarks
     * This method is called in a microtask to release the texture.
     */
    loadTextureTask = () => {
        const texture = this.props.texture;
        //it is possible that texture is null here if user sets the texture to null right after loadTexture call
        if (texture === null) {
            return;
        }
        if (this.textureOptions.preload === true) {
            this.stage.txManager.loadTexture(texture);
        }
        texture.preventCleanup = this.props.textureOptions?.preventCleanup ?? false;
        texture.on('loaded', this.onTextureLoaded);
        texture.on('failed', this.onTextureFailed);
        texture.on('freed', this.onTextureFreed);
        if (texture.state === 'loaded') {
            this.onTextureLoaded(texture, texture.dimensions);
        }
        else if (texture.state === 'failed') {
            this.onTextureFailed(texture, texture.error);
        }
        else if (texture.state === 'freed') {
            this.onTextureFreed(texture);
        }
    };
    unloadTexture() {
        if (this.texture === null) {
            return;
        }
        const texture = this.texture;
        texture.off('loaded', this.onTextureLoaded);
        texture.off('failed', this.onTextureFailed);
        texture.off('freed', this.onTextureFreed);
        texture.setRenderableOwner(this._id, false);
        this.textureOwnership = false;
    }
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
    applyAutosizeDimensions(w, h) {
        const props = this.props;
        if (props.autosize === false) {
            return;
        }
        if (props.w === w && props.h === h) {
            return;
        }
        this.applySize(w, h);
    }
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
    applySize(w, h) {
        const props = this.props;
        props.w = w;
        props.h = h;
        this.setUpdateType(UpdateType.Local | UpdateType.RecalcUniforms);
    }
    /**
     * Recompute packed texture coords. They are a function of the texture and,
     * when textureOptions (resizeMode, clipX/clipY) are set, of the node's
     * dimensions — so a load, a resize or an options change must refresh them.
     */
    refreshTextureCoords() {
        const props = this.props;
        if (props.texture !== null &&
            this.stage.calculateTextureCoord === true &&
            props.textureOptions !== null) {
            this.textureCoords = this.stage.renderer.getTextureCoords(this);
        }
    }
    onTextureLoaded = (_, dimensions) => {
        this.applyAutosizeDimensions(dimensions.w, dimensions.h);
        this.refreshTextureCoords();
        this.textureLoaded = true;
        this.updatePlaceholderActive();
        this.setUpdateType(UpdateType.IsRenderable);
        // Texture was loaded. In case the RAF loop has already stopped, we request
        // a render to ensure the texture is rendered.
        this.stage.requestRender();
        // ignore 1x1 pixel textures
        if (dimensions.w > 1 && dimensions.h > 1) {
            this.emit('loaded', {
                type: 'texture',
                dimensions,
            });
        }
        // The contain transform depends on the texture's dimensions, which are
        // only known now.
        if (this._hasContainResize === true) {
            this.setUpdateType(UpdateType.Local);
        }
    };
    onTextureFailed = (_, error) => {
        // immediately set isRenderable to false, so that we handle the error
        // without waiting for the next frame loop. With a placeholder set, the
        // same frame's update pass recomputes this to true and renders the
        // placeholder instead.
        this.textureLoaded = false;
        this.isRenderable = false;
        this.updatePlaceholderActive();
        this.updateTextureOwnership(false);
        this.setUpdateType(UpdateType.IsRenderable);
        if (this.texture !== null &&
            this.texture.retryCount > this.texture.maxRetryCount) {
            this.emit('failed', {
                type: 'texture',
                error,
            });
        }
    };
    onTextureFreed = () => {
        // immediately set isRenderable to false, so that we handle the error
        // without waiting for the next frame loop. With a placeholder set, the
        // same frame's update pass recomputes this to true and renders the
        // placeholder while the texture reloads.
        this.textureLoaded = false;
        this.isRenderable = false;
        this.updatePlaceholderActive();
        this.updateTextureOwnership(false);
        this.setUpdateType(UpdateType.IsRenderable);
        this.emit('freed', {
            type: 'texture',
        });
    };
    //#endregion Textures
    /**
     * Change types types is used to determine the scope of the changes being applied
     *
     * @remarks
     * See {@link UpdateType} for more information on each type
     *
     * @param type
     */
    setUpdateType(type) {
        this.updateType |= type;
        const parent = this.props.parent;
        if (!parent || parent.updateType & UpdateType.Children)
            return;
        parent.setUpdateType(UpdateType.Children);
    }
    updateLocalTransform() {
        const p = this.props;
        const { x, y } = p;
        if (this.isSimple) {
            // A mount offset is a pure translation, so it is folded in here rather
            // than forcing the node (and, through _globalIsTranslate, its whole
            // subtree) onto the full-matrix path.
            let tx = x;
            let ty = y;
            if (this._hasMount === true) {
                tx = x - p.mountX * p.w;
                ty = y - p.mountY * p.h;
            }
            // Fast path: when localTransform is already in identity-shape
            // (ta=1, tb=0, tc=0, td=1), only tx/ty change between frames, so we
            // skip the 4 redundant field writes Matrix3d.translate would do.
            // _localIsTranslate becomes stale when a node was non-simple (had
            // rotation/scale/contain-resize) on a previous frame — in that case do
            // a full reset to identity-translate.
            if (this._localIsTranslate === true) {
                this.localTransform.setTranslate(tx, ty);
                return;
            }
            this.localTransform = Matrix3d.translate(tx, ty, this.localTransform);
            this._localIsTranslate = true;
            return;
        }
        const { w, h } = p;
        const mountTranslateX = p.mountX * w;
        const mountTranslateY = p.mountY * h;
        const rotation = p.rotation;
        const scaleX = p.scaleX;
        const scaleY = p.scaleY;
        if (rotation !== 0) {
            // Full rotation (+ optional scale + pivot)
            const scaleRotate = Matrix3d.rotate(rotation, Matrix3d.temp).scale(scaleX, scaleY);
            const pivotTranslateX = p.pivotX * w;
            const pivotTranslateY = p.pivotY * h;
            this.localTransform = Matrix3d.translate(x - mountTranslateX + pivotTranslateX, y - mountTranslateY + pivotTranslateY, this.localTransform)
                .multiply(scaleRotate)
                .translate(-pivotTranslateX, -pivotTranslateY);
        }
        else if (scaleX !== 1 || scaleY !== 1) {
            // Scale (+ optional pivot) without rotation — skip the rotate matrix
            // and the 8-mul multiply; `.scale()` is a 4-mul in-place op.
            const pivotTranslateX = p.pivotX * w;
            const pivotTranslateY = p.pivotY * h;
            this.localTransform = Matrix3d.translate(x - mountTranslateX + pivotTranslateX, y - mountTranslateY + pivotTranslateY, this.localTransform)
                .scale(scaleX, scaleY)
                .translate(-pivotTranslateX, -pivotTranslateY);
        }
        else {
            // Texture-contain only (mount alone never reaches here — it stays on the
            // simple path above) — pure translation before the contain adjustment.
            this.localTransform = Matrix3d.translate(x - mountTranslateX, y - mountTranslateY, this.localTransform);
        }
        // Handle 'contain' resize mode (cached check; dimensions still need
        // a runtime null-check because they're populated asynchronously).
        const texture = p.texture;
        if (this._hasContainResize === true &&
            texture !== null &&
            texture.dimensions !== null) {
            let resizeModeScaleX = 1;
            let resizeModeScaleY = 1;
            let extraX = 0;
            let extraY = 0;
            const { w: tw, h: th } = texture.dimensions;
            // _hasContainResize guarantees textureOptions.resizeMode is 'contain'
            const resizeMode = p.textureOptions.resizeMode;
            const txAspectRatio = tw / th;
            const nodeAspectRatio = w / h;
            if (txAspectRatio > nodeAspectRatio) {
                // Texture is wider than node
                // Align the node vertically (shift down by extraY, centered by default)
                // Scale the node vertically to maintain original aspect ratio
                const scaleX = w / tw;
                const scaledTxHeight = th * scaleX;
                extraY = (h - scaledTxHeight) * (resizeMode.y ?? 0.5);
                resizeModeScaleY = scaledTxHeight / h;
            }
            else {
                // Texture is taller than node (or equal)
                // Align the node horizontally (shift right by extraX, centered by default)
                // Scale the node horizontally to maintain original aspect ratio
                const scaleY = h / th;
                const scaledTxWidth = tw * scaleY;
                extraX = (w - scaledTxWidth) * (resizeMode.x ?? 0.5);
                resizeModeScaleX = scaledTxWidth / w;
            }
            // Apply the extra translation and scale to the local transform
            this.localTransform
                .translate(extraX, extraY)
                .scale(resizeModeScaleX, resizeModeScaleY);
        }
        this._localIsTranslate = false;
    }
    updateIsSimple() {
        const p = this.props;
        // Cache the texture-contain check so updateLocalTransform doesn't have to
        // run the optional-chain + string compare on every Local update.
        this._hasContainResize =
            p.texture !== null && p.textureOptions?.resizeMode?.type === 'contain';
        // Mount is deliberately absent from `isSimple`: it only ever contributes a
        // translation, which the simple path folds in via `_hasMount`.
        this._hasMount = p.mountX !== 0 || p.mountY !== 0;
        this.isSimple =
            p.rotation === 0 &&
                p.scaleX === 1 &&
                p.scaleY === 1 &&
                this._hasContainResize === false;
    }
    /**
     * @todo: test for correct calculation flag
     * @param delta
     */
    update(delta, parentClippingRect) {
        const props = this.props;
        //parent can be forced to ! because the root node update loop uses updateRoot which implies that
        //all other loops using this update method have a parent
        const parent = props.parent;
        let newRenderState = null;
        // Render state is derived, never stored as an update bit: it is raised
        // only by the Global and Clipping blocks below, both of which run in this
        // same pass. A local flag dedupes the `checkRenderBounds()` call when both
        // ran, and the out-of-bounds early return re-derives it from the Global /
        // Clipping bits it stores back.
        let checkRenderState = false;
        let updateType = this.updateType;
        let childUpdateType = this.childUpdateType;
        // reset update type
        this.updateType = 0;
        this.childUpdateType = 0;
        if (updateType & UpdateType.Local) {
            this.updateLocalTransform();
            updateType |= UpdateType.Global;
        }
        if (updateType & UpdateType.Global) {
            const lt = this.localTransform;
            const gt = this.globalTransform;
            const parentGT = parent.globalTransform;
            if (this.isSimple === true && parent._globalIsTranslate === true) {
                // Translate-only fast path: parent global and local are both pure
                // translations, so the resulting global is also a pure translation
                // and collapses to 2 adds on tx/ty.
                if (this._globalIsTranslate === false) {
                    // Transitioning back into translate-only — reset ta/tb/tc/td
                    // that may have been left non-identity by a prior frame. The flag
                    // is written here rather than unconditionally: in the steady state
                    // it is already `true` and the store is pure waste.
                    gt.ta = 1;
                    gt.tb = 0;
                    gt.tc = 0;
                    gt.td = 1;
                    this._globalIsTranslate = true;
                }
                gt.setTranslate(parentGT.tx + lt.tx, parentGT.ty + lt.ty);
            }
            else {
                // Reaching here is the negation of the condition above, so the
                // resulting global can never be translate-only — assign the constant
                // rather than recomputing the same conjunction.
                Matrix3d.copy(parentGT, gt);
                this._globalIsTranslate = false;
                if (this.isSimple === true) {
                    gt.translate(lt.tx, lt.ty);
                }
                else {
                    gt.translateOrMultiply(lt);
                }
            }
            this.updateGlobalGeometry();
            // RecalcUniforms is intentionally NOT set here: shader uniforms are a
            // function of resolvedProps + w/h only (that is exactly the shader
            // value-key cache key), so pure transform changes (translate, scale,
            // rotate) cannot affect them. The flag is raised where w/h actually
            // change: the w/h setters, autosize texture application, text layout
            // application, and the shader setter itself.
            checkRenderState = true;
            updateType |= UpdateType.Children;
            childUpdateType |= UpdateType.Global;
            if (props.clipping !== false) {
                updateType |= UpdateType.Clipping;
            }
        }
        if (updateType & UpdateType.Clipping) {
            this.calculateClippingRect(parentClippingRect);
            // The clipping rect is also the visible region culling tests run
            // against, so a change to it invalidates render state for this whole
            // subtree — this node included. Setting `checkRenderState` here is why
            // this block sits ahead of the render-state block.
            // Children inherit `Clipping` alone: each one's own Clipping block
            // raises its own render-state check.
            updateType |= UpdateType.Children;
            childUpdateType |= UpdateType.Clipping;
            checkRenderState = true;
        }
        if (checkRenderState === true) {
            newRenderState = this.checkRenderBounds();
            // Only a *changed* render state can change renderability. A node
            // translating inside the viewport re-derives the same classification
            // every frame, and `updateIsRenderable` would walk its whole input set
            // to reach the same answer — the dominant cost of a scroll frame.
            if (newRenderState !== this.renderState) {
                updateType |= UpdateType.IsRenderable;
                // if we're not going out of bounds, update the render state
                // this is done so the update loop can finish before we mark a node
                // as out of bounds
                if (newRenderState !== CoreNodeRenderState.OutOfBounds) {
                    this.updateRenderState(newRenderState);
                }
            }
            else {
                // Unchanged — clear it so the out-of-bounds tail below does not
                // re-apply a state this node already holds.
                newRenderState = null;
            }
        }
        // The other two inputs `updateIsRenderable` takes that render state does
        // not cover are `hasDimensions()` and the shader identity. Both are
        // exactly what RecalcUniforms marks: it is raised by the w/h setters,
        // autosize texture application, text layout application, the shader setter
        // and shader-prop writes, and by nothing else. Bridging here is a
        // conservative superset — shader-prop writes do not affect renderability
        // but are rare — and keeps the dimension dependency derived from an
        // existing flag rather than a second one every w/h writer must remember.
        if (updateType & UpdateType.RecalcUniforms) {
            updateType |= UpdateType.IsRenderable;
        }
        if (updateType & UpdateType.WorldAlpha) {
            this.worldAlpha =
                props.ignoreParentAlpha === true
                    ? props.alpha
                    : parent.worldAlpha * props.alpha;
            updateType |=
                UpdateType.PremultipliedColors |
                    UpdateType.Children |
                    UpdateType.IsRenderable;
            childUpdateType |= UpdateType.WorldAlpha;
        }
        if (updateType & UpdateType.IsRenderable) {
            this.updateIsRenderable();
        }
        if (updateType & UpdateType.PremultipliedColors) {
            const alpha = this.worldAlpha;
            if (this.placeholderActive === true) {
                // Placeholder rendering: all four corners take the placeholder color.
                // The quad samples the stage's default 1x1 white texture, so this is
                // exactly the color-rect path.
                const merged = premultiplyColorABGR(props.placeholderColor, alpha);
                this.premultipliedColorTl =
                    this.premultipliedColorTr =
                        this.premultipliedColorBl =
                            this.premultipliedColorBr =
                                merged;
            }
            else {
                const tl = props.colorTl;
                const tr = props.colorTr;
                const bl = props.colorBl;
                const br = props.colorBr;
                // Fast equality check (covers all 4 corners)
                const same = tl === tr && tl === bl && tl === br;
                const merged = premultiplyColorABGR(tl, alpha);
                this.premultipliedColorTl = merged;
                if (same === true) {
                    this.premultipliedColorTr =
                        this.premultipliedColorBl =
                            this.premultipliedColorBr =
                                merged;
                }
                else {
                    this.premultipliedColorTr = premultiplyColorABGR(tr, alpha);
                    this.premultipliedColorBl = premultiplyColorABGR(bl, alpha);
                    this.premultipliedColorBr = premultiplyColorABGR(br, alpha);
                }
            }
        }
        if (this.renderState === CoreNodeRenderState.OutOfBounds) {
            // Delay updating children until the node is in bounds.
            //
            // Only the blocks below this point are deferred: RecalcUniforms (the
            // shader update), Children, and SortZIndexChildren. Everything above —
            // Autosize, Local, Global, Clipping, WorldAlpha, IsRenderable,
            // PremultipliedColors — already ran this pass, so storing those bits
            // back would re-run completed work on every frame the parent keeps
            // updating (e.g. every off-screen card of a scrolling rail redoing its
            // local transform and its four color premultiplies).
            this.updateType =
                updateType &
                    (UpdateType.RecalcUniforms |
                        UpdateType.Children |
                        UpdateType.SortZIndexChildren);
            this.childUpdateType = childUpdateType;
            return;
        }
        if (updateType & UpdateType.RecalcUniforms &&
            this.hasShaderUpdater === true) {
            this.updateShaderUniforms = true;
        }
        if (this.isRenderable === true && this.updateShaderUniforms === true) {
            this.updateShaderUniforms = false;
            //this exists because the boolean hasShaderUpdater === true
            this.shader.update();
        }
        if (updateType & UpdateType.Children && this.children.length > 0) {
            const childClippingRect = this.clippingRect;
            const children = this.children;
            const length = children.length;
            if (childUpdateType !== 0) {
                // Specialized loop: OR-in the inherited update bits for every child,
                // then update if non-zero. Avoids the per-iter `childUpdateType !== 0`
                // compare.
                for (let i = 0; i < length; i++) {
                    const child = children[i];
                    child.updateType |= childUpdateType;
                    if (child.updateType === 0) {
                        continue;
                    }
                    child.update(delta, childClippingRect);
                }
            }
            else {
                // Specialized loop: nothing to inherit, so only walk children that
                // already have pending work of their own.
                for (let i = 0; i < length; i++) {
                    const child = children[i];
                    if (child.updateType === 0) {
                        continue;
                    }
                    child.update(delta, childClippingRect);
                }
            }
        }
        //Resort children if needed
        if (updateType & UpdateType.SortZIndexChildren) {
            // reorder z-index
            this.sortChildren();
        }
        // If we're out of bounds, apply the render state now
        // this is done so nodes can finish their entire update loop before
        // being marked as out of bounds
        if (newRenderState === CoreNodeRenderState.OutOfBounds) {
            this.updateRenderState(newRenderState);
            this.updateIsRenderable();
        }
    }
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
    checkRenderBounds() {
        const stage = this.stage;
        let x1 = 0;
        let y1 = 0;
        let x2 = stage.viewportW;
        let y2 = stage.viewportH;
        // Intersect with the clipping rect. Clipping rects are not clamped to the
        // viewport, so an off-screen clipping container must not hand its subtree
        // a visible region that sits outside the screen. The intersection can come
        // out empty (x1 > x2); the tests below still pass for bounds spanning the
        // crossed interval, so children of a fully off-screen clipper can classify
        // InViewport/InBounds. That over-classification matches pre-1.8 behavior
        // (the scissor keeps them invisible) and preserves the preload runway for
        // clippers sitting just outside the viewport; do not "fix" it with an
        // empty-interval early-out without measuring the preload impact.
        const cr = this.clippingRect;
        if (cr.valid === true) {
            if (cr.x > x1) {
                x1 = cr.x;
            }
            if (cr.y > y1) {
                y1 = cr.y;
            }
            const crX2 = cr.x + cr.w;
            if (crX2 < x2) {
                x2 = crX2;
            }
            const crY2 = cr.y + cr.h;
            if (crY2 < y2) {
                y2 = crY2;
            }
        }
        const rb = this.renderBound;
        if (rb.x1 <= x2 && rb.x2 >= x1 && rb.y1 <= y2 && rb.y2 >= y1) {
            return CoreNodeRenderState.InViewport;
        }
        const m = stage.boundsMargin;
        if (rb.x1 <= x2 + m[1] &&
            rb.x2 >= x1 - m[3] &&
            rb.y1 <= y2 + m[2] &&
            rb.y2 >= y1 - m[0]) {
            return CoreNodeRenderState.InBounds;
        }
        // check if we dont have dimensions, take our parent's render state
        if (this.parent !== null && (this.props.w === 0 || this.props.h === 0)) {
            return this.parent.renderState;
        }
        return CoreNodeRenderState.OutOfBounds;
    }
    updateRenderState(renderState) {
        if (renderState === this.renderState) {
            return;
        }
        const previous = this.renderState;
        this.renderState = renderState;
        // If node visibility changes, dirty the render list cache
        if (renderState === CoreNodeRenderState.OutOfBounds ||
            previous === CoreNodeRenderState.OutOfBounds) {
            this.stage.requestRenderListUpdate();
        }
        if (EMIT_BOUNDS_EVENTS) {
            // Viewport entry/exit is the whole observable surface. `InBounds` stays
            // internal: it exists so textures preload a margin ahead of the node
            // scrolling on screen, which is engine bookkeeping rather than something
            // an app acts on. Exit fires for InViewport -> InBounds and
            // InViewport -> OutOfBounds alike.
            if (renderState === CoreNodeRenderState.InViewport) {
                this.emit('inViewport', {
                    previous,
                    current: renderState,
                });
            }
            else if (previous === CoreNodeRenderState.InViewport) {
                this.emit('outOfViewport', {
                    previous,
                    current: renderState,
                });
            }
        }
    }
    /**
     * Checks if the node is renderable based on world alpha, dimensions and out of bounds status.
     */
    checkBasicRenderability() {
        if (this.worldAlpha === 0 || this.isOutOfBounds() === true) {
            return false;
        }
        else {
            return true;
        }
    }
    /**
     * Updates the `isRenderable` property based on various conditions.
     */
    updateIsRenderable() {
        let newIsRenderable = false;
        let needsTextureOwnership = false;
        // If the node is out of bounds or has an alpha of 0, it is not renderable
        if (this.checkBasicRenderability() === false) {
            this.updateTextureOwnership(false);
            this.setRenderable(false);
            return;
        }
        // `texture` is a getter over props — read it once.
        const texture = this.props.texture;
        if (texture !== null) {
            // preemptive check for failed textures this will mark the current node as non-renderable
            // and will prevent further checks until the texture is reloaded or retry is reset on the texture
            if (texture.retryCount > texture.maxRetryCount) {
                // texture has failed to load, we cannot render the texture itself —
                // but a placeholder color still renders in its place
                this.updateTextureOwnership(false);
                this.setRenderable(this.placeholderActive === true &&
                    this.renderState === CoreNodeRenderState.InViewport);
                return;
            }
            needsTextureOwnership = true;
            // Use cached boolean instead of string comparison; a placeholder
            // renders while the texture is loading
            newIsRenderable =
                this.textureLoaded === true || this.placeholderActive === true;
        }
        else if (
        // check shader
        (this.props.shader !== this.stage.defShaderNode ||
            this.hasColorProps === true) &&
            // check dimensions
            this.hasDimensions() === true) {
            // This mean we have dimensions and a color set, so we can render a ColorTexture
            newIsRenderable = true;
        }
        // Nodes in the preload margin keep texture ownership above (so loading
        // proceeds) but stay out of the render list until they actually intersect
        // the visible region — the margin is a loading runway, not a render area.
        if (newIsRenderable === true &&
            this.renderState !== CoreNodeRenderState.InViewport) {
            newIsRenderable = false;
        }
        this.updateTextureOwnership(needsTextureOwnership);
        this.setRenderable(newIsRenderable);
    }
    /**
     * Sets the renderable state and triggers changes if necessary.
     * @param isRenderable - The new renderable state
     */
    setRenderable(isRenderable) {
        const previousIsRenderable = this.isRenderable;
        this.isRenderable = isRenderable;
        // Emit event if renderable status has changed
        if (previousIsRenderable !== isRenderable) {
            this.stage.requestRenderListUpdate();
            if (EMIT_BOUNDS_EVENTS) {
                this.emit('renderable', {
                    type: 'renderable',
                    isRenderable,
                });
            }
        }
    }
    /**
     * Changes the renderable state of the node.
     */
    updateTextureOwnership(isRenderable) {
        if (this.textureOwnership === isRenderable) {
            return;
        }
        this.textureOwnership = isRenderable;
        this.texture?.setRenderableOwner(this._id, isRenderable);
    }
    /**
     * Checks if the node is out of the viewport bounds.
     */
    isOutOfBounds() {
        return this.renderState <= CoreNodeRenderState.OutOfBounds;
    }
    /**
     * Checks if the node has dimensions (width/height)
     */
    hasDimensions() {
        return this.props.w !== 0 && this.props.h !== 0;
    }
    /**
     * Recompute `renderCoords` and `renderBound` from `globalTransform` + w/h.
     *
     * @remarks
     * Both are derived from the same four corners, so the Global update block
     * produces them in a single pass. Computing them separately re-loads
     * `globalTransform`, re-tests the axis-aligned case, and reads the corners
     * back out of `renderCoords` only to write the same numbers into the bound.
     */
    updateGlobalGeometry() {
        const { w, h } = this.props;
        const g = this.globalTransform;
        const tx = g.tx;
        const ty = g.ty;
        const tb = g.tb;
        const tc = g.tc;
        if (tb === 0 && tc === 0) {
            // Axis-aligned: the quad is its own bounding box, so the four corners
            // and the bound both fall out of the same two extents.
            const maxX = tx + w * g.ta;
            const maxY = ty + h * g.td;
            this.renderCoords = RenderCoords.translate(
            //top-left
            tx, ty, 
            //top-right
            maxX, ty, 
            //bottom-right
            maxX, maxY, 
            //bottom-left
            tx, maxY, this.renderCoords);
            this.renderBound = createBound(tx, ty, maxX, maxY, this.renderBound);
            return;
        }
        // Rotated/skewed: corners are grouped so each is reused by the next
        // (x3 = x2 + h * tb), which keeps the arithmetic bit-identical to the
        // left-to-right evaluation it replaces.
        const x2 = tx + w * g.ta;
        const y2 = ty + w * tc;
        const x3 = x2 + h * tb;
        const y3 = y2 + h * g.td;
        const x4 = tx + h * tb;
        const y4 = ty + h * g.td;
        this.renderCoords = RenderCoords.translate(tx, ty, x2, y2, x3, y3, x4, y4, this.renderCoords);
        this.renderBound = createBound(Math.min(tx, x2, x3, x4), Math.min(ty, y2, y3, y4), Math.max(tx, x2, x3, x4), Math.max(ty, y2, y3, y4), this.renderBound);
    }
    /**
     * This function calculates the clipping rectangle for a node.
     *
     * The function then checks if the node is rotated. If the node requires clipping and is not rotated, a new clipping rectangle is created based on the node's global transform and dimensions.
     * If a parent clipping rectangle exists, it is intersected with the node's clipping rectangle (if it exists), or replaces the node's clipping rectangle.
     *
     * Finally, the node's parentClippingRect and clippingRect properties are updated.
     */
    calculateClippingRect(parentClippingRect) {
        const { props, globalTransform: gt } = this;
        const { clipping } = props;
        const isRotated = gt.tb !== 0 || gt.tc !== 0;
        const nodeClips = clipping !== false && isRotated === false;
        // Common case: this node doesn't clip and no ancestor clip rect needs to
        // propagate. No node-owned rect is required, so point at the shared
        // invalid default and skip the allocation entirely.
        if (nodeClips === false && parentClippingRect.valid === false) {
            this.clippingRect = NO_CLIPPING_RECT;
            return;
        }
        // A node-owned, mutable rect is needed. Allocate one lazily the first time
        // (the default shares NO_CLIPPING_RECT, which must never be written to).
        let clippingRect = this.clippingRect;
        if (clippingRect === NO_CLIPPING_RECT) {
            clippingRect = this.clippingRect = {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
                valid: false,
                scissorX: 0,
                scissorY: 0,
                scissorW: 0,
                scissorH: 0,
            };
        }
        if (nodeClips === true) {
            let mT = 0;
            let mR = 0;
            let mB = 0;
            let mL = 0;
            if (Array.isArray(clipping) === true) {
                mT = clipping[0];
                mR = clipping[1];
                mB = clipping[2];
                mL = clipping[3];
            }
            clippingRect.x = gt.tx - mL;
            clippingRect.y = gt.ty - mT;
            clippingRect.w = this.props.w * gt.ta + mL + mR;
            clippingRect.h = this.props.h * gt.td + mT + mB;
            clippingRect.valid = true;
        }
        else {
            clippingRect.valid = false;
        }
        if (parentClippingRect.valid === true && clippingRect.valid === true) {
            // Intersect parent clipping rect with node clipping rect
            intersectRect(parentClippingRect, clippingRect, clippingRect);
        }
        else if (parentClippingRect.valid === true) {
            // Copy parent clipping rect
            copyRect(parentClippingRect, clippingRect);
            clippingRect.valid = true;
        }
        if (clippingRect.valid === true) {
            const stage = this.stage;
            updateScissor(clippingRect, stage.pixelRatio, stage.canvasH);
        }
    }
    /**
     * Destroy the node and cleanup all resources
     */
    destroy(isChild = false) {
        if (this.destroyed === true || this.preventDestroy === true) {
            if (isChild && this.preventDestroy === true) {
                this.props.parent = null;
            }
            return;
        }
        this.destroyed = true;
        // Detach from parent first to stop propagation of updates
        if (isChild === false) {
            const parent = this.parent;
            if (parent !== null) {
                parent.removeChild(this);
            }
            this.props.parent = null;
            this.stage.requestRender();
        }
        this.removeAllListeners();
        this.unloadTexture();
        this.isRenderable = false;
        if (this.hasShaderTimeFn === true) {
            this.stage.untrackTimedNode(this);
        }
        // Release this node's shader-value cache entry so the shader manager's idle
        // cleanup can reclaim it. Skip the shared default shader (never per-node).
        const shader = this.props.shader;
        if (shader !== null && shader !== this.stage.defShaderNode) {
            shader.detachNode();
        }
        // Kill children
        for (let i = 0, n = this.children.length; i < n; i++) {
            this.children[i].destroy(true);
        }
        this.children.length = 0;
        this.props.texture = null;
    }
    renderQuads(renderer) {
        // Resolve the render texture once and hand it to the renderer: `addQuad`
        // needs the exact same texture, and re-deriving it there costs a second
        // placeholder branch plus the props/stage loads for every quad, every
        // frame.
        const texture = this.renderTexture;
        // Check that we have a valid texture (or the stage default) to render.
        if (texture.state !== 'loaded') {
            return;
        }
        renderer.addQuad(this, texture);
    }
    get renderTexture() {
        if (this.placeholderActive === true) {
            return this.stage.defaultTexture;
        }
        return this.props.texture || this.stage.defaultTexture;
    }
    get renderTextureCoords() {
        return this.textureCoords || this.stage.renderer.defaultTextureCoords;
    }
    get width() {
        return this.props.w;
    }
    get height() {
        return this.props.h;
    }
    get time() {
        if (this.hasShaderTimeFn === true) {
            return this.getTimerValue();
        }
        return 0;
    }
    getTimerValue() {
        const shader = this.shader;
        if (typeof shader.time === 'function') {
            return shader.time(this.stage, shader.resolvedProps);
        }
        return this.stage.elapsedTime;
    }
    sortChildren() {
        sortByZIndexStable(this.children);
        this.stage.requestRenderListUpdate();
    }
    removeChild(node) {
        removeChild(node, this.children);
        this.stage.requestRenderListUpdate();
    }
    addChild(node) {
        const children = this.children;
        children.push(node);
        // check if we need to sort
        const lastIndex = children.length - 1;
        let shouldSort = node.zIndex !== 0;
        if (shouldSort === false && lastIndex > 0) {
            // If the new node has zIndex 0, we check if any existing children have (had) non-zero zIndex.
            // Since children are sorted, we only need to check the first and the last (before the new one).
            // The new node is at `lastIndex`. The previous last node is at `lastIndex - 1`.
            const first = children[0];
            const last = children[lastIndex - 1];
            shouldSort = first.zIndex !== 0 || last.zIndex !== 0;
        }
        if (shouldSort) {
            this.setUpdateType(UpdateType.SortZIndexChildren);
        }
        this.setUpdateType(UpdateType.Children);
        this.stage.requestRenderListUpdate();
    }
    //#region Properties
    get id() {
        return this._id;
    }
    get data() {
        return this.props.data;
    }
    set data(d) {
        this.props.data = d;
    }
    get x() {
        return this.props.x;
    }
    set x(value) {
        if (this.props.x !== value) {
            this.props.x = value;
            this.setUpdateType(UpdateType.Local);
        }
    }
    get absX() {
        return (this.props.x +
            -this.props.w * this.props.mountX +
            (this.props.parent?.absX || this.props.parent?.globalTransform?.tx || 0));
    }
    get absY() {
        return (this.props.y +
            -this.props.h * this.props.mountY +
            (this.props.parent?.absY || this.props.parent?.globalTransform?.ty || 0));
    }
    get y() {
        return this.props.y;
    }
    set y(value) {
        if (this.props.y !== value) {
            this.props.y = value;
            this.setUpdateType(UpdateType.Local);
        }
    }
    get w() {
        return this.props.w;
    }
    set w(value) {
        const props = this.props;
        if (props.w !== value) {
            this.applySize(value, props.h);
            this.refreshTextureCoords();
        }
    }
    get h() {
        return this.props.h;
    }
    set h(value) {
        const props = this.props;
        if (props.h !== value) {
            this.applySize(props.w, value);
            this.refreshTextureCoords();
        }
    }
    get scale() {
        // The CoreNode `scale` property is only used by Animations.
        // Unlike INode, `null` should never be possibility for Animations.
        return this.scaleX;
    }
    set scale(value) {
        // The CoreNode `scale` property is only used by Animations.
        // Unlike INode, `null` should never be possibility for Animations.
        this.scaleX = value;
        this.scaleY = value;
        this.updateIsSimple();
    }
    get scaleX() {
        return this.props.scaleX;
    }
    set scaleX(value) {
        if (this.props.scaleX !== value) {
            this.props.scaleX = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get scaleY() {
        return this.props.scaleY;
    }
    set scaleY(value) {
        if (this.props.scaleY !== value) {
            this.props.scaleY = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get mount() {
        // `props.mount` is only the shorthand that seeded mountX/mountY; the
        // per-axis setters don't update it. Read the live value, as `scale` reads
        // scaleX.
        return this.props.mountX;
    }
    set mount(value) {
        if (this.props.mountX !== value || this.props.mountY !== value) {
            this.props.mountX = value;
            this.props.mountY = value;
            this.props.mount = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get mountX() {
        return this.props.mountX;
    }
    set mountX(value) {
        if (this.props.mountX !== value) {
            this.props.mountX = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get mountY() {
        return this.props.mountY;
    }
    set mountY(value) {
        if (this.props.mountY !== value) {
            this.props.mountY = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get pivot() {
        // See `mount`: the per-axis setters don't update `props.pivot`.
        return this.props.pivotX;
    }
    set pivot(value) {
        if (this.props.pivotX !== value || this.props.pivotY !== value) {
            this.props.pivotX = value;
            this.props.pivotY = value;
            this.props.pivot = value;
            this.setUpdateType(UpdateType.Local);
        }
    }
    get pivotX() {
        return this.props.pivotX;
    }
    set pivotX(value) {
        if (this.props.pivotX !== value) {
            this.props.pivotX = value;
            this.setUpdateType(UpdateType.Local);
        }
    }
    get pivotY() {
        return this.props.pivotY;
    }
    set pivotY(value) {
        if (this.props.pivotY !== value) {
            this.props.pivotY = value;
            this.setUpdateType(UpdateType.Local);
        }
    }
    get rotation() {
        return this.props.rotation;
    }
    set rotation(value) {
        if (this.props.rotation !== value) {
            this.props.rotation = value;
            this.setUpdateType(UpdateType.Local);
            this.updateIsSimple();
        }
    }
    get alpha() {
        return this.props.alpha;
    }
    set alpha(value) {
        if (this.props.alpha === value) {
            return;
        }
        this.props.alpha = value;
        // The WorldAlpha block in update() derives PremultipliedColors, Children,
        // IsRenderable and `childUpdateType |= WorldAlpha` from this one bit.
        this.setUpdateType(UpdateType.WorldAlpha);
    }
    get ignoreParentAlpha() {
        return this.props.ignoreParentAlpha;
    }
    set ignoreParentAlpha(value) {
        if (this.props.ignoreParentAlpha === value) {
            return;
        }
        this.props.ignoreParentAlpha = value;
        // See `set alpha` — the WorldAlpha block derives the rest.
        this.setUpdateType(UpdateType.WorldAlpha);
    }
    get autosize() {
        return this.props.autosize;
    }
    set autosize(value) {
        if (this.props.autosize === value) {
            return;
        }
        this.props.autosize = value;
        // Turning autosize on after the texture already loaded must still size the
        // node — the load event that would have applied it has been and gone.
        if (value === true) {
            const texture = this.props.texture;
            if (texture !== null && texture.dimensions !== null) {
                const { w, h } = texture.dimensions;
                this.applyAutosizeDimensions(w, h);
                this.refreshTextureCoords();
            }
        }
    }
    get clipping() {
        return this.props.clipping;
    }
    set clipping(value) {
        if (this.props.clipping === value) {
            return;
        }
        this.props.clipping = value;
        // Toggling clipping moves nothing, so descendants keep their global
        // transforms — calculateClippingRect reads the already-current one. The
        // Clipping block raises `Children` on this node and hands `Clipping` down,
        // so this bit alone drives the whole subtree.
        this.setUpdateType(UpdateType.Clipping);
    }
    get color() {
        return this.props.color;
    }
    set color(value) {
        const p = this.props;
        if (p.color === value)
            return;
        p.color = value;
        // Fan out to the edge and corner props directly: routing through the
        // public setters would recompute hasColorProps and raise
        // PremultipliedColors once per setter, up to nine times for this one
        // write (the color-animation path hits this every frame). The single
        // recompute and raise below observe the same final corner state.
        p.colorTop = value;
        p.colorBottom = value;
        p.colorLeft = value;
        p.colorRight = value;
        p.colorTl = value;
        p.colorTr = value;
        p.colorBl = value;
        p.colorBr = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
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
    computeHasColorProps() {
        const p = this.props;
        return p.colorTl > 0 || p.colorTr > 0 || p.colorBl > 0 || p.colorBr > 0;
    }
    /**
     * Recompute {@link hasColorProps} after a colour write.
     *
     * @remarks
     * Deriving from a single written component is wrong — clearing one corner
     * must not report "no colour" while the other three are opaque.
     * `IsRenderable` is raised only when the flag actually flips, since that is
     * the only input `updateIsRenderable` takes from it.
     */
    updateHasColorProps() {
        const has = this.computeHasColorProps();
        if (has === this.hasColorProps) {
            return;
        }
        this.hasColorProps = has;
        this.setUpdateType(UpdateType.IsRenderable);
    }
    get placeholderColor() {
        return this.props.placeholderColor;
    }
    set placeholderColor(value) {
        const p = this.props;
        if (p.placeholderColor === value)
            return;
        p.placeholderColor = value;
        this.updatePlaceholderActive();
        // If the placeholder is (still) showing, the new color must reach the
        // quad buffer even though the active state did not toggle.
        if (this.placeholderActive === true) {
            this.setUpdateType(UpdateType.PremultipliedColors);
        }
    }
    get colorTop() {
        return this.props.colorTop;
    }
    set colorTop(value) {
        const p = this.props;
        // Corner props are written directly, not through their setters, so this
        // setter's own recompute and raise below run once instead of three times.
        if (p.colorTl !== value || p.colorTr !== value) {
            p.colorTl = value;
            p.colorTr = value;
        }
        p.colorTop = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorBottom() {
        return this.props.colorBottom;
    }
    set colorBottom(value) {
        const p = this.props;
        if (p.colorBl !== value || p.colorBr !== value) {
            p.colorBl = value;
            p.colorBr = value;
        }
        p.colorBottom = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorLeft() {
        return this.props.colorLeft;
    }
    set colorLeft(value) {
        const p = this.props;
        if (p.colorTl !== value || p.colorBl !== value) {
            p.colorTl = value;
            p.colorBl = value;
        }
        p.colorLeft = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorRight() {
        return this.props.colorRight;
    }
    set colorRight(value) {
        const p = this.props;
        if (p.colorTr !== value || p.colorBr !== value) {
            p.colorTr = value;
            p.colorBr = value;
        }
        p.colorRight = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorTl() {
        return this.props.colorTl;
    }
    set colorTl(value) {
        this.props.colorTl = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorTr() {
        return this.props.colorTr;
    }
    set colorTr(value) {
        this.props.colorTr = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorBl() {
        return this.props.colorBl;
    }
    set colorBl(value) {
        this.props.colorBl = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get colorBr() {
        return this.props.colorBr;
    }
    set colorBr(value) {
        this.props.colorBr = value;
        this.updateHasColorProps();
        this.setUpdateType(UpdateType.PremultipliedColors);
    }
    get zIndex() {
        return this.props.zIndex;
    }
    set zIndex(value) {
        let sanitizedValue = value;
        if (isNaN(sanitizedValue) || Number.isFinite(sanitizedValue) === false) {
            console.warn(`zIndex was set to an invalid value: ${value}, defaulting to 0`);
            sanitizedValue = 0;
        }
        //Clamp to safe integer range
        if (sanitizedValue > Number.MAX_SAFE_INTEGER) {
            sanitizedValue = 1000;
        }
        else if (sanitizedValue < Number.MIN_SAFE_INTEGER) {
            sanitizedValue = -1000;
        }
        if (this.props.zIndex === sanitizedValue) {
            return;
        }
        this.props.zIndex = sanitizedValue;
        const parent = this.parent;
        if (parent !== null) {
            parent.setUpdateType(UpdateType.SortZIndexChildren);
        }
    }
    get parent() {
        return this.props.parent;
    }
    set parent(newParent) {
        const oldParent = this.props.parent;
        if (oldParent === newParent) {
            return;
        }
        this.props.parent = newParent;
        if (oldParent !== null) {
            oldParent.removeChild(this);
        }
        if (newParent !== null) {
            newParent.addChild(this);
        }
        // A new parent means a new global transform and, since the clipping rect
        // is inherited, a new visible region — both feed render state. worldAlpha
        // is inherited too (parent.worldAlpha * alpha), so it has to be re-derived
        // against the new parent; its block hands WorldAlpha down to descendants.
        this.setUpdateType(UpdateType.Global | UpdateType.Clipping | UpdateType.WorldAlpha);
    }
    get preventDestroy() {
        return this.props.preventDestroy;
    }
    set preventDestroy(value) {
        this.props.preventDestroy = value;
    }
    get shader() {
        return this.props.shader;
    }
    set shader(shader) {
        // Null means "use the stage's default shader".  Handle this before the
        // equality short-circuit so that `set shader(null)` still applies the
        // default when `props.shader` is also null (e.g. when a framework
        // adopted a freshly-allocated props bag where shader was cleared).
        if (shader === null) {
            const def = this.stage.defShaderNode;
            if (this.props.shader === def)
                return;
            this.hasShaderUpdater = false;
            this.hasShaderTimeFn = false;
            this.stage.untrackTimedNode(this);
            this.props.shader = def;
            this.setUpdateType(UpdateType.IsRenderable);
            return;
        }
        if (this.props.shader === shader) {
            return;
        }
        this.hasShaderUpdater = shader.update !== undefined;
        this.hasShaderTimeFn = shader.time !== undefined;
        if (shader.shaderKey !== 'default') {
            shader.attachNode(this);
        }
        if (this.hasShaderTimeFn === true) {
            this.stage.trackTimedNode(this);
        }
        else {
            this.stage.untrackTimedNode(this);
        }
        this.props.shader = shader;
        this.setUpdateType(UpdateType.IsRenderable | UpdateType.RecalcUniforms);
    }
    get src() {
        return this.props.src;
    }
    set src(imageUrl) {
        if (this.props.src === imageUrl) {
            return;
        }
        this.props.src = imageUrl;
        if (!imageUrl) {
            this.texture = null;
            return;
        }
        // A non-string source has no identity of its own, so without a `srcKey` the
        // texture is left out of the keyCache: no dedupe between two Nodes showing
        // the same bytes, and no reachability from the memory manager's cache
        // sweep, which leaves its upload resident until memory pressure frees it.
        // Silent in production, where the check is dead weight on a path that is
        // about to do a fetch anyway.
        if (isProductionEnvironment === false &&
            typeof imageUrl !== 'string' &&
            (this.props.srcKey === null || this.props.srcKey === undefined)) {
            console.warn('[CoreNode] A non-string `src` needs a `srcKey` to be cached. Set one before `src`.');
        }
        this.texture = this.stage.txManager.createTexture('ImageTexture', {
            src: imageUrl,
            key: this.props.srcKey,
            w: this.props.w,
            h: this.props.h,
            type: this.props.imageType,
            sx: this.props.srcX,
            sy: this.props.srcY,
            sw: this.props.srcWidth,
            sh: this.props.srcHeight,
        });
    }
    get srcKey() {
        return this.props.srcKey ?? null;
    }
    set srcKey(value) {
        this.props.srcKey = value;
    }
    set imageType(type) {
        if (this.props.imageType === type) {
            return;
        }
        this.props.imageType = type;
    }
    get imageType() {
        return this.props.imageType || null;
    }
    get srcHeight() {
        return this.props.srcHeight;
    }
    set srcHeight(value) {
        this.props.srcHeight = value;
    }
    get srcWidth() {
        return this.props.srcWidth;
    }
    set srcWidth(value) {
        this.props.srcWidth = value;
    }
    get srcX() {
        return this.props.srcX;
    }
    set srcX(value) {
        this.props.srcX = value;
    }
    get srcY() {
        return this.props.srcY;
    }
    set srcY(value) {
        this.props.srcY = value;
    }
    get texture() {
        return this.props.texture;
    }
    set texture(value) {
        if (this.props.texture === value) {
            return;
        }
        const oldTexture = this.props.texture;
        if (oldTexture) {
            this.unloadTexture();
        }
        this.textureCoords = undefined;
        this.props.texture = value;
        this.textureLoaded = value !== null && value.state === 'loaded';
        this.updatePlaceholderActive();
        if (value !== null) {
            value.setRenderableOwner(this._id, this.isRenderable);
            this.textureOwnership = this.isRenderable;
            this.loadTexture();
        }
        this.setUpdateType(UpdateType.IsRenderable);
        this.updateIsSimple();
    }
    set textureOptions(value) {
        this.props.textureOptions = value;
        this.refreshTextureCoords();
        this.setUpdateType(UpdateType.IsRenderable);
        const wasContain = this._hasContainResize;
        this.updateIsSimple();
        // The contain transform (scale + x/y alignment) lives in localTransform,
        // so entering, leaving or re-aligning contain must recompute it.
        if (wasContain === true || this._hasContainResize === true) {
            this.setUpdateType(UpdateType.Local);
        }
    }
    get textureOptions() {
        return this.props.textureOptions;
    }
    get componentName() {
        return this.props.componentName;
    }
    get componentLocation() {
        return this.props.componentLocation;
    }
    animate(props, settings) {
        return createAnimation(this.stage.animationManager, this, props, settings);
    }
    animateProp(name, value, settings) {
        let animations = this._animations;
        if (animations !== null) {
            const existing = animations[name];
            if (existing && existing.settings === settings) {
                const controller = existing.controller;
                const values = controller.props ? controller.props[name] : null;
                if (values) {
                    values.start = this[name] ?? 0;
                    values.target = value;
                    controller.progress = 0;
                    if (settings.adaptiveDuration === true) {
                        const now = performance.now();
                        const elapsed = now - controller.lastRunTime;
                        controller.lastRunTime = now;
                        const duration = settings.duration ?? controller.duration;
                        controller.duration = elapsed < duration ? elapsed : duration;
                    }
                    return controller.start();
                }
            }
        }
        else {
            animations = this._animations = {};
        }
        const animationProps = { [name]: value };
        const controller = createAnimation(this.stage.animationManager, this, animationProps, settings);
        animations[name] = { controller, settings };
        return controller.start();
    }
    animateToTarget(prop) {
        const animations = this._animations;
        if (animations === null) {
            return undefined;
        }
        const animation = animations[prop];
        if (!animation) {
            return undefined;
        }
        return animation.controller.props?.[prop]?.target;
    }
    draw(renderer) {
        const glw = renderer.glw;
        const shader = this.props.shader;
        renderer.useShader(shader.program);
        shader.program.bindRenderOp(this, renderer.quadBufferCollection);
        // Clipping: the scissor box was derived when the rect was written
        const cr = this.clippingRect;
        if (cr.valid === true) {
            glw.setScissorTest(true);
            glw.scissor(cr.scissorX, cr.scissorY, cr.scissorW, cr.scissorH);
        }
        else {
            glw.setScissorTest(false);
        }
        // renderOpBufferIdx counts 32-bit words; WORDS_PER_QUAD converts words to
        // quads (RendererUtils is pure constants and type-only imports, so the
        // Canvas2D build pays nothing for it). 6 Uint16 indices per quad, 2 bytes
        // each.
        const quadIdx = (this.renderOpBufferIdx / WORDS_PER_QUAD) * 6 * 2;
        glw.drawElements(glw.TRIANGLES, 6 * this.numQuads, glw.UNSIGNED_SHORT, quadIdx);
    }
}
//# sourceMappingURL=CoreNode.js.map