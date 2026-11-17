import { EventEmitter } from '../../common/EventEmitter.js';
import { Animation } from '../animation/Animation.js';
import type { AnimationSettings, IAnimationController, NodeImageState, RenderStateValue, TextureOptions } from '../../common/types.js';
import type { NodeStore } from './NodeStore.js';
import type { ShaderNode } from '../shaders/ShaderNode.js';
import type { Texture } from '../textures/Texture.js';
import type { TextureNodes } from '../textures/TextureNodes.js';
import type { AnimateProps } from '../animation/Animation.js';
import type { AnimationManager } from '../animation/AnimationManager.js';
import type { ClipStore } from '../scene/ClipStore.js';
/** What a handle needs from its renderer. `RendererCore` implements it. */
export interface NodeOwner {
    readonly nodes: NodeStore;
    readonly animationManager: AnimationManager;
    readonly clips: ClipStore;
    /** `node.imageState` reads its texture state through it. */
    readonly textureNodes: TextureNodes;
}
export type ClippingValue = boolean | [number, number, number, number];
/** 1.10's clipping rect: logical pixels; `valid: false` when nothing clips. */
export interface RectWithValid {
    valid: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
}
export type ImageType = 'regular' | 'compressed' | 'svg' | null;
export interface NodeExtras {
    srcX: number | undefined;
    srcY: number | undefined;
    srcWidth: number | undefined;
    srcHeight: number | undefined;
    imageType: ImageType | undefined;
    componentName: string | undefined;
    componentLocation: string | undefined;
    atlasGroup: string | undefined;
}
export interface INodeProps {
    x: number;
    y: number;
    w: number;
    h: number;
    alpha: number;
    color: number;
    colorTop: number;
    colorBottom: number;
    colorLeft: number;
    colorRight: number;
    colorTl: number;
    colorTr: number;
    colorBl: number;
    colorBr: number;
    scale: number | null;
    scaleX: number;
    scaleY: number;
    rotation: number;
    mount: number;
    mountX: number;
    mountY: number;
    pivot: number;
    pivotX: number;
    pivotY: number;
    zIndex: number;
    clipping: ClippingValue;
    parent: Node | null;
    ignoreParentAlpha: boolean;
    placeholderColor: number;
    autosize: boolean;
    /**
     * The layout direction of this node's children: true lays them out
     * mirrored (a child's x is measured from this node's right edge, its
     * mount and pivot flipped), false lays them out left to right, null (the
     * default) inherits the parent's. A node's own placement follows its
     * parent's resolved direction; its own value governs its children and,
     * for a text node, its left/right alignment. Reads back as written.
     */
    rtl: boolean | null;
    data: Record<string, unknown> | null;
    src: string | null;
    srcX?: number;
    srcY?: number;
    srcWidth?: number;
    srcHeight?: number;
    imageType?: ImageType;
    textureOptions: TextureOptions;
    texture: Texture | null;
    shader: object | null;
    componentName?: string;
    componentLocation?: string;
    /**
     * With the `imageAtlas` setting: images shown in this node's subtree go
     * onto atlas pages of this group only, so a row's images share pages,
     * batch together and are freed together. The nearest ancestor (or the
     * node itself) that sets one decides, when the image is uploaded; an
     * image already on a page stays there. Unset everywhere: one shared
     * group. Inert without the setting.
     */
    atlasGroup?: string;
}
export interface AnimationSlot {
    controller: Animation;
    settings: Partial<AnimationSettings>;
}
/**
 * A node handle: four own fields (`id`, `renderer`, `_uid`, and the lazily
 * allocated listener map inherited from EventEmitter); everything else is
 * an accessor over the store. See spec section 5.2.
 */
