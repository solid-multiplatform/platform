/**
 * SceneGraph node adapter. One instance per SolidTV renderer node.
 *
 * Each node is a Group. Its own drawing comes first in that Group, so app
 * children always paint above it: a shadow image, then the visual
 * (Poster/Rectangle/Label), then the layers that finish the fill (gradient
 * ramps, corner weights, border edges). effects.ts decides what those are
 * for the renderer's tier; this file writes them. Transform, opacity,
 * clipping and z-order follow the shared renderer's semantics. Text is laid
 * out here (text-layout.ts, from the font's own widths) and written to a
 * Label as finished lines: the Label draws them, it does not break them.
 */

import { createElement, insertNode, setProp, tmTransaction } from '@roku-sdk/solid';
import type { SceneAnimatableProps, SceneTextProps } from '../contracts.js';
import type { AnimationController } from './animation.js';
import type { AnimationSettings } from './animation-types.js';
import type { SceneGraphRenderer } from './renderer.js';
import { Events } from './events.js';
import { PosterImage } from './poster-image.js';
import { isColorKey, lerpColor } from './animation-color.js';
import { finiteNumber as num, sameValue as same } from './node-values.js';
import { RokuTexture, normalizeUri, unsupportedImage } from './node-textures.js';
import { ShaderHandle } from './shader-handle.js';
import { planDecor, reportGap, toRokuColor } from './effects.js';
import type { DecorLayer } from './effects.js';
import type { EffectEntry } from './effect-cache.js';
import type { Face } from './fonts.js';
import { layoutText, TextAlign, TextContain, TextLayoutResult, VerticalAlign, WordBreak } from './text-layout.js';

export { RokuTexture } from './node-textures.js';
export { ShaderHandle } from './shader-handle.js';

const APP_W = 1920;
const APP_H = 1080;
let nextUid = 1;
let geometryEpoch = 0;

/** Characters that draw nothing and take no width (the WebGL backend's list). */
const invisible = (code: number) =>
  code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff || code === 0x00ad || code === 0x2060;

/** A shadow or fill layer: a Poster or Rectangle and the fields written to it. */
interface LayerNode {
  node: any;
  poster: boolean;
  written: Record<string, any>;
}

type ColorSource = number | null | undefined;
type ClipRect = [number, number, number, number];

/** The scene contract's props plus the names only this backend reads. */
export interface RokuNodeProps extends Partial<SceneTextProps<RokuNode>> {
  colorTopLeft?: number;
  colorTopRight?: number;
  colorBottomLeft?: number;
  colorBottomRight?: number;
  textColor?: number;
  fontWeight?: number | string;
  placeholder?: string;
  fallback?: string;
  marginLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  compositorHolder?: boolean;
  nativeMotionRoot?: boolean;
  nativeCompositorPrepared?: boolean;
}

export class RokuNode extends Events {
  uid = nextUid++;
  private _isText: boolean;
  readonly stage: SceneGraphRenderer;
  readonly renderer: SceneGraphRenderer;
  dom: any;
  visual: any = null;
  private _claimedVisual: any = null;
  get nativeVisual() { return this.visual || this._claimedVisual; }

  private _parent: RokuNode | null = null;
  private _children: RokuNode[] = [];
  private _worldEpoch = -1;
  private _worldX = 0;
  private _worldY = 0;
  private _worldRtl = false;
  private _x = 0;
  private _y = 0;
  private _w = 0;
  private _h = 0;
  private _alpha = 1;
  private _color = 0xffffffff;
  private _hasColor = false;
  // Web corner precedence: explicit corner > colorTop/Bottom > colorLeft/Right
  // > base color. Keep the sources and recompose, so apply order does not
  // change the result (Solid applies colorTop before colorRight).
  private _baseColor = 0x00000000;
  private _topColor: ColorSource = undefined;
  private _bottomColor: ColorSource = undefined;
  private _leftColor: ColorSource = undefined;
  private _rightColor: ColorSource = undefined;
  private _tlColor: ColorSource = undefined;
  private _trColor: ColorSource = undefined;
  private _blColor: ColorSource = undefined;
  private _brColor: ColorSource = undefined;
  private _cornerColors = false;
  private _colorTL = 0xffffffff;
  private _colorTR = 0xffffffff;
  private _colorBL = 0xffffffff;
  private _colorBR = 0xffffffff;
  private _colorGap = false;

  private _scaleX = 1;
  private _scaleY = 1;
  private _mountX = 0;
  private _mountY = 0;
  private _pivotX = 0.5;
  private _pivotY = 0.5;
  private _rotation = 0;
  private _zIndex = 0;
  private _rtl: boolean | null = null;
  private _clipping: boolean | ClipRect = false;
  private _margins: number[] = [0, 0, 0, 0];
  private _layout: TextLayoutResult | null = null;
  private _destroyed = false;

  private _fontFamily = '';
  private _fontWeight: number | string | undefined = undefined;
  private _fontSize = 32;
  private _lineHeight = 1.2;
  private _maxWidth = 0;
  private _maxHeight = 0;
  private _maxLines = 0;
  private _contain: TextContain = 'none';
  private _textAlign: TextAlign = 'left';
  private _verticalAlign: VerticalAlign = 'top';
  private _wordBreak: WordBreak = 'break-word';
  private _overflowSuffix = '...';
  private _letterSpacing = 0;
  private _offsetY = 0;
  private _textValue = '';
  /** The font this text draws with, held until the node names another or goes. */
  private _face: Face | null = null;
  private _layoutStale = true;
  /** The registry version `_layout` was made at. */
  private _fontVersion = -1;
  private _loadedQueued = false;
  /** One Label per glyph, for letter-spaced text (a Label has no letter spacing). */
  private _glyphs: LayerNode[] = [];
  private _imageLoadedEmitted = false;
  private _imageRequest: PosterImage | null = null;
  private _imageUri = '';
  private _imageOnLoaded?: (poster: any) => void;
  private _externalVisual = false;
  detachedVisualHolder = false;
  nativeMotionRoot = false;
  nativeCompositorPrepared = false;
  nativeMotionOwned?: Set<string>;

  private _src = '';
  private _undecodable = false;
  private _texture: RokuTexture | null = null;
  private _sub: number[] | null = null;
  private _subHooked = false;
  private _forceClip = false;
  private _srcX: number | undefined = undefined;
  private _srcY: number | undefined = undefined;
  private _srcWidth: number | undefined = undefined;
  private _srcHeight: number | undefined = undefined;
  private _imageType: string | null = null;
  private _autosize = false;
  private _ignoreParentAlpha = false;
  private _fontStyle = 'normal';
  private _shader: ShaderHandle | null = null;
  /** The Effect nodes the visual and the rounded layers refer to (native tier). */
  private _effect: EffectEntry | null = null;
  private _layerEffect: EffectEntry | null = null;
  private _shadow: LayerNode | null = null;
  private _layers: LayerNode[] = [];
  private _data: Record<string, unknown> | null = null;
  private _textureOptions: any = { resizeMode: { x: 'fill', y: 'fill' } };
  private _placeholderColor = 0;
  private _placeholder = '';
  private _fallback = '';
  private _initializing = true;

  private _transformDirty = true;
  private _visualDirty = true;
  private _clipDirty = true;
  private _effectDirty = false;
  private _orderDirty = false;
  private _queued = false;
  private _written: { [name: string]: any } = {};
  private _writtenGroup: { [name: string]: any } = {};

