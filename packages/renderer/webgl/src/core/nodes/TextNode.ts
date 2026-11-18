import {
  Node,
  type ClippingValue,
  type ImageType,
  type INodeProps,
  type NodeOwner,
} from './Node.js';
import type { TextureOptions } from '../../common/types.js';
import type { TextBox } from '../scene/transform.js';
import type { TextLayout } from '../text/TextLayout.js';
import type { FontRecord } from '../text/FontRegistry.js';
import type { TextNodes } from '../text/TextNodes.js';
import { DIRTY_LAYOUT, DIRTY_LOCAL, DIRTY_SHADER, NULL } from './NodeFlags.js';
import { F_H, F_STRIDE, F_W } from './NodeLayout.js';

export type TextAlign = 'left' | 'center' | 'right';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';
export type TextContain = 'none' | 'width' | 'height' | 'both';
export type TextWordBreak = 'overflow' | 'break-all' | 'break-word';
export type TextFontStyle = 'normal' | 'italic' | 'oblique';

/** A text node's own props (spec 13.1; 1.10 TrProps and forceLoad). */
export interface TextProps {
  text: string;
  /** An SDF font's name or alias (loadFont); 'sans-serif' by default, as in 1.10. */
  fontFamily: string;
  fontSize: number;
  /** Accepted and ignored: an SDF font has no style axis (1.10). */
  fontStyle: TextFontStyle;
  /** A multiplier of the font's line height at or below 3, else pixels. */
  lineHeight: number;
  textAlign: TextAlign;
  verticalAlign: TextVerticalAlign;
  contain: TextContain;
  maxWidth: number;
  maxHeight: number;
  maxLines: number;
  overflowSuffix: string;
  wordBreak: TextWordBreak;
  letterSpacing: number;
  /** Moves the text down by this many pixels (1.10 stored it and drew nothing different). */
  offsetY: number;
  /** Lay out even while the node's parent is out of bounds or hidden. */
  forceLoad: boolean;
}

/** Props of `createTextNode` (1.10 ITextNodeProps). */
export interface ITextNodeProps extends INodeProps, TextProps {}

/** What a text node needs from its renderer (RendererCore). */
export interface TextOwner extends NodeOwner {
  readonly textNodes: TextNodes;
}

/**
 * A text node's state (NodeStore.texts): its text props, with 1.10's
 * defaults, the layout it draws, and TextNodes' bookkeeping. One per text
 * node; the handle holds nothing of it.
 */
export class TextState implements TextProps, TextBox {
  text = '';
  fontFamily = 'sans-serif';
  fontSize = 16;
  fontStyle: TextFontStyle = 'normal';
  lineHeight = 1.2;
  textAlign: TextAlign = 'left';
  verticalAlign: TextVerticalAlign = 'top';
  contain: TextContain = 'none';
  maxWidth = 0;
  maxHeight = 0;
  maxLines = 0;
  overflowSuffix = '...';
  wordBreak: TextWordBreak = 'break-word';
  letterSpacing = 0;
  offsetY = 0;
  forceLoad = false;
  /**
   * The resolved layout direction the layout was made for (ST_RTL, written
   * here by TextNodes.layoutText, not the `rtl` prop): under rtl, `left`
   * and `right` alignment swap. For a state measureText builds, what its
   * props said.
   */
  rtl = false;
  /** The layout drawn; null before the first and while the font is missing. */
  layout: TextLayout | null = null;
  /** The font `layout` was made with. */
  font: FontRecord | null = null;
  /** A prop the layout reads changed since it was made. */
  stale = true;
  /** The font name the node waits on in TextNodes, or null. */
  waiting: string | null = null;
  /** Listed in TextNodes' forceLoad list. */
  forced = false;
  // The text box (ST_TEXT_BOX): the box mount and pivot use, and the
  // block's offset in the node.
  boxW = 0;
  boxH = 0;
  boxX = 0;
  boxY = 0;
}

/** Read by a destroyed handle: the defaults. */
const DEFAULTS = new TextState();

function stateOf(n: TextNode): TextState {
  const id = n.id;
  return id === NULL ? DEFAULTS : (n.renderer.nodes.texts[id] as TextState);
}

/** The state to write, null for a destroyed handle. */
function writable(n: TextNode): TextState | null {
  const id = n.id;
  return id === NULL ? null : (n.renderer.nodes.texts[id] as TextState);
}

/** A prop the layout reads changed: lay out again. */
function relayout(n: TextNode, t: TextState): void {
  t.stale = true;
  n.renderer.nodes.markDirty(n.id, DIRTY_LAYOUT);
}

