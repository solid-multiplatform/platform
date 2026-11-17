import { Node, } from './Node.js';
import { DIRTY_LAYOUT, DIRTY_LOCAL, DIRTY_SHADER, NULL } from './NodeFlags.js';
import { F_H, F_STRIDE, F_W } from './NodeLayout.js';
/**
 * A text node's state (NodeStore.texts): its text props, with 1.10's
 * defaults, the layout it draws, and TextNodes' bookkeeping. One per text
 * node; the handle holds nothing of it.
 */
export class TextState {
    constructor() {
        this.text = '';
        this.fontFamily = 'sans-serif';
        this.fontSize = 16;
        this.fontStyle = 'normal';
        this.lineHeight = 1.2;
        this.textAlign = 'left';
        this.verticalAlign = 'top';
        this.contain = 'none';
        this.maxWidth = 0;
        this.maxHeight = 0;
        this.maxLines = 0;
        this.overflowSuffix = '...';
        this.wordBreak = 'break-word';
        this.letterSpacing = 0;
        this.offsetY = 0;
        this.forceLoad = false;
        /**
         * The resolved layout direction the layout was made for (ST_RTL, written
         * here by TextNodes.layoutText, not the `rtl` prop): under rtl, `left`
         * and `right` alignment swap. For a state measureText builds, what its
         * props said.
         */
        this.rtl = false;
        /** The layout drawn; null before the first and while the font is missing. */
        this.layout = null;
        /** The font `layout` was made with. */
        this.font = null;
        /** A prop the layout reads changed since it was made. */
        this.stale = true;
        /** The font name the node waits on in TextNodes, or null. */
        this.waiting = null;
        /** Listed in TextNodes' forceLoad list. */
        this.forced = false;
        // The text box (ST_TEXT_BOX): the box mount and pivot use, and the
        // block's offset in the node.
        this.boxW = 0;
        this.boxH = 0;
        this.boxX = 0;
        this.boxY = 0;
    }
}
/** Read by a destroyed handle: the defaults. */
const DEFAULTS = new TextState();
function stateOf(n) {
    const id = n.id;
    return id === NULL ? DEFAULTS : n.renderer.nodes.texts[id];
}
/** The state to write, null for a destroyed handle. */
function writable(n) {
    const id = n.id;
    return id === NULL ? null : n.renderer.nodes.texts[id];
}
/** A prop the layout reads changed: lay out again. */
function relayout(n, t) {
    t.stale = true;
    n.renderer.nodes.markDirty(n.id, DIRTY_LAYOUT);
}
/**
 * A prop that only places the block changed (contain, verticalAlign,
 * offsetY): the layout stays, its box is derived again.
 */