  constructor(renderer: SceneGraphRenderer, props: RokuNodeProps = {}, existingRoot?: any, text = false) {
    super();
    this.renderer = renderer;
    this.stage = renderer;
    this._isText = text;
    // A motion root is a `SolidMotionGroup`: the component owns one
    // SceneGraph Animation per axis and copies the animated float into
    // `translation`/`opacity` on the render thread. Nodes are motion roots
    // only when the host can run native animations.
    const nativeMotion = !!this.renderer.host?.createNativeAnimation;
    this.nativeMotionRoot = !existingRoot && (nativeMotion || !!props.compositorHolder || !!props.nativeMotionRoot);
    this.dom = existingRoot || createElement(this.nativeMotionRoot ? 'SolidMotionGroup' : 'group');
    // The component's interpolators address the group by id.
    if (this.nativeMotionRoot) setProp(this.dom, 'id', 's' + this.uid);
    const p = props || {};
    this._color = p.color !== undefined ? p.color : 0xffffffff;
    // A missing corner on a gradient view is transparent on the web. Keep
    // `_color` white for the Poster blend tint, but use transparent black as
    // the default for corners that the style did not specify.
    this._baseColor = p.color !== undefined ? p.color : 0x00000000;
    this._topColor = p.colorTop;
    this._bottomColor = p.colorBottom;
    this._leftColor = p.colorLeft;
    this._rightColor = p.colorRight;
    this._tlColor = p.colorTl ?? p.colorTopLeft;
    this._trColor = p.colorTr ?? p.colorTopRight;
    this._blColor = p.colorBl ?? p.colorBottomLeft;
    this._brColor = p.colorBr ?? p.colorBottomRight;
    this._hasColor =
      p.color !== undefined ||
      p.colorTop !== undefined ||
      p.colorBottom !== undefined ||
      p.colorLeft !== undefined ||
      p.colorRight !== undefined ||
      p.colorTl !== undefined ||
      p.colorTr !== undefined ||
      p.colorBl !== undefined ||
      p.colorBr !== undefined ||
      p.colorTopLeft !== undefined ||
      p.colorTopRight !== undefined ||
      p.colorBottomLeft !== undefined ||
      p.colorBottomRight !== undefined ||
      p.shader !== undefined;
    this.recomputeCorners();
    this.applyProps(p);
    if (p.parent) this.parent = p.parent;
    this._initializing = false;
    this.renderer.markDirty(this);
  }

  private applyProps(props: RokuNodeProps) {
    for (const key in props) {
      const value = props[key];
      if (value === undefined) continue;
      switch (key) {
        case 'parent':
          // The parent link itself is applied after the prop loop. Do not let
          // it fall through into the colour case: a RokuNode is not a colour.
          break;
        case 'color': this._color = value; this._baseColor = value; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorTop': this._effectDirty = true; this._topColor = value; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorBottom': this._effectDirty = true; this._bottomColor = value; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorLeft': this._effectDirty = true; this._leftColor = value; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorRight': this._effectDirty = true; this._rightColor = value; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorTl':
        case 'colorTopLeft': this._effectDirty = true; this._tlColor = value; this._cornerColors = true; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorTr':
        case 'colorTopRight': this._effectDirty = true; this._trColor = value; this._cornerColors = true; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorBl':
        case 'colorBottomLeft': this._effectDirty = true; this._blColor = value; this._cornerColors = true; this.recomputeCorners(); this._hasColor = true; break;
        case 'colorBr':
        case 'colorBottomRight': this._effectDirty = true; this._brColor = value; this._cornerColors = true; this.recomputeCorners(); this._hasColor = true; break;
        // A text node's size is its laid-out text: a w or h it is created with is not kept.
        case 'w': if (!this._isText) this._w = num(value, 0); break;
        case 'h': if (!this._isText) this._h = num(value, 0); break;
        case 'x': this._x = num(value, 0); break;
        case 'y': this._y = num(value, 0); break;
        case 'alpha': this._alpha = num(value, 1); break;
        case 'scale': {
          const s = num(value, 1);
          this._scaleX = s;
          this._scaleY = s;
          break;
        }
        case 'scaleX': this._scaleX = num(value, 1); break;
        case 'scaleY': this._scaleY = num(value, 1); break;
        case 'mount': this._mountX = this._mountY = num(value, 0); break;
        case 'mountX': this._mountX = num(value, 0); break;
        case 'mountY': this._mountY = num(value, 0); break;
        case 'pivot': this._pivotX = this._pivotY = num(value, 0.5); break;
        case 'pivotX': this._pivotX = num(value, 0.5); break;
        case 'pivotY': this._pivotY = num(value, 0.5); break;
        case 'rotation': this._rotation = num(value, 0); break;
        case 'zIndex': this._zIndex = num(value, 0); this.markOrder(); break;
        case 'nativeMotionRoot': this.nativeMotionRoot = !!value; break;
        case 'nativeCompositorPrepared': this.nativeCompositorPrepared = !!value; break;
        case 'rtl': this._rtl = value === undefined ? null : !!value; break;
        case 'clipping':
          this._clipping = value === true || Array.isArray(value) ? value : false;
          break;
        case 'marginLeft': this._margins[0] = num(value, 0); break;
        case 'marginTop': this._margins[1] = num(value, 0); break;
        case 'marginRight': this._margins[2] = num(value, 0); break;
        case 'marginBottom': this._margins[3] = num(value, 0); break;
        case 'src': this.src = value; break;
        case 'texture': this.setTexture(value); break;
        case 'srcX': this._srcX = value; this.updateCrop(); break;
        case 'srcY': this._srcY = value; this.updateCrop(); break;
        case 'srcWidth': this._srcWidth = value; this.updateCrop(); break;
        case 'srcHeight': this._srcHeight = value; this.updateCrop(); break;
        case 'imageType': this.imageType = value; break;
        case 'autosize': this.autosize = value; break;
        case 'ignoreParentAlpha': this.ignoreParentAlpha = value; break;
        case 'fontStyle': this.fontStyle = value; break;
        case 'shader': this.setShader(value); break;
        case 'data': this._data = value; break;
        case 'textureOptions': this._textureOptions = value || this._textureOptions; break;
        case 'placeholderColor': this._placeholderColor = value; break;
        case 'placeholder': this._placeholder = String(value); break;
        case 'fallback': this._fallback = String(value); break;
        case 'text': this._textValue = String(value); break;
        case 'textColor': this._color = value; break;
        case 'fontFamily': this._fontFamily = String(value); break;
        case 'fontWeight': this._fontWeight = value; break;
        case 'fontSize': this._fontSize = num(value, 32); break;
        case 'lineHeight': this._lineHeight = num(value, 0) || 1.2; break;
        case 'maxWidth': this._maxWidth = num(value, 0); break;
        case 'maxHeight': this._maxHeight = num(value, 0); break;
        case 'maxLines': this._maxLines = num(value, 0); break;
        case 'contain': this._contain = value || 'none'; break;
        case 'textAlign': this._textAlign = value || 'left'; break;
        case 'verticalAlign': this._verticalAlign = value || 'top'; break;
        case 'wordBreak': this._wordBreak = value || 'break-word'; break;
        case 'overflowSuffix': this._overflowSuffix = String(value); break;
        case 'letterSpacing': this._letterSpacing = num(value, 0); break;
        case 'offsetY': this._offsetY = num(value, 0); break;
        default: break;
      }
    }
  }

  // ---- identity / tree -------------------------------------------------