/**
 * A prop that only places the block changed (contain, verticalAlign,
 * offsetY): the layout stays, its box is derived again.
 */
function rebox(n: TextNode): void {
  n.renderer.nodes.markDirty(n.id, DIRTY_LAYOUT);
}

/**
 * A text node (spec 10, 1.10 CoreTextNode): a Node whose content is SDF
 * text. Its size is its layout's; `w` and `h` written after creation set
 * `maxWidth` and `maxHeight`, as in 1.10. A prop the layout reads lays the
 * text out again in the next walk; `contain`, `verticalAlign` and
 * `offsetY` only move the block.
 */
export class TextNode extends Node {
  declare readonly renderer: TextOwner;

  constructor(renderer: TextOwner, id: number) {
    super(renderer, id);
  }

  override get w(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_W]!;
  }
  override set w(v: number) {
    this.maxWidth = v;
  }
  override get h(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_H]!;
  }
  override set h(v: number) {
    this.maxHeight = v;
  }

  get text(): string {
    return stateOf(this).text;
  }
  set text(v: string | undefined) {
    const t = writable(this);
    if (v === undefined) v = '';
    if (t === null || t.text === v) {
      return;
    }
    t.text = v;
    relayout(this, t);
  }

  get fontFamily(): string {
    return stateOf(this).fontFamily;
  }
  set fontFamily(v: string | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'sans-serif';
    if (t === null || t.fontFamily === v) {
      return;
    }
    t.fontFamily = v;
    relayout(this, t);
  }

  get fontSize(): number {
    return stateOf(this).fontSize;
  }
  set fontSize(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 16;
    if (t === null || t.fontSize === v) {
      return;
    }
    t.fontSize = v;
    relayout(this, t);
  }

  get fontStyle(): TextFontStyle {
    return stateOf(this).fontStyle;
  }
  set fontStyle(v: TextFontStyle | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'normal';
    if (t === null || t.fontStyle === v) {
      return;
    }
    t.fontStyle = v;
    relayout(this, t);
  }

  get lineHeight(): number {
    return stateOf(this).lineHeight;
  }
  set lineHeight(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 1.2;
    if (t === null || t.lineHeight === v) {
      return;
    }
    t.lineHeight = v;
    relayout(this, t);
  }

  get textAlign(): TextAlign {
    return stateOf(this).textAlign;
  }
  set textAlign(v: TextAlign | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'left';
    if (t === null || t.textAlign === v) {
      return;
    }
    t.textAlign = v;
    relayout(this, t);
  }

  get maxWidth(): number {
    return stateOf(this).maxWidth;
  }
  set maxWidth(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 0;
    if (t === null || t.maxWidth === v) {
      return;
    }
    t.maxWidth = v;
    relayout(this, t);
  }

  get maxHeight(): number {
    return stateOf(this).maxHeight;
  }
  set maxHeight(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 0;
    if (t === null || t.maxHeight === v) {
      return;
    }
    t.maxHeight = v;
    relayout(this, t);
  }

  get maxLines(): number {
    return stateOf(this).maxLines;
  }
  set maxLines(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 0;
    if (t === null || t.maxLines === v) {
      return;
    }
    t.maxLines = v;
    relayout(this, t);
  }

  get overflowSuffix(): string {
    return stateOf(this).overflowSuffix;
  }
  set overflowSuffix(v: string | undefined) {
    const t = writable(this);
    if (v === undefined) v = '...';
    if (t === null || t.overflowSuffix === v) {
      return;
    }
    t.overflowSuffix = v;
    relayout(this, t);
  }

  get wordBreak(): TextWordBreak {
    return stateOf(this).wordBreak;
  }
  set wordBreak(v: TextWordBreak | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'break-word';
    if (t === null || t.wordBreak === v) {
      return;
    }
    t.wordBreak = v;
    relayout(this, t);
  }

  get letterSpacing(): number {
    return stateOf(this).letterSpacing;
  }
  set letterSpacing(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 0;
    if (t === null || t.letterSpacing === v) {
      return;
    }
    t.letterSpacing = v;
    relayout(this, t);
  }

  get contain(): TextContain {
    return stateOf(this).contain;
  }
  set contain(v: TextContain | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'none';
    if (t === null || t.contain === v) {
      return;
    }
    t.contain = v;
    rebox(this);
  }

  get verticalAlign(): TextVerticalAlign {
    return stateOf(this).verticalAlign;
  }
  set verticalAlign(v: TextVerticalAlign | undefined) {
    const t = writable(this);
    if (v === undefined) v = 'top';
    if (t === null || t.verticalAlign === v) {
      return;
    }
    t.verticalAlign = v;
    rebox(this);
  }

  get offsetY(): number {
    return stateOf(this).offsetY;
  }
  set offsetY(v: number | undefined) {
    const t = writable(this);
    if (v === undefined) v = 0;
    if (t === null || t.offsetY === v) {
      return;
    }
    t.offsetY = v;
    rebox(this);
  }

  get forceLoad(): boolean {
    return stateOf(this).forceLoad;
  }
  /**
   * On, the node lays out wherever it is, even while it is not visited
   * (TextNodes lays it out before the walk).
   */
  set forceLoad(v: boolean | undefined) {
    const t = writable(this);
    const on = v === true;
    if (t === null || t.forceLoad === on) {
      return;
    }
    t.forceLoad = on;
    this.renderer.textNodes.force(this.id, on);
    if (on === true) {
      rebox(this);
    }
  }

  /**
   * Lay the text out now, when a prop the layout reads changed since its
   * last layout, instead of in the next walk: for a framework that sizes
   * its layout by the text before the frame (Solid's flex). `w` and `h`
   * read the layout's size at once, wherever the node is (under a hidden
   * or out-of-bounds parent too); the next walk reuses the layout, placing
   * and drawing it; a `loaded` listener hears it between the walks of the
   * next frame, as after a layout in the walk. Returns false while the
   * font's description is missing, changing nothing (the walk lays the
   * text out once it arrives, and tells `loaded`), and for a destroyed
   * node; true otherwise.
   */
  measure(): boolean {
    const id = this.id;
    if (id === NULL) {
      return false;
    }
    return this.renderer.textNodes.measure(id);
  }
}