export declare class Node extends EventEmitter {
    id: number;
    readonly renderer: NodeOwner;
    private readonly _uid;
    /**
     * The node's element in the inspector's DOM mirror, while an inspector
     * is attached to its renderer (`@solidtv/renderer/inspector`); undefined
     * otherwise. A prototype accessor the inspector installs: no field.
     */
    readonly div: HTMLElement | undefined;
    constructor(renderer: NodeOwner, id: number);
    get uid(): number;
    get destroyed(): boolean;
    /**
     * 1.10's `node.stage`: the renderer (spec 12.2), its root included, as
     * 1.10's Stage had it (Solid's scroller reads `node.stage.root`).
     */
    get stage(): NodeOwner & {
        readonly root: Node;
    };
    get x(): number;
    set x(v: number);
    get y(): number;
    set y(v: number);
    get w(): number;
    set w(v: number);
    get h(): number;
    set h(v: number);
    get width(): number;
    get height(): number;
    get alpha(): number;
    set alpha(v: number);
    get rotation(): number;
    set rotation(v: number);
    get scaleX(): number;
    set scaleX(v: number);
    get scaleY(): number;
    set scaleY(v: number);
    /**
     * Always reads `scaleX` (1.10 parity: `CoreNode.scale` returns
     * `this.scaleX` regardless of `scaleY`, main:src/core/CoreNode.ts
     * ~2158-2162).
     */
    get scale(): number;
    set scale(v: number | null);
    get mountX(): number;
    set mountX(v: number);
    get mountY(): number;
    set mountY(v: number);
    get mount(): number;
    set mount(v: number);
    get pivotX(): number;
    set pivotX(v: number);
    get pivotY(): number;
    set pivotY(v: number);
    get pivot(): number;
    set pivot(v: number);
    get color(): number;
    set color(v: number);
    get colorTop(): number;
    set colorTop(v: number);
    get colorBottom(): number;
    set colorBottom(v: number);
    get colorLeft(): number;
    set colorLeft(v: number);
    get colorRight(): number;
    set colorRight(v: number);
    get colorTl(): number;
    set colorTl(v: number);
    get colorTr(): number;
    set colorTr(v: number);
    get colorBl(): number;
    set colorBl(v: number);
    get colorBr(): number;
    set colorBr(v: number);
    get placeholderColor(): number;
    set placeholderColor(v: number);
    get zIndex(): number;
    set zIndex(v: number);
    get parent(): Node | null;
    set parent(p: Node | null);
    /**
     * Make `child` a child of this node, before `before` (new in 2.0, for
     * Solid 1.7, whose draw order then follows its child order). `null`, or
     * a node that is not this node's child, appends, as setting
     * `child.parent` does; a child of this node moves, and one placed before
     * itself stays (as in the DOM). Siblings stay sorted by zIndex: where
     * `before`'s zIndex is not the child's, the child goes to the nearest
     * place that keeps them sorted. A destroyed node on either side does
     * nothing.
     */
    insertBefore(child: Node, before: Node | null): void;
    /**
     * The children in draw order. The array is shared: the first read after
     * the child list changes (a child added, removed or moved: insertBefore,
     * zIndex) builds it, and every read until the next change returns it, so 1.10's
     * `for (...; i < node.children.length; ...) node.children[i]` stays O(n).
     * Never mutate it. Unlike 1.10's live array, a change builds a new one
     * and leaves an array already returned as it was, so a loop over it may
     * destroy or re-parent the children it lists.
     */
    get children(): Node[];
    get clipping(): ClippingValue;
    set clipping(v: ClippingValue);
    get rtl(): boolean | null;
    /**
     * Stores the own direction and raises DIRTY_DIRECTION: the scene pass
     * derives the resolved direction (ST_RTL) of this node and its subtree
     * at the next frame. `undefined` is inherit, as `null` is (a framework
     * undoing a style).
     */
    set rtl(v: boolean | null | undefined);
    get ignoreParentAlpha(): boolean;
    set ignoreParentAlpha(v: boolean);
    get autosize(): boolean;
    /**
     * Turned on, the node takes its texture's size at the next resolve
     * (ST_AUTOSIZE_DUE), as 1.10 sized it when autosize was turned on after
     * the load; otherwise only a load sizes it, so a w/h written since stays.
     */
    set autosize(v: boolean | undefined);
    /**
     * 1.10 always gave a node a `data` object (`props.data ?? {}`), so app
     * code writes into it without initializing it first (`node.data.foo = 1`).
     * A live node whose slot is still `null` gets `{}` created and stored here
     * on first read, so every later read (including the one after this write)
     * sees the same object. A destroyed handle returns `null` and never
     * allocates.
     */
    get data(): Record<string, unknown> | null;
    set data(v: Record<string, unknown> | null | undefined);
    get src(): string | null;
    set src(v: string | null | undefined);
    /**
     * The texture last assigned with `texture`, or null: a node showing `src`
     * returns the texture `src` shadows, if any (spec 14: 1.10 returned the
     * texture it built from the src).
     */
    get texture(): Texture | null;
    set texture(v: object | null | undefined);
    get textureOptions(): TextureOptions;
    set textureOptions(v: TextureOptions | null | undefined);
    get srcX(): number | undefined;
    set srcX(v: number | undefined);
    get srcY(): number | undefined;
    set srcY(v: number | undefined);
    get srcWidth(): number | undefined;
    set srcWidth(v: number | undefined);
    get srcHeight(): number | undefined;
    set srcHeight(v: number | undefined);
    /** 1.10 parity: unset reads as `null`, not `undefined` (`get imageType()
     * { return this.props.imageType || null; }`). */
    get imageType(): ImageType;
    set imageType(v: ImageType | undefined);
    get componentName(): string | undefined;
    set componentName(v: string | undefined);
    get componentLocation(): string | undefined;
    set componentLocation(v: string | undefined);
    /**
     * Stored only: read when an image in the subtree is uploaded
     * (AtlasPages), so it marks nothing.
     */
    get atlasGroup(): string | undefined;
    set atlasGroup(v: string | undefined);
    get shader(): ShaderNode | null;
    set shader(v: object | null | undefined);
    /**
     * Ported from 1.10 exactly (main:src/core/CoreNode.ts ~2107-2113),
     * including its `||` fallback: when the parent's own `absX` is falsy
     * (typically exactly `0`, e.g. a parent whose recursive x/w/mountX chain
     * nets to zero), 1.10 falls back to the parent's actual world-transform
     * translation (`globalTransform.tx`; here the store's `wtx`) rather than
     * treating the parent as contributing nothing. This matters because the
     * additive absX/absY formula does not account for a rotated or scaled
     * ancestor, so it can legitimately diverge from the true world position.
     */
    get absX(): number;
    get absY(): number;
    /** 1.10 numeric render state: 0 Init, 2 OutOfBounds, 4 InBounds, 8 InViewport. */
    get renderState(): RenderStateValue;
    /**
     * The load state of the image the node's `src` or `texture` (whichever
     * was written last) names, read from the texture store when asked, so a
     * reader that comes after the `loaded` or `failed` event still finds the
     * outcome (spec 9.7):
     *
     * - `'none'`: no `src` (null or '') and no `texture`; also destroyed.
     * - `'loaded'`: its pixels (a SubTexture's: its sheet's) are uploaded; a
     *   node in bounds draws them from the next frame at the latest.
     * - `'failed'`: its load failed for good, after the last retry (the
     *   node's `failed` event); it stays so until the source changes.
     * - `'loading'`: anything else: queued, loading, decoded and waiting for
     *   its upload, or waiting for a retry; and not requested at all, as no
     *   load starts before a node is first in bounds (spec 9.2), and a
     *   cleanup frees the pixels nobody wants (they load again when wanted).
     *
     * It follows the source as written, at once: a new `src` reads its own
     * image's state (`'loading'` until it is there), though the node keeps
     * drawing the old one until the new one is uploaded (spec 9.4).
     */
    get imageState(): NodeImageState;
    /**
     * 1.10's `clippingRect`, as of the node's last visit by the walk: its own
     * clip (intersected with its ancestors') when it clips, else the nearest
     * clipping ancestor's. A copy: writing into it changes nothing. The walk
     * skips a node under a culled ancestor (item 33), so such a node reads the
     * record of its last visit, which may since have been freed or reused.
     */
    get clippingRect(): RectWithValid;
    /**
     * A controller for `props` (call its `start()` to run it): the
     * controller interface of 1.10, whatever class implements it.
     */
    animate(props: AnimateProps, settings?: Partial<AnimationSettings>): IAnimationController;
    /**
     * Solid's transition path: one controller per prop name, reused while the
     * same settings object is passed; a different settings object stops the
     * previous controller and starts a new one.
     */
    animateProp(name: string, value: number, settings?: Partial<AnimationSettings>): IAnimationController;
    destroy(): void;
}
