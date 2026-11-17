import { Node, type INodeProps, type NodeOwner } from './Node.js';
import type { TextBox } from '../scene/transform.js';
import type { TextLayout } from '../text/TextLayout.js';
import type { FontRecord } from '../text/FontRegistry.js';
import type { TextNodes } from '../text/TextNodes.js';
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
export interface ITextNodeProps extends INodeProps, TextProps {
}
/** What a text node needs from its renderer (RendererCore). */
export interface TextOwner extends NodeOwner {
    readonly textNodes: TextNodes;
}
/**
 * A text node's state (NodeStore.texts): its text props, with 1.10's
 * defaults, the layout it draws, and TextNodes' bookkeeping. One per text
 * node; the handle holds nothing of it.
 */
export declare class TextState implements TextProps, TextBox {
    text: string;
    fontFamily: string;
    fontSize: number;
    fontStyle: TextFontStyle;
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
    offsetY: number;
    forceLoad: boolean;
    /**
     * The resolved layout direction the layout was made for (ST_RTL, written
     * here by TextNodes.layoutText, not the `rtl` prop): under rtl, `left`
     * and `right` alignment swap. For a state measureText builds, what its
     * props said.
     */
    rtl: boolean;
    /** The layout drawn; null before the first and while the font is missing. */
    layout: TextLayout | null;
    /** The font `layout` was made with. */
    font: FontRecord | null;
    /** A prop the layout reads changed since it was made. */
    stale: boolean;
    /** The font name the node waits on in TextNodes, or null. */
    waiting: string | null;
    /** Listed in TextNodes' forceLoad list. */
    forced: boolean;
    boxW: number;
    boxH: number;
    boxX: number;
    boxY: number;
}
/**
 * A text node (spec 10, 1.10 CoreTextNode): a Node whose content is SDF
 * text. Its size is its layout's; `w` and `h` written after creation set
 * `maxWidth` and `maxHeight`, as in 1.10. A prop the layout reads lays the
 * text out again in the next walk; `contain`, `verticalAlign` and
 * `offsetY` only move the block.
 */
export declare class TextNode extends Node {
    readonly renderer: TextOwner;
    constructor(renderer: TextOwner, id: number);
    get w(): number;
    set w(v: number);
    get h(): number;
    set h(v: number);
    get text(): string;
    set text(v: string | undefined);
    get fontFamily(): string;
    set fontFamily(v: string | undefined);
    get fontSize(): number;
    set fontSize(v: number | undefined);
    get fontStyle(): TextFontStyle;
    set fontStyle(v: TextFontStyle | undefined);
    get lineHeight(): number;
    set lineHeight(v: number | undefined);
    get textAlign(): TextAlign;
    set textAlign(v: TextAlign | undefined);
    get maxWidth(): number;
    set maxWidth(v: number | undefined);
    get maxHeight(): number;
    set maxHeight(v: number | undefined);
    get maxLines(): number;
    set maxLines(v: number | undefined);
    get overflowSuffix(): string;
    set overflowSuffix(v: string | undefined);
    get wordBreak(): TextWordBreak;
    set wordBreak(v: TextWordBreak | undefined);
    get letterSpacing(): number;
    set letterSpacing(v: number | undefined);
    get contain(): TextContain;
    set contain(v: TextContain | undefined);
    get verticalAlign(): TextVerticalAlign;
    set verticalAlign(v: TextVerticalAlign | undefined);
    get offsetY(): number;
    set offsetY(v: number | undefined);
    get forceLoad(): boolean;
    /**
     * On, the node lays out wherever it is, even while it is not visited
     * (TextNodes lays it out before the walk).
     */
    set forceLoad(v: boolean | undefined);
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
    measure(): boolean;
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
export declare function applyTextProps(node: TextNode, props: Partial<ITextNodeProps>): void;
/**
 * The text state a text node created with `props` starts with
 * (RendererCore.measureText): its text props as createTextNode stores
 * them, the rest of the bag ignored.
 */
export declare function textStateFrom(props: Partial<ITextNodeProps>): TextState;