/** A size as 1.10's `||` default read it: 0, NaN, null and undefined are unset. */
const orNumber = (v: unknown, d: number): number =>
  v === 0 || Number.isNaN(v) === true ? d : (v as number);

/** A string as 1.10's `||` default read it: '' is unset. */
const orString = (v: unknown, d: string): string =>
  v === '' ? d : (v as string);

/**
 * The node's own size before its first layout (1.10 stored a created text
 * node's w and h as its size; only the setters set maxWidth / maxHeight).
 */
function setSize(n: TextNode, field: number, v: number): void {
  const id = n.id;
  const s = n.renderer.nodes;
  const i = id * F_STRIDE + field;
  if (s.f64[i] === v) {
    return;
  }
  s.f64[i] = v;
  s.markDirty(id, DIRTY_LOCAL | DIRTY_SHADER);
}

/**
 * Apply a text node's props bag (createTextNode): Node's props in 1.10
 * order (the groups first, src after texture, parent last) and the text
 * props with 1.10's creation defaults (`text ?? ''`, `fontSize || 16` and
 * so on: an empty or zero value keeps the default). A loop of its own
 * rather than applyNodeProps: a framework's large text bags (Solid's, in
 * dictionary mode) never reach the node applier's for...in. The node keys
 * repeat applyNodeProps's cases for that reason. A fresh node is dirty for
 * layout already, so the text props are stored without marking.
 */