function rebox(n) {
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
    constructor(renderer, id) {
        super(renderer, id);
    }
    get w() {
        return this.renderer.nodes.f64[this.id * F_STRIDE + F_W];
    }
    set w(v) {
        this.maxWidth = v;
    }
    get h() {
        return this.renderer.nodes.f64[this.id * F_STRIDE + F_H];
    }
    set h(v) {
        this.maxHeight = v;
    }
    get text() {
        return stateOf(this).text;
    }
    set text(v) {
        const t = writable(this);
        if (v === undefined)
            v = '';
        if (t === null || t.text === v) {
            return;
        }
        t.text = v;
        relayout(this, t);
    }
    get fontFamily() {
        return stateOf(this).fontFamily;
    }
    set fontFamily(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'sans-serif';
        if (t === null || t.fontFamily === v) {
            return;
        }
        t.fontFamily = v;
        relayout(this, t);
    }
    get fontSize() {
        return stateOf(this).fontSize;
    }
    set fontSize(v) {
        const t = writable(this);
        if (v === undefined)
            v = 16;
        if (t === null || t.fontSize === v) {
            return;
        }
        t.fontSize = v;
        relayout(this, t);
    }
    get fontStyle() {
        return stateOf(this).fontStyle;
    }
    set fontStyle(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'normal';
        if (t === null || t.fontStyle === v) {
            return;
        }
        t.fontStyle = v;
        relayout(this, t);
    }
    get lineHeight() {
        return stateOf(this).lineHeight;
    }
    set lineHeight(v) {
        const t = writable(this);
        if (v === undefined)
            v = 1.2;
        if (t === null || t.lineHeight === v) {
            return;
        }
        t.lineHeight = v;
        relayout(this, t);
    }
    get textAlign() {
        return stateOf(this).textAlign;
    }
    set textAlign(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'left';
        if (t === null || t.textAlign === v) {
            return;
        }
        t.textAlign = v;
        relayout(this, t);
    }
    get maxWidth() {
        return stateOf(this).maxWidth;
    }
    set maxWidth(v) {
        const t = writable(this);
        if (v === undefined)
            v = 0;
        if (t === null || t.maxWidth === v) {
            return;
        }
        t.maxWidth = v;
        relayout(this, t);
    }
    get maxHeight() {
        return stateOf(this).maxHeight;
    }
    set maxHeight(v) {
        const t = writable(this);
        if (v === undefined)
            v = 0;
        if (t === null || t.maxHeight === v) {
            return;
        }
        t.maxHeight = v;
        relayout(this, t);
    }
    get maxLines() {
        return stateOf(this).maxLines;
    }
    set maxLines(v) {
        const t = writable(this);
        if (v === undefined)
            v = 0;
        if (t === null || t.maxLines === v) {
            return;
        }
        t.maxLines = v;
        relayout(this, t);
    }
    get overflowSuffix() {
        return stateOf(this).overflowSuffix;
    }
    set overflowSuffix(v) {
        const t = writable(this);
        if (v === undefined)
            v = '...';
        if (t === null || t.overflowSuffix === v) {
            return;
        }
        t.overflowSuffix = v;
        relayout(this, t);
    }
    get wordBreak() {
        return stateOf(this).wordBreak;
    }
    set wordBreak(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'break-word';
        if (t === null || t.wordBreak === v) {
            return;
        }
        t.wordBreak = v;
        relayout(this, t);
    }
    get letterSpacing() {
        return stateOf(this).letterSpacing;
    }
    set letterSpacing(v) {
        const t = writable(this);
        if (v === undefined)
            v = 0;
        if (t === null || t.letterSpacing === v) {
            return;
        }
        t.letterSpacing = v;
        relayout(this, t);
    }
    get contain() {
        return stateOf(this).contain;
    }
    set contain(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'none';
        if (t === null || t.contain === v) {
            return;
        }
        t.contain = v;
        rebox(this);
    }
    get verticalAlign() {
        return stateOf(this).verticalAlign;
    }
    set verticalAlign(v) {
        const t = writable(this);
        if (v === undefined)
            v = 'top';
        if (t === null || t.verticalAlign === v) {
            return;
        }
        t.verticalAlign = v;
        rebox(this);
    }
    get offsetY() {
        return stateOf(this).offsetY;
    }
    set offsetY(v) {
        const t = writable(this);
        if (v === undefined)
            v = 0;
        if (t === null || t.offsetY === v) {
            return;
        }
        t.offsetY = v;
        rebox(this);
    }
    get forceLoad() {
        return stateOf(this).forceLoad;
    }
    /**
     * On, the node lays out wherever it is, even while it is not visited
     * (TextNodes lays it out before the walk).
     */
    set forceLoad(v) {
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
    measure() {
        const id = this.id;
        if (id === NULL) {
            return false;
        }
        return this.renderer.textNodes.measure(id);
    }
}
/** A size as 1.10's `||` default read it: 0, NaN, null and undefined are unset. */
const orNumber = (v, d) => v === 0 || Number.isNaN(v) === true ? d : v;
/** A string as 1.10's `||` default read it: '' is unset. */
const orString = (v, d) => v === '' ? d : v;
/**
 * The node's own size before its first layout (1.10 stored a created text
 * node's w and h as its size; only the setters set maxWidth / maxHeight).
 */
function setSize(n, field, v) {
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
export function applyTextProps(node, props) {
    const s = node.renderer.nodes;
    const t = s.texts[node.id];
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
    const bag = props;
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
                setSize(node, F_W, value);
                break;
            case 'h':
                setSize(node, F_H, value);
                break;
            case 'x':
                node.x = value;
                break;
            case 'y':
                node.y = value;
                break;
            case 'alpha':
                node.alpha = value;
                break;
            case 'colorTl':
                node.colorTl = value;
                break;
            case 'colorTr':
                node.colorTr = value;
                break;
            case 'colorBl':
                node.colorBl = value;
                break;
            case 'colorBr':
                node.colorBr = value;
                break;
            case 'scaleX':
                node.scaleX = value;
                break;
            case 'scaleY':
                node.scaleY = value;
                break;
            case 'rotation':
                node.rotation = value;
                break;
            case 'mountX':
                node.mountX = value;
                break;
            case 'mountY':
                node.mountY = value;
                break;
            case 'pivotX':
                node.pivotX = value;
                break;
            case 'pivotY':
                node.pivotY = value;
                break;
            case 'zIndex':
                node.zIndex = value;
                break;
            case 'clipping':
                node.clipping = value;
                break;
            case 'ignoreParentAlpha':
                node.ignoreParentAlpha = value;
                break;
            case 'placeholderColor':
                node.placeholderColor = value;
                break;
            case 'autosize':
                node.autosize = value;
                break;
            case 'rtl':
                node.rtl = value;
                break;
            case 'data':
                node.data = value;
                break;
            case 'srcX':
                node.srcX = value;
                break;
            case 'srcY':
                node.srcY = value;
                break;
            case 'srcWidth':
                node.srcWidth = value;
                break;
            case 'srcHeight':
                node.srcHeight = value;
                break;
            case 'imageType':
                node.imageType = value;
                break;
            case 'textureOptions':
                node.textureOptions = value;
                break;
            case 'texture':
                node.texture = value;
                break;
            case 'shader':
                node.shader = value;
                break;
            case 'componentName':
                node.componentName = value;
                break;
            case 'componentLocation':
                node.componentLocation = value;
                break;
            case 'atlasGroup':
                node.atlasGroup = value;
                break;
            default:
                setTextProp(t, key, value);
                break;
        }
    }
    if (props.src !== undefined && props.src !== null)
        node.src = props.src;
    if (props.parent !== undefined && props.parent !== null)
        node.parent = props.parent;
}
/**
 * Store text prop `key` of a props bag in `t` with 1.10's creation
 * defaults (applyTextProps, textStateFrom); any other key is ignored.
 */
function setTextProp(t, key, value) {
    switch (key) {
        case 'text':
            t.text = value;
            break;
        case 'fontFamily':
            t.fontFamily = orString(value, 'sans-serif');
            break;
        case 'fontSize':
            t.fontSize = orNumber(value, 16);
            break;
        case 'fontStyle':
            t.fontStyle = orString(value, 'normal');
            break;
        case 'lineHeight':
            t.lineHeight = orNumber(value, 1.2);
            break;
        case 'textAlign':
            t.textAlign = orString(value, 'left');
            break;
        case 'verticalAlign':
            t.verticalAlign = orString(value, 'top');
            break;
        case 'contain':
            t.contain = orString(value, 'none');
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
            t.wordBreak = orString(value, 'break-word');
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
export function textStateFrom(props) {
    const t = new TextState();
    const bag = props;
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
//# sourceMappingURL=TextNode.js.map