  get id() { return 'n' + this.uid; }
  get destroyed() { return this._destroyed; }
  get parentNode() { return this._parent; }
  get parent() { return this._parent; }
  set parent(value: RokuNode | null) {
    if (value === this._parent) return;
    geometryEpoch++;
    if (this._parent) {
      const old = this._parent;
      this._parent = null;
      const i = old._children.indexOf(this);
      if (i >= 0) old._children.splice(i, 1);
      tmTransaction.removeNode(old.dom, this.dom);
      old.markTransform();
    }
    if (value) {
      this._parent = value;
      value._children.push(this);
      insertNode(value.dom, this.dom);
      // zIndex is normally set before the node is parented. Sorting here (not
      // only when zIndex changes later) is what puts nav/FPS/page/background
      // in the order the shared UI expects. All-zero-zIndex grids/lists keep
      // insertion order, so skip the reorder for the common case.
      if (this._zIndex !== 0 || value._children.some((child) => child._zIndex !== 0)) {
        value._orderDirty = true;
        value.renderer.markDirty(value);
      }
      value.markTransform();
    }
  }
  get children() { return this._children; }

  insertBefore(child: RokuNode, before: RokuNode | null) {
    if (child.parent) {
      const i = child.parent._children.indexOf(child);
      if (i >= 0) child.parent._children.splice(i, 1);
      tmTransaction.removeNode(child.parent.dom, child.dom);
    }
    child._parent = this;
    geometryEpoch++;
    const at = before ? this._children.indexOf(before) : -1;
    if (at < 0) this._children.push(child);
    else this._children.splice(at, 0, child);
    insertNode(this.dom, child.dom, before ? before.dom : undefined);
    if (child._zIndex !== 0 || this._children.some((c) => c._zIndex !== 0)) {
      this._orderDirty = true;
      this.renderer.markDirty(this);
    }
  }

  sortChildren() {
    this._orderDirty = true;
    this.renderer.markDirty(this);
  }

  private markOrder() {
    if (this._parent) this._parent._orderDirty = true;
    if (this._parent) this.renderer.markDirty(this._parent);
    else this.renderer.markDirty(this);
  }

  // ---- geometry / appearance -------------------------------------------

  get x() { return this._x; }
  set x(v: number) { if (v !== this._x) { this._x = num(v, 0); this.markTransform("position"); } }
  get y() { return this._y; }
  set y(v: number) { if (v !== this._y) { this._y = num(v, 0); this.markTransform("position"); } }
  // A text node's size is its laid-out text; writing w or h bounds the layout
  // (maxWidth, maxHeight), as on WebGL.
  get w() { return this._isText ? this.textLayout().width : this._w; }
  set w(v: number) {
    if (this._isText) { this._maxWidth = num(v, 0); this.staleLayout(); return; }
    this._w = num(v, 0);
    this.markTransform();
    // A rect/poster paints at boxW/boxH: the visual is resized with the node.
    this.markVisual();
  }
  get h() { return this._isText ? this.textLayout().height : this._h; }
  set h(v: number) {
    if (this._isText) { this._maxHeight = num(v, 0); this.staleLayout(); return; }
    this._h = num(v, 0);
    this.markTransform();
    this.markVisual();
  }
  get width() { return this.w; }
  set width(v: number) { this.w = v; }
  get height() { return this.h; }
  set height(v: number) { this.h = v; }

  get boxW() { return this._isText ? this.textLayout().boxW : this._w; }
  get boxH() { return this._isText ? this.textLayout().boxH : this._h; }

  get alpha() { return this._alpha; }
  set alpha(v: number) { this._alpha = Math.max(0, Math.min(1, num(v, 1))); this.markTransform("alpha"); }
  get visible() { return this._alpha > 0; }
  set visible(v: boolean) { this.alpha = v ? 1 : 0; }

  private recomputeCorners() {
    const pick = (first: ColorSource, second: ColorSource, third: ColorSource): number =>
      first !== undefined && first !== null
        ? first
        : second !== undefined && second !== null
          ? second
          : third !== undefined && third !== null
            ? third
            : this._baseColor;
    this._colorTL = pick(this._tlColor, this._topColor, this._leftColor);
    this._colorTR = pick(this._trColor, this._topColor, this._rightColor);
    this._colorBL = pick(this._blColor, this._bottomColor, this._leftColor);
    this._colorBR = pick(this._brColor, this._bottomColor, this._rightColor);
  }