export function applyTextProps(
  node: TextNode,
  props: Partial<ITextNodeProps>,
): void {
  const s = node.renderer.nodes;
  const t = s.texts[node.id] as TextState;
  if (props.color !== undefined && props.color !== null)
    node.color = props.color;
  if (props.colorLeft !== undefined && props.colorLeft !== null)
    node.colorLeft = props.colorLeft;
  if (props.colorRight !== undefined && props.colorRight !== null)
    node.colorRight = props.colorRight;
  if (props.colorTop !== undefined && props.colorTop !== null)
    node.colorTop = props.colorTop;
  if (props.colorBottom !== undefined && props.colorBottom !== null)
    node.colorBottom = props.colorBottom;
  if (props.scale !== undefined && props.scale !== null)
    node.scale = props.scale;
  if (props.mount !== undefined && props.mount !== null)
    node.mount = props.mount;
  if (props.pivot !== undefined && props.pivot !== null)
    node.pivot = props.pivot;

  const bag = props as Record<string, unknown>;
  for (const key in bag) {
    const value = bag[key];
    if (value === undefined || value === null) {
      continue;
    }
    switch (key) {
      case 'forceLoad':
        node.forceLoad = value === true;
        break;
      case 'w':
        setSize(node, F_W, value as number);
        break;
      case 'h':
        setSize(node, F_H, value as number);
        break;
      case 'x':
        node.x = value as number;
        break;
      case 'y':
        node.y = value as number;
        break;
      case 'alpha':
        node.alpha = value as number;
        break;
      case 'colorTl':
        node.colorTl = value as number;
        break;
      case 'colorTr':
        node.colorTr = value as number;
        break;
      case 'colorBl':
        node.colorBl = value as number;
        break;
      case 'colorBr':
        node.colorBr = value as number;
        break;
      case 'scaleX':
        node.scaleX = value as number;
        break;
      case 'scaleY':
        node.scaleY = value as number;
        break;
      case 'rotation':
        node.rotation = value as number;
        break;
      case 'mountX':
        node.mountX = value as number;
        break;
      case 'mountY':
        node.mountY = value as number;
        break;
      case 'pivotX':
        node.pivotX = value as number;
        break;
      case 'pivotY':
        node.pivotY = value as number;
        break;
      case 'zIndex':
        node.zIndex = value as number;
        break;
      case 'clipping':
        node.clipping = value as ClippingValue;
        break;
      case 'ignoreParentAlpha':
        node.ignoreParentAlpha = value as boolean;
        break;
      case 'placeholderColor':
        node.placeholderColor = value as number;
        break;
      case 'autosize':
        node.autosize = value as boolean;
        break;
      case 'rtl':
        node.rtl = value as boolean;
        break;
      case 'data':
        node.data = value as Record<string, unknown> | null;
        break;
      case 'srcX':
        node.srcX = value as number;
        break;
      case 'srcY':
        node.srcY = value as number;
        break;
      case 'srcWidth':
        node.srcWidth = value as number;
        break;
      case 'srcHeight':
        node.srcHeight = value as number;
        break;
      case 'imageType':
        node.imageType = value as ImageType;
        break;
      case 'textureOptions':
        node.textureOptions = value as TextureOptions | null;
        break;
      case 'texture':
        node.texture = value as object | null;
        break;
      case 'shader':
        node.shader = value as object | null;
        break;
      case 'componentName':
        node.componentName = value as string;
        break;
      case 'componentLocation':
        node.componentLocation = value as string;
        break;
      case 'atlasGroup':
        node.atlasGroup = value as string;
        break;
      default:
        setTextProp(t, key, value);
        break;
    }
  }

  if (props.src !== undefined && props.src !== null) node.src = props.src;
  if (props.parent !== undefined && props.parent !== null)
    node.parent = props.parent;
}

/**
 * Store text prop `key` of a props bag in `t` with 1.10's creation
 * defaults (applyTextProps, textStateFrom); any other key is ignored.
 */
function setTextProp(t: TextState, key: string, value: unknown): void {
  switch (key) {
    case 'text':
      t.text = value as string;
      break;
    case 'fontFamily':
      t.fontFamily = orString(value, 'sans-serif');
      break;
    case 'fontSize':
      t.fontSize = orNumber(value, 16);
      break;
    case 'fontStyle':
      t.fontStyle = orString(value, 'normal') as TextFontStyle;
      break;
    case 'lineHeight':
      t.lineHeight = orNumber(value, 1.2);
      break;
    case 'textAlign':
      t.textAlign = orString(value, 'left') as TextAlign;
      break;
    case 'verticalAlign':
      t.verticalAlign = orString(value, 'top') as TextVerticalAlign;
      break;
    case 'contain':
      t.contain = orString(value, 'none') as TextContain;
      break;
    case 'maxWidth':
      t.maxWidth = orNumber(value, 0);
      break;
    case 'maxHeight':
      t.maxHeight = orNumber(value, 0);
      break;
    case 'maxLines':
      t.maxLines = orNumber(value, 0);
      break;
    case 'overflowSuffix':
      t.overflowSuffix = orString(value, '...');
      break;
    case 'wordBreak':
      t.wordBreak = orString(value, 'break-word') as TextWordBreak;
      break;
    case 'letterSpacing':
      t.letterSpacing = orNumber(value, 0);
      break;
    case 'offsetY':
      t.offsetY = orNumber(value, 0);
      break;
    default:
      break;
  }
}

/**
 * The text state a text node created with `props` starts with
 * (RendererCore.measureText): its text props as createTextNode stores
 * them, the rest of the bag ignored.
 */
export function textStateFrom(props: Partial<ITextNodeProps>): TextState {
  const t = new TextState();
  const bag = props as Record<string, unknown>;
  for (const key in bag) {
    const value = bag[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (key === 'rtl') {
      // The direction the measured layout is for, so that a node resolving
      // to it looks this layout up.
      t.rtl = value === true;
      continue;
    }
    setTextProp(t, key, value);
  }
  return t;
}