  get color() { return this._color; }
  set color(v: number) { this._hasColor = true; this._color = v; this._baseColor = v; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  // A side or corner that was never set reads the colour that corner draws
  // with, as the other backends read theirs.
  get colorTop(): number { return this._topColor ?? this._colorTL; }
  set colorTop(v: number) { this._hasColor = true; this._topColor = v; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorBottom(): number { return this._bottomColor ?? this._colorBL; }
  set colorBottom(v: number) { this._hasColor = true; this._bottomColor = v; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorLeft(): number { return this._leftColor ?? this._colorTL; }
  set colorLeft(v: number) { this._hasColor = true; this._leftColor = v; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorRight(): number { return this._rightColor ?? this._colorTR; }
  set colorRight(v: number) { this._hasColor = true; this._rightColor = v; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorTl(): number { return this._tlColor ?? this._colorTL; }
  set colorTl(v: number) { this._hasColor = true; this._tlColor = v; this._cornerColors = true; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorTr(): number { return this._trColor ?? this._colorTR; }
  set colorTr(v: number) { this._hasColor = true; this._trColor = v; this._cornerColors = true; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorBl(): number { return this._blColor ?? this._colorBL; }
  set colorBl(v: number) { this._hasColor = true; this._blColor = v; this._cornerColors = true; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  get colorBr(): number { return this._brColor ?? this._colorBR; }
  set colorBr(v: number) { this._hasColor = true; this._brColor = v; this._cornerColors = true; this.recomputeCorners(); this.markVisual(); this.effectDirty(); }
  // The names this backend had before the scene contract named the corners.
  get colorTopLeft(): number { return this.colorTl; }
  set colorTopLeft(v: number) { this.colorTl = v; }
  get colorTopRight(): number { return this.colorTr; }
  set colorTopRight(v: number) { this.colorTr = v; }
  get colorBottomLeft(): number { return this.colorBl; }
  set colorBottomLeft(v: number) { this.colorBl = v; }
  get colorBottomRight(): number { return this.colorBr; }
  set colorBottomRight(v: number) { this.colorBr = v; }

  get scale(): number { return this._scaleX; }
  set scale(v: number | null) {
    const s = num(v, 1);
    this._scaleX = s;
    this._scaleY = s;
    this.markTransform();
  }
  get scaleX() { return this._scaleX; }
  set scaleX(v: number) { this._scaleX = num(v, 1); this.markTransform(); }
  get scaleY() { return this._scaleY; }
  set scaleY(v: number) { this._scaleY = num(v, 1); this.markTransform(); }
  get mountX() { return this._mountX; }
  set mountX(v: number) { this._mountX = num(v, 0); this.markTransform(); }
  get mountY() { return this._mountY; }
  set mountY(v: number) { this._mountY = num(v, 0); this.markTransform(); }
  /** Sets both axes; reads `mountX`, as `scale` reads `scaleX`. */
  get mount(): number { return this._mountX; }
  set mount(v: number) { this._mountX = this._mountY = num(v, 0); this.markTransform(); }
  get pivotX() { return this._pivotX; }
  set pivotX(v: number) { this._pivotX = num(v, 0.5); this.markTransform(); }
  get pivotY() { return this._pivotY; }
  set pivotY(v: number) { this._pivotY = num(v, 0.5); this.markTransform(); }
  /** Sets both axes; reads `pivotX`. */
  get pivot(): number { return this._pivotX; }
  set pivot(v: number) { this._pivotX = this._pivotY = num(v, 0.5); this.markTransform(); }
  get rotation() { return this._rotation; }
  set rotation(v: number) { this._rotation = num(v, 0); this.markTransform(); }
  get zIndex() { return this._zIndex; }
  set zIndex(v: number) { this._zIndex = num(v, 0); this.markOrder(); }
  get rtlResolved(): boolean { this.updateWorld(); return this._worldRtl; }

  get clipping(): boolean | ClipRect { return this._clipping; }
  set clipping(v: boolean | ClipRect) {
    this._clipping = v === true || Array.isArray(v) ? v : false;
    this.markClip();
  }
  // Stored only: a node keeps the w/h it was given. Poster reports its bitmap size on load, but nothing resizes the node from it yet.
  get autosize(): boolean { return this._autosize; }
  set autosize(v: boolean | undefined) { this._autosize = v === true; }
  // Stored only: a Group's opacity always multiplies into its children here. SceneGraph's `inheritParentOpacity` is not wired yet.
  get ignoreParentAlpha(): boolean { return this._ignoreParentAlpha; }
  set ignoreParentAlpha(v: boolean | undefined) { this._ignoreParentAlpha = v === true; }
  get clippingRect() {
    const x = this.absX;
    const y = this.absY;
    if (this._clipping === true) return { valid: true, x, y, w: this.boxW, h: this.boxH };
    if (Array.isArray(this._clipping)) return { valid: true, x: x + this._clipping[0], y: y + this._clipping[1], w: this._clipping[2], h: this._clipping[3] };
    return { valid: false, x: 0, y: 0, w: 0, h: 0 };
  }

  private updateWorld() {
    if (this._worldEpoch === geometryEpoch) return;
    const parent = this._parent;
    if (parent) parent.updateWorld();
    this._worldRtl = this._rtl ?? parent?._worldRtl ?? false;
    const width = this.boxW;
    const localX = parent && this._worldRtl ? parent.boxW - this._x - width : this._x;
    this._worldX = (parent?._worldX ?? 0) + localX - this._mountX * width;
    this._worldY = (parent?._worldY ?? 0) + this._y - this._mountY * this.boxH;
    this._worldEpoch = geometryEpoch;
  }

  get absX(): number { this.updateWorld(); return this._worldX; }
  get absY(): number { this.updateWorld(); return this._worldY; }

  get renderState(): number {
    if (this._alpha <= 0) return 0;
    const x = this.absX;
    const y = this.absY;
    const w = this.boxW;
    const h = this.boxH;
    if (w <= 0 || h <= 0) return 0;
    return x < APP_W && y < APP_H && x + w > 0 && y + h > 0 ? 8 : 0;
  }

  // ---- resources --------------------------------------------------------

  get src(): string { return this._src || (this._texture ? this._texture.src : ''); }
  set src(v: string | null) {
    const next = normalizeUri(String(v || ''));
    if (next === this._src) return;
    this._src = next;
    this.markVisual();
    this._imageLoadedEmitted = false;
    this._imageRequest?.invalidate();
    this.checkDecodable();
  }
  /** The image a Poster can draw: empty for a format SceneGraph cannot decode. */
  private get imageSrc(): string {
    return this._undecodable ? '' : this.src;
  }
  /** A format a Poster cannot decode fails as a missing file does. Nothing stands in for it. */
  private checkDecodable() {
    const src = this.src;
    this._undecodable = unsupportedImage(src);
    if (!this._undecodable) return;
    reportGap('a Poster cannot decode ' + (/\.([a-z0-9]+)(\?|$)/i.exec(src)?.[1] ?? 'this image format').toLowerCase() + ' images');
    setTimeout(() => {
      if (this._destroyed || this.src !== src) return;
      if (this._texture) { this._texture.state = 'failed'; this._texture.emit('failed'); }
      this.emit('failed', { type: 'image', error: new Error('Unsupported image format: ' + src) });
    }, 0);
  }
  get texture() { return this._texture; }
  set texture(v: RokuTexture | null) { this.setTexture(v); this.markVisual(); }
  private setTexture(v: RokuTexture | null) {
    this._texture = v || null;
    this.updateCrop();
    if (!this._src) this.checkDecodable();
  }
  /**
   * The source rectangle the Poster path crops to (see writePoster): a
   * SubTexture's, else `srcX/srcY/srcWidth/srcHeight` of a node drawn from
   * `src`. As on the web, a crop needs both a width and a height.
   */
  private updateCrop() {
    const texture = this._texture;
    let sub: number[] | null = null;
    if (texture && texture.textureType === 'SubTexture') {
      const p = texture.props || {};
      sub = [num(p.x, 0), num(p.y, 0), num(p.w, 0), num(p.h, 0)];
    } else if (!texture && num(this._srcWidth, 0) > 0 && num(this._srcHeight, 0) > 0) {
      sub = [num(this._srcX, 0), num(this._srcY, 0), num(this._srcWidth, 0), num(this._srcHeight, 0)];
    }
    const clipped = this._forceClip;
    this._sub = sub;
    this._forceClip = sub !== null;
    if (this._forceClip || clipped) this.markClip();
  }
  get srcX(): number | undefined { return this._srcX; }
  set srcX(v: number | undefined) { this._srcX = v; this.updateCrop(); this.markVisual(); }
  get srcY(): number | undefined { return this._srcY; }
  set srcY(v: number | undefined) { this._srcY = v; this.updateCrop(); this.markVisual(); }
  get srcWidth(): number | undefined { return this._srcWidth; }
  set srcWidth(v: number | undefined) { this._srcWidth = v; this.updateCrop(); this.markVisual(); }
  get srcHeight(): number | undefined { return this._srcHeight; }
  set srcHeight(v: number | undefined) { this._srcHeight = v; this.updateCrop(); this.markVisual(); }
  // Stored only: Poster chooses its decoder from the file. SceneGraph has no image type hint.
  get imageType(): string | null { return this._imageType; }
  set imageType(v: string | null | undefined) { this._imageType = v ?? null; }
  get shader() { return this._shader; }
  set shader(v: ShaderHandle | null) { this.setShader(v); this.markVisual(); }
  private setShader(v: ShaderHandle | Record<string, unknown> | null) {
    // With shaders compiled out of the platform (the Roku preset), a node's
    // first effects arrive as the flat props themselves, not as a shader.
    if (v && !(v instanceof ShaderHandle)) v = new ShaderHandle('rounded', v);
    if (this._shader === v) return;
    if (this._shader) this._shader.nodes.delete(this);
    this._shader = (v as ShaderHandle) || null;
    if (this._shader) this._shader.nodes.add(this);
    this.effectDirty();
  }
  get data(): Record<string, unknown> | null { return this._data; }
  set data(v: Record<string, unknown> | null) { this._data = v; }
  get textureOptions() { return this._textureOptions; }
  set textureOptions(v: any) { this._textureOptions = v; this.markVisual(); }
  get placeholderColor(): number { return this._placeholderColor; }
  set placeholderColor(v: number) { this._placeholderColor = v; this.markVisual(); }

  /**
   * For an animation of shader props: a function that writes the props
   * blended from their values now (0) to `target` (1). Numbers and number
   * arrays interpolate, colours by channel; anything else changes at the end.
   */
  shaderPropsBlend(target: Record<string, any>): (progress: number) => void {
    const props = this._shader ? this._shader.props : null;
    const from: Record<string, any> = {};
    if (props) {
      for (const key in target) from[key] = Array.isArray(props[key]) ? props[key].slice() : props[key];
    }
    const mix = (key: string, a: any, b: any, t: number): any => {
      if (t >= 1) return b;
      if (typeof b === 'number' && typeof a === 'number') return /color|fill/i.test(key) ? lerpColor(a, b, t) : a + (b - a) * t;
      if (Array.isArray(b) && Array.isArray(a) && a.length === b.length) return b.map((v, i) => mix(key, a[i], v, t));
      // A width that was never set starts from 0; anything else waits for the end.
      if (typeof b === 'number' && a === undefined && !/color|fill/i.test(key)) return b * t;
      return a === undefined ? b : a;
    };
    return (progress: number) => {
      const live = this._shader ? this._shader.props : null;
      if (!live) return;
      for (const key in target) {
        const value = target[key];
        // The nested style objects ride along; the flat keys carry the values.
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) continue;
        live[key] = mix(key, from[key], value, progress);
      }
    };
  }

  effectDirty() {
    this._effectDirty = true;
    this.renderer.markDirty(this);
  }
  markTransform(kind: "position" | "alpha" | "geometry" = "geometry") {
    this._transformDirty = true;
    if (kind !== "alpha") {
      this._worldEpoch = -1;
      // Overlay holders have no logical descendants; their writes stay local.
      if (!this.detachedVisualHolder || this._parent || this._children.length) geometryEpoch++;
    }
    this.renderer.host?.markNativeSync?.(this, kind);
    if (!this.detachedVisualHolder) this.renderer.markDirty(this);
  }
  markVisual() { this._visualDirty = true; this.renderer.markDirty(this); }
  markClip() { this._clipDirty = true; this.renderer.markDirty(this); }
  requestRender() { this.renderer.markDirty(this); }

  private _anims: Map<string, { settings: AnimationSettings; controller: AnimationController }> | null = null;
  get text() { return this._textValue; }
  set text(v: string) {
    const next = v === undefined || v === null ? '' : String(v);
    if (next === this._textValue) return;
    this._textValue = next;
    this.staleLayout();
  }
  get fontFamily() { return this._fontFamily; }
  set fontFamily(v: string) { this._fontFamily = String(v || ''); this.staleLayout(); }
  // `italic` picks a font registered as italic; there is no synthetic slant.
  get fontStyle(): string { return this._fontStyle; }
  set fontStyle(v: string | undefined) { this._fontStyle = v === undefined || v === null ? 'normal' : String(v); this.staleLayout(); }
  get fontWeight() { return this._fontWeight; }
  set fontWeight(v: number | string | undefined) { this._fontWeight = v; this.staleLayout(); }
  get fontSize() { return this._fontSize; }
  set fontSize(v: number) { this._fontSize = num(v, 32); this.staleLayout(); }
  get lineHeight() { return this._lineHeight; }
  set lineHeight(v: number | undefined) { this._lineHeight = num(v, 0) || 1.2; this.staleLayout(); }
  get maxWidth() { return this._maxWidth; }
  set maxWidth(v: number) { this._maxWidth = num(v, 0); this.staleLayout(); }
  get maxHeight() { return this._maxHeight; }
  set maxHeight(v: number) { this._maxHeight = num(v, 0); this.staleLayout(); }
  get maxLines() { return this._maxLines; }
  set maxLines(v: number) { this._maxLines = num(v, 0); this.staleLayout(); }
  get contain() { return this._contain; }
  set contain(v: TextContain) { this._contain = v || 'none'; this.staleLayout(); }
  get textAlign() { return this._textAlign; }
  set textAlign(v: TextAlign) { this._textAlign = v || 'left'; this.staleLayout(); }
  get verticalAlign() { return this._verticalAlign; }
  set verticalAlign(v: VerticalAlign) { this._verticalAlign = v || 'top'; this.staleLayout(); }
  get wordBreak() { return this._wordBreak; }
  set wordBreak(v: WordBreak) { this._wordBreak = v || 'break-word'; this.staleLayout(); }
  get overflowSuffix() { return this._overflowSuffix; }
  set overflowSuffix(v: string) { this._overflowSuffix = String(v); this.staleLayout(); }
  get letterSpacing() { return this._letterSpacing; }
  set letterSpacing(v: number) { this._letterSpacing = num(v, 0); this.staleLayout(); }
  get offsetY() { return this._offsetY; }
  set offsetY(v: number) { this._offsetY = num(v, 0); this.staleLayout(); }
  get forceLoad() { return false; }
  set forceLoad(_v: boolean) { /* text is laid out whether or not it is on screen */ }
  get layout() { return this._isText ? this.textLayout() : null; }

  /** A prop the layout reads changed: it is made again when next read, at the latest in the coming flush. */
  private staleLayout() {
    if (!this._isText) return;
    this._layoutStale = true;
    this.markTransform();
    this.markVisual();
  }

  /**
   * The text's layout, made when a prop it reads or the renderer's fonts
   * changed since the last one. Synchronous: a registered font measures from
   * its table. A new layout tells `loaded` listeners (the platform's flex
   * layout) the text's size, after the flush that draws it.
   */
  private textLayout(): TextLayoutResult {
    const fonts = this.renderer.fonts;
    if (this._layout !== null && !this._layoutStale && this._fontVersion === fonts.version) return this._layout;
    this._layoutStale = false;
    this._fontVersion = fonts.version;
    // The new face first: a face that stays in use is then not dropped and made again.
    const face = fonts.acquire(this._fontFamily, this._fontWeight, this._fontStyle, this._fontSize);
    if (this._face !== null) fonts.release(this._face);
    this._face = this._destroyed ? null : face;
    this._layout = layoutText({
      text: this._textValue,
      font: face.font,
      lineHeight: this._lineHeight,
      maxWidth: this._maxWidth,
      maxHeight: this._maxHeight,
      maxLines: this._maxLines,
      textAlign: this._textAlign,
      verticalAlign: this._verticalAlign,
      contain: this._contain,
      wordBreak: this._wordBreak,
      overflowSuffix: this._overflowSuffix,
      letterSpacing: this._letterSpacing,
      offsetY: this._offsetY,
      rtl: this.direction(),
    });
    if (this._destroyed) fonts.release(face);
    else this.queueLoaded();
    return this._layout;
  }

  /** Whether this node reads right to left: its own `rtl`, else the nearest ancestor's. */
  private direction(): boolean {
    let node: RokuNode | null = this;
    while (node !== null) {
      if (node._rtl !== null) return node._rtl;
      node = node._parent;
    }
    return false;
  }

  /** `loaded`, once per turn, after the current flush: a listener may move nodes. */
  private queueLoaded() {
    if (this._loadedQueued) return;
    this._loadedQueued = true;
    void Promise.resolve().then(() => {
      this._loadedQueued = false;
      if (this._destroyed || this._layout === null || this.listenerCount('loaded') === 0) return;
      try {
        this.emit('loaded', { type: 'text', dimensions: { width: this._layout.width, height: this._layout.height } });
      } catch (error) {
        console.error('ROKU_TEXT_LOADED ' + String((error as any)?.message || error));
      }
    });
  }

  // ---- visuals ----------------------------------------------------------

  private ensureVisual() {
    if (this._externalVisual) return;
    const emptyColor = ((this._colorTL | this._colorTR | this._colorBL | this._colorBR) & 255) === 0;
    const src = this.imageSrc;
    if (!this._isText && !src && !this._shader && (!this._hasColor || emptyColor)) {
      if (this.visual) {
        tmTransaction.removeNode(this.dom, this.visual);
        this.visual = null;
        this._written = {};
      }
      this.clearDecor();
      return;
    }
    const type = this._isText ? 'label' : src ? 'poster' : 'rect';
    if (this.visual && (this.visual as any).__type === type) return;
    if (this.visual) tmTransaction.removeNode(this.dom, this.visual);
    const visual = createElement(type === 'label' ? 'label' : type === 'poster' ? 'poster' : 'rectangle');
    (visual as any).__type = type;
    this.visual = visual;
    this._written = {};
    // Above the shadow, below the layers and the children. Each of the node's
    // own drawing nodes is inserted once, where it belongs: inserting a node
    // again to move it does not reorder it on the device.
    insertNode(this.dom, visual, this._layers.length > 0 ? this._layers[0].node : this.firstChildDom());
    this._visualDirty = true;
    this._effectDirty = true;
  }

  claimVisual(type: 'poster' | 'rectangle' | 'group' | 'label') {
    this.ensureVisual();
    const visual = this.visual;
    this._externalVisual = true;
    this.visual = null;
    if (visual) tmTransaction.removeNode(this.dom, visual);
    // The Effect goes back to the cache, where another node may change it.
    if (visual && this._effect) setProp(visual, 'effect', null);
    this.clearDecor();
    const kind = type === 'rectangle' ? 'rect' : type;
    if (visual && visual.__type === kind) { this._claimedVisual = visual; return visual; }
    this._imageRequest?.invalidate();
    const claimed = createElement(type);
    (claimed as any).__type = kind;
    this._claimedVisual = claimed;
    return claimed;
  }

  loadImage(poster: any, uri: string, width: number, height: number, onLoaded?: (poster: any) => void) {
    if (!this._imageRequest || this._imageRequest.poster !== poster) {
      this._imageRequest?.invalidate();
      this._imageRequest = new PosterImage(poster, (name, value) => setProp(poster, name, value), (status) => {
        if (this._destroyed) return;
        if (status === 'loaded') {
          if (this._texture) this._texture.state = 'loaded';
          if (!this._imageLoadedEmitted) {
            this._imageLoadedEmitted = true;
            const dimensions = { width: Number(poster.bitmapWidth) || this.boxW, height: Number(poster.bitmapHeight) || this.boxH };
            this.emit('loaded', { type: 'image', dimensions });
            this._texture?.emit('loaded', { dimensions });
          }
          this._imageOnLoaded?.(poster);
          return;
        }
        if (this._texture) { this._texture.state = 'failed'; this._texture.emit('failed'); }
        this.emit('failed', { type: 'image' });
        const next = normalizeUri(this._fallback);
        if (this._fallback && next !== this._src) {
          this.src = next;
          if (this._externalVisual) this.loadImage(poster, next, width, height, this._imageOnLoaded);
        }
      });
    }
    const cached = this._imageUri === uri && this._imageRequest.ready;
    if (this._imageUri !== uri) this._imageLoadedEmitted = false;
    this._imageUri = uri;
    this._imageOnLoaded = onLoaded;
    this._imageRequest.load(uri, width, height);
    if (cached) onLoaded?.(poster);
  }

  private writeIf(name: string, value: any) {
    if (this._written[name] !== undefined && same(this._written[name], value)) return;
    this._written[name] = Array.isArray(value) ? value.slice() : value;
    setProp(this.visual, name, value);
  }

  /** Group-level fields (transform and clipping); never the child visual. */
  private writeGroupIf(name: string, value: any) {
    if (this._writtenGroup[name] !== undefined && same(this._writtenGroup[name], value)) return;
    this._writtenGroup[name] = Array.isArray(value) ? value.slice() : value;
    setProp(this.dom, name, value);
  }

  private writeTransform() {
    let tx = this._x - this._mountX * this.boxW;
    if (this.rtlResolved && this._parent) {
      tx = this._parent.boxW - this._x - this.boxW - this._mountX * this.boxW;
    }
    const ty = this._y - this._mountY * this.boxH;
    if (this.nativeMotionOwned?.has('x') || this.nativeMotionOwned?.has('y')) {
      const previous = this._writtenGroup.translation;
      if (!this.nativeMotionOwned.has('x') && (!previous || previous[0] !== tx))
        setProp(this.dom, 'xRequest', { serial: -1, action: 'snap', to: tx });
      if (!this.nativeMotionOwned.has('y') && (!previous || previous[1] !== ty))
        setProp(this.dom, 'yRequest', { serial: -1, action: 'snap', to: ty });
      this._writtenGroup.translation = [tx, ty];
    } else this.writeGroupIf('translation', [tx, ty]);
    this.writeGroupIf('scale', [this._scaleX, this._scaleY]);
    this.writeGroupIf('rotation', this._rotation);
    this.writeGroupIf('scaleRotateCenter', [this._pivotX * this.boxW, this._pivotY * this.boxH]);
    // SceneGraph already multiplies a group's opacity into its children.
    // Writing the cumulative alpha here applied ancestor opacity twice.
    if (this.nativeMotionOwned?.has('alpha')) this._writtenGroup.opacity = this._alpha;
    else this.writeGroupIf('opacity', this._alpha);
  }

  private writeClip() {
    if (!this._clipping && !this._forceClip) {
      if (this._writtenGroup.clippingRect === undefined) return;
      this.writeGroupIf('clippingRect', [0, 0, 100000, 100000]);
      return;
    }
    if (this._rotation !== 0 && !(globalThis as any).__rokuClipRotateGap) {
      (globalThis as any).__rokuClipRotateGap = true;
      console.warn('ROKU_CLIP_GAP rotated clipping uses the unrotated rect');
    }
    const rect = Array.isArray(this._clipping) ? this._clipping : [0, 0, this.boxW, this.boxH];
    this.writeGroupIf('clippingRect', [
      rect[0] - this._margins[0],
      rect[1] - this._margins[1],
      rect[2] + this._margins[0] + this._margins[2],
      rect[3] + this._margins[1] + this._margins[3],
    ]);
  }

  /** Writes the node's own drawing: the visual, its Effect, the shadow and the fill layers. */
  private writeDecor() {
    if (!this.visual) return;
    const type = (this.visual as any).__type;
    if (type === 'label') {
      this.writeLabel();
      if (this._shader) reportGap('a text node cannot take a shader');
      return;
    }
    const w = Math.max(0, this.boxW);
    const h = Math.max(0, this.boxH);
    const flat = this._colorTL === this._colorTR && this._colorTL === this._colorBL && this._colorTL === this._colorBR;
    if (!this._shader && (flat || type === 'poster') && !this._effect && !this._layerEffect && !this._shadow && this._layers.length === 0) {
      // One colour and no effects, the common node: nothing to plan.
      if (type === 'rect') {
        this.writeIf('width', w);
        this.writeIf('height', h);
        if (this._written.translation !== undefined) this.writeIf('translation', [0, 0]);
        this.writeIf('color', toRokuColor(this._colorTL, '0x00000000'));
      } else {
        if (!flat) reportGap('per-corner colours on an image use one colour');
        this.writePoster(0, 0, w, h, toRokuColor(this._color, '0xFFFFFFFF'));
      }
      return;
    }
    const plan = planDecor({
      tier: this.renderer.effectTier,
      w,
      h,
      tl: this._colorTL,
      tr: this._colorTR,
      bl: this._colorBL,
      br: this._colorBR,
      image: type === 'poster',
      blend: this._color,
      shader: this._shader,
    });
    const effects = this.renderer.effects;
    this._effect = effects.swap(this._effect, plan.effect);
    this._layerEffect = effects.swap(this._layerEffect, plan.layerEffect);
    if (type === 'rect') {
      this.writeIf('width', plan.w);
      this.writeIf('height', plan.h);
      if (plan.x !== 0 || plan.y !== 0 || this._written.translation !== undefined) this.writeIf('translation', [plan.x, plan.y]);
      this.writeIf('color', plan.color);
      this.writeEffectField();
    } else {
      this.writePoster(plan.x, plan.y, plan.w, plan.h, plan.color);
    }
    this.syncLayers(plan.shadow, plan.layers);
  }

  private writeEffectField() {
    if (this._effect) this.writeIf('effect', this._effect.node);
    else if (this._written.effect !== undefined) this.writeIf('effect', null);
  }

  private writePoster(x: number, y: number, w: number, h: number, blend: string) {
    const visual = this.visual;
    const src = this.imageSrc;
    if (this._sub) {
      // Crop a region of the image. A Poster has no source rectangle: the
      // whole bitmap is drawn inside the clipped Group, scaled so that the
      // region fills the node, and moved so that the region starts at 0,0.
      // That needs the bitmap's size, which is known once it has loaded.
      const [sx, sy, sw, sh] = this._sub;
      const bitmapW = Number(visual.bitmapWidth) || 0;
      const bitmapH = Number(visual.bitmapHeight) || 0;
      const sized = this._imageUri === src && !!this._imageRequest?.ready && bitmapW > 0 && bitmapH > 0;
      const kx = sized && sw > 0 ? w / sw : 1;
      const ky = sized && sh > 0 ? h / sh : 1;
      this.writeIf('width', sized ? bitmapW * kx : w);
      this.writeIf('height', sized ? bitmapH * ky : h);
      this.writeIf('translation', sized ? [-sx * kx, -sy * ky] : [0, 0]);
      this.writeIf('opacity', sized ? 1 : 0);
      this.writeIf('loadDisplayMode', 'scaleToFill');
    } else {
      this.writeIf('width', w);
      this.writeIf('height', h);
      // A crop that was removed leaves its offset and opacity on the Poster.
      if (x !== 0 || y !== 0 || this._written.translation !== undefined) this.writeIf('translation', [x, y]);
      if (this._written.opacity !== undefined) this.writeIf('opacity', 1);
      const resizeMode = this._textureOptions && this._textureOptions.resizeMode;
      const contained =
        this._contain === 'both' ||
        resizeMode === 'contain' ||
        (resizeMode && (resizeMode.type === 'contain' ||
          (resizeMode.x === 'contain' && resizeMode.y === 'contain')));
      const zoomed =
        resizeMode && (resizeMode.type === 'cover' || resizeMode.type === 'zoom' ||
          (resizeMode.x === 'cover' && resizeMode.y === 'cover'));
      this.writeIf('loadDisplayMode', contained ? 'scaleToFit' : zoomed ? 'scaleToZoom' : 'scaleToFill');
    }
    this.writeIf('blendColor', blend);
    // Roku asks for shaderCompatible on a Poster that takes an Effect, and for
    // it to be written before the uri: the load starts when the uri is set.
    this.writeIf('shaderCompatible', !!this._effect);
    this.writeEffectField();
    if (this._placeholder) this.writeIf('loadingBitmapUri', normalizeUri(this._placeholder));
    if (this._fallback) this.writeIf('failedBitmapUri', normalizeUri(this._fallback));
    if (this._sub) this.loadImage(visual, src, 0, 0, () => { if (this._sub) this.markVisual(); });
    else this.loadImage(visual, src, w, h);
  }

  /**
   * Writes the laid-out text to the Label. The lines are already broken and
   * cut, so the Label is given them joined by newlines in a box wider than
   * any of them: it never breaks or ellipsizes on its own, and its own
   * horizAlign puts every line where the layout has it. Vertically the first
   * baseline goes where the layout has it and lineSpacing makes up the
   * difference between the layout's line height and the Label's. Several
   * lines get a height with a line to spare: left to size itself, a Label
   * drops its last line for some fractional line spacings.
   */
  private writeLabel() {
    const layout = this.textLayout();
    const face = this._face;
    if (face === null) return;
    const font = face.font;
    const lines = layout.lines;
    this.writeIf('font', face.node);
    this.writeIf('color', toRokuColor(this._color, '0xFFFFFFFF'));
    this.writeIf('vertAlign', 'top');
    if (face.failed) {
      // The system font, and the firmware cannot measure it: one unmeasured line.
      this.syncGlyphs(0);
      this.writeIf('width', 0);
      this.writeIf('height', 0);
      this.writeIf('wrap', false);
      this.writeIf('horizAlign', 'left');
      this.writeIf('translation', [0, 0]);
      this.writeIf('text', this._textValue);
      return;
    }
    if (lines.length === 0) {
      this.syncGlyphs(0);
      this.writeIf('text', '');
      return;
    }
    const top = (line: number) => Math.round(layout.boxY + lines[line].baseline - font.labelAscent);
    if (this._letterSpacing !== 0) {
      // A Label has no letter spacing: each glyph is its own Label, placed by the layout.
      this.writeIf('text', '');
      let count = 0;
      for (let l = 0; l < lines.length; l++) {
        const text = lines[l].text;
        const y = top(l);
        let x = layout.boxX + lines[l].x;
        for (let i = 0; i < text.length; ) {
          const code = text.codePointAt(i)!;
          const glyph = String.fromCodePoint(code);
          i += glyph.length;
          if (invisible(code)) continue;
          if (code !== 32) this.writeGlyph(count++, face, glyph, x, y);
          x += font.measure(glyph, this._letterSpacing);
        }
      }
      this.syncGlyphs(count);
      return;
    }
    this.syncGlyphs(0);
    const many = lines.length > 1;
    let width = 0;
    let x = 0;
    if (many || layout.align !== 'left') {
      // Room beyond the widest line, on the side or sides the lines do not align to.
      const room = Math.ceil(8 + layout.width * 0.06);
      const span = Math.max(layout.alignWidth, layout.width);
      width = span + (layout.align === 'center' ? room * 2 : room);
      if (layout.align === 'center') x = (layout.alignWidth - width) * 0.5;
      else if (layout.align === 'right') x = layout.alignWidth - width;
    }
    // A single line aligned left needs no box: at width 0 a Label draws one line whatever its length.
    this.writeIf('width', width);
    this.writeIf('height', many ? Math.ceil(layout.height + font.labelLineHeight) : 0);
    this.writeIf('wrap', many);
    this.writeIf('lineSpacing', many ? layout.lineHeight - font.labelLineHeight : 0);
    this.writeIf('horizAlign', layout.align);
    this.writeIf('translation', [x, top(0)]);
    this.writeIf('text', many ? lines.map((line) => line.text).join('\n') : lines[0].text);
  }

  /** The `index`th glyph Label of letter-spaced text, made on first use. */
  private writeGlyph(index: number, face: Face, glyph: string, x: number, y: number) {
    let label = this._glyphs[index];
    if (label === undefined) {
      const node = createElement('label');
      insertNode(this.dom, node, this.firstChildDom());
      label = this._glyphs[index] = { node, poster: false, written: {} };
    }
    const set = (name: string, value: any) => {
      if (label.written[name] !== undefined && same(label.written[name], value)) return;
      label.written[name] = Array.isArray(value) ? value.slice() : value;
      setProp(label.node, name, value);
    };
    set('font', face.node);
    set('color', toRokuColor(this._color, '0xFFFFFFFF'));
    set('translation', [x, y]);
    set('text', glyph);
  }

  /** Drops the glyph Labels past `count`. */
  private syncGlyphs(count: number) {
    while (this._glyphs.length > count) tmTransaction.removeNode(this.dom, this._glyphs.pop()!.node);
  }

  // ---- shadow and fill layers --------------------------------------------

  /** A new layer node, inserted before `before` (or last, when there is nothing after it). */
  private makeLayer(poster: boolean, before: any): LayerNode {
    const node = createElement(poster ? 'poster' : 'rectangle');
    if (poster) setProp(node, 'loadDisplayMode', 'scaleToFill');
    insertNode(this.dom, node, before);
    return { node, poster, written: {} };
  }

  private writeLayer(layer: LayerNode, want: DecorLayer) {
    const set = (name: string, value: any) => {
      if (layer.written[name] !== undefined && same(layer.written[name], value)) return;
      layer.written[name] = Array.isArray(value) ? value.slice() : value;
      setProp(layer.node, name, value);
    };
    set('width', want.w);
    set('height', want.h);
    set('translation', [want.x, want.y]);
    if (!layer.poster) {
      set('color', want.color);
      return;
    }
    set('blendColor', want.color);
    const effect = want.rounded && this._layerEffect ? this._layerEffect.node : null;
    if (effect) set('shaderCompatible', true);
    if (effect || layer.written.effect !== undefined) set('effect', effect);
    set('uri', want.uri);
  }

  /** Makes the shadow and layer nodes match the plan, reusing the nodes there are. */
  private syncLayers(shadow: DecorLayer | null, layers: DecorLayer[]) {
    const first = this._layers.length < layers.length || !this._shadow ? this.firstChildDom() : undefined;
    if (shadow) {
      if (!this._shadow) this._shadow = this.makeLayer(true, this.visual || (this._layers.length > 0 ? this._layers[0].node : first));
      this.writeLayer(this._shadow, shadow);
    } else if (this._shadow) {
      tmTransaction.removeNode(this.dom, this._shadow.node);
      this._shadow = null;
    }
    for (let i = 0; i < layers.length; i++) {
      const poster = layers[i].uri !== null;
      let have = this._layers[i];
      if (!have || have.poster !== poster) {
        if (have) tmTransaction.removeNode(this.dom, have.node);
        have = this._layers[i] = this.makeLayer(poster, i + 1 < this._layers.length ? this._layers[i + 1].node : first ?? this.firstChildDom());
      }
      this.writeLayer(have, layers[i]);
    }
    while (this._layers.length > layers.length) {
      tmTransaction.removeNode(this.dom, this._layers.pop()!.node);
    }
  }

  /** The child that paints first: the node's own drawing goes before it. */
  private firstChildDom(): any {
    let first = this._children[0];
    for (let i = 1; i < this._children.length; i++) {
      if (this._children[i]._zIndex < first._zIndex) first = this._children[i];
    }
    return first ? first.dom : undefined;
  }

  /** Drops the shadow, the layers and the Effect nodes (there is no visual to carry them). */
  private clearDecor() {
    if (this._shadow) tmTransaction.removeNode(this.dom, this._shadow.node);
    this._shadow = null;
    for (let i = 0; i < this._layers.length; i++) tmTransaction.removeNode(this.dom, this._layers[i].node);
    this._layers.length = 0;
    const effects = this.renderer.effects;
    this._effect = effects.swap(this._effect, null);
    this._layerEffect = effects.swap(this._layerEffect, null);
  }

  private reorder() {
    const sorted = this._children.slice().sort((a, b) => a.zIndex - b.zIndex);
    // Appending a node that is already a child moves it to the end, so
    // appending everything in paint order sorts the group: the node's own
    // drawing first (shadow, visual, layers), then the children by zIndex.
    if (this._shadow) insertNode(this.dom, this._shadow.node);
    if (this.visual) insertNode(this.dom, this.visual);
    for (let i = 0; i < this._layers.length; i++) insertNode(this.dom, this._layers[i].node);
    for (let i = 0; i < this._glyphs.length; i++) insertNode(this.dom, this._glyphs[i].node);
    for (let i = 0; i < sorted.length; i++) insertNode(this.dom, sorted[i].dom);
  }

  flush() {
    if (this._destroyed) return;
    if (this._isText) this.textLayout();
    this.ensureVisual();
    if (this._orderDirty) {
      this._orderDirty = false;
      this.reorder();
    }
    if (this._transformDirty) {
      this._transformDirty = false;
      this.writeTransform();
    }
    if (this._clipDirty) {
      this._clipDirty = false;
      this.writeClip();
    }
    if (this._visualDirty || this._effectDirty) {
      this._visualDirty = false;
      this._effectDirty = false;
      this.writeDecor();
    }
  }

  // ---- animation --------------------------------------------------------

  animate(props: SceneAnimatableProps, settings: AnimationSettings = {}): AnimationController {
    if (this._children.length && Object.keys(props || {}).some(key => key === "x" || key === "y" || key === "alpha")) this.nativeMotionRoot = true;
    const animator = this.renderer.animator;
    const controller = animator.create(this, props || {}, settings, () => this.renderer.ensureTicker());
    if (!this._anims) this._anims = new Map();
    for (const key in props || {}) this._anims.set(key, { settings, controller });
    return controller;
  }

  animateProp(name: string, value: number, settings: AnimationSettings = {}): AnimationController {
    if (this._children.length && (name === "x" || name === "y" || name === "alpha")) this.nativeMotionRoot = true;
    const animator = this.renderer.animator;
    if (!this._anims) this._anims = new Map();
    const color = isColorKey(name);
    const existing = this._anims.get(name);
    // Colour animations restart from the current colour. Retargeting the
    // progress-based colour animation would replace its 0..1 progress target
    // with a colour value.
    if (!color && existing && existing.settings === settings &&
      (existing.controller.nativeClock || !this.renderer.host?.canNativeAnimate?.(this, name, settings))) {
      existing.controller.retarget(value);
      return existing.controller;
    }
    if (existing) existing.controller.stop();
    const controller = animator.create(this, { [name]: value }, settings, () => this.renderer.ensureTicker());
    this._anims.set(name, { settings, controller });
    return controller.start();
  }

  animation(name: string) {
    const entry = this._anims ? this._anims.get(name) : undefined;
    return entry ? entry.controller : undefined;
  }
  get animations() { return this._anims || new Map(); }
  setAnimationValue(name: string, value: any) { (this as any)[name] = value; }

  /**
   * Marks a property as driven by a SceneGraph animation on the render
   * thread: the JS flush must not write it until the animation releases it,
   * or the write would fight the interpolator. The other axis of a translation
   * is snapped through its request field instead (see `writeTransform`).
   */
  holdNativeMotion(key: string) {
    if (!this.nativeMotionOwned) this.nativeMotionOwned = new Set();
    this.nativeMotionOwned.add(key);
  }

  /** Hands a property back to the JS flush, which writes its final value. */
  releaseNativeMotion(key: string) {
    if (!this.nativeMotionOwned?.delete(key)) return;
    if (this.nativeMotionOwned.size === 0) this.nativeMotionOwned = undefined;
    this.markTransform(key === 'alpha' ? 'alpha' : 'position');
  }
  stopAnimation(name: string) {
    const animation = this.animation(name);
    if (animation) animation.stop();
  }
  stopAnimations() {
    if (this._anims) this._anims.forEach((entry) => entry.controller.stop());
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    // Raw removals alone do not open the SDK transaction that commits them.
    setProp(this.dom, "visible", false);
    this._claimedVisual = null;
    if (this.renderer.animator) this.renderer.animator.removeFor(this);
    const kids = this._children.slice();
    for (let i = 0; i < kids.length; i++) kids[i].destroy();
    this._children.length = 0;
    if (this._shader) this._shader.nodes.delete(this);
    this._imageRequest?.invalidate();
    this.clearDecor();
    this.syncGlyphs(0);
    if (this._face !== null) {
      this.renderer.fonts.release(this._face);
      this._face = null;
    }
    if (this.visual) {
      try { tmTransaction.removeNode(this.dom, this.visual); } catch (e) { /* already detached */ }
      this.visual = null;
    }
    const parentDom = this.dom && this.dom.parent;
    if (parentDom) {
      try { tmTransaction.removeNode(parentDom, this.dom); } catch (e) { /* already detached */ }
    }
    if (this._parent) {
      const i = this._parent._children.indexOf(this);
      if (i >= 0) this._parent._children.splice(i, 1);
      this._parent = null;
      geometryEpoch++;
    }
    this.removeAllListeners();
  }
}

