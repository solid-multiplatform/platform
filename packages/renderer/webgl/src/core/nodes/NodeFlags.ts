import type { RenderStateValue } from '../../common/types.js';

/** Sentinel for "no node" / "no record" in Int32 link arrays. */
export const NULL = -1;

// Dirty bits: raised by setters and hooks, consumed and cleared by the scene pass.
export const DIRTY_LOCAL = 1; // x y w h mount pivot scale rotation contain changed
export const DIRTY_ALPHA = 2; // alpha or ignoreParentAlpha changed
export const DIRTY_COLOR = 4; // a corner color or placeholderColor changed
export const DIRTY_CLIP = 8; // clipping prop changed
export const DIRTY_TEXTURE = 16; // src / texture / textureOptions / src rect changed
export const DIRTY_SHADER = 32; // shader assigned, a shader prop changed, or w/h changed
export const DIRTY_RENDERABLE = 64; // re-derive renderability
export const DIRTY_INHERITED = 128; // parent changed: re-derive world transform, alpha and clip
export const DIRTY_LAYOUT = 256; // text layout is stale (text nodes)
export const DIRTY_CHILD = 512; // some descendant has dirty bits; advisory only, never sufficient to skip a subtree (see NodeStore.markDirty)
export const DIRTY_DIRECTION = 1024; // rtl written: re-derive ST_RTL, then the children's
export const DIRTY_SELF = 1535; // every bit except DIRTY_CHILD

// Inherit mask bits, pushed from a parent to its children during the pass.
export const INH_TRANSFORM = 1;
export const INH_ALPHA = 2;
export const INH_CLIP = 4;
export const INH_DIRECTION = 8;
export const INH_ALL = 15;

// State bits. Input bits are written by setters; derived bits by the pass.
export const ST_SIMPLE = 1; // derived: rotation 0, scale 1, no contain resize
export const ST_WORLD_TRANSLATE = 2; // derived: world transform is a pure translation; set means wa..wd hold 1, 0, 0, 1; only composeWorld may set it or write wa..wd
export const ST_CLIPS = 4; // input: clipping !== false
export const ST_RENDERABLE = 8; // derived
export const ST_CONTENT_READY = 16; // derived: the texture the node shows is uploaded (TextureNodes; a text node's readiness is ST_TEXT_READY)
export const ST_PLACEHOLDER = 32; // derived: placeholderColor !== 0 while content is not ready
export const ST_HAS_COLOR = 64; // derived: any corner color !== 0
export const ST_TEXT = 128; // input: node is a TextNode
export const ST_PER_OP = 256; // derived: the node's program declares per-op uniforms (world alpha, quad growth) or its type a canBatch, so ScenePass.emit asks perOpMatch (ShaderRegistry.pack sets it)
export const ST_IGNORE_PARENT_ALPHA = 512; // input
export const ST_AUTOSIZE = 1024; // input
export const ST_PRELOAD = 2048; // input: textureOptions.preload
export const ST_CONTAIN = 4096; // input: textureOptions.resizeMode.type is 'contain' (composeWorld applies it once the texture size is known)
export const ST_CHILDREN_STALE = 8192; // derived: children were skipped while this node was culled
export const ST_VIS_SHIFT = 14;
export const ST_VIS_MASK = 3 << ST_VIS_SHIFT;
// Derived: DIRTY_TEXTURE / DIRTY_SHADER work parked while the node is out
// of bounds (kept out of the dirty word so the node stays on the fast
// path); moved back into the dirty bits when it comes into bounds.
// ST_DEFER_TEXTURE is also how a resolve due in this visit reads to
// onVisibility (into bounds) and onShown, already due or parked, and how
// a hook asks for one (TextureNodes.back: a texture freed meanwhile): the
// pass folds it into DIRTY_TEXTURE before its texture step.
export const ST_DEFER_TEXTURE = 1 << 16;
export const ST_DEFER_SHADER = 1 << 17;
export const ST_DEFERRED = ST_DEFER_TEXTURE | ST_DEFER_SHADER;
// Texture bookkeeping (phase 3), owned by TextureNodes except ST_SRC (the
// src and texture setters), ST_PRELOAD_QUEUED (NodeStore.queuePreload sets
// it, the drain clears it) and ST_AUTOSIZE_DUE (the autosize setter sets it
// too).
export const ST_WANT = 1 << 18; // derived: the node counts one want on the texture it shows and one on its source's pixels
export const ST_PRELOAD_WANT = 1 << 19; // derived: the node counts a preload want on its source's pixels
export const ST_SRC = 1 << 20; // input: `src` was written after `texture`, so src is what the node shows
export const ST_PRELOAD_QUEUED = 1 << 21; // bookkeeping: the node is in NodeStore.preloads
export const ST_AUTOSIZE_DUE = 1 << 22; // input and derived: autosize applies at the next resolve (the setter turned it on, or TextureNodes took a texture: a load or a cache hit)
// Hidden by world alpha 0 (phase 3): ScenePass.sweepHidden and visit.
export const ST_ALPHA_CULLED = 1 << 23; // derived: culled by its own world alpha 0 at its last visit; its subtree was told it is hidden
export const ST_HIDDEN = 1 << 24; // derived: told it is hidden (PassHooks.onHidden asked for onShown); hears onShown on its next visit with world alpha above 0
// Text (phase 5): TextNodes.layoutText derives both.
export const ST_TEXT_READY = 1 << 25; // derived: the text node has a layout with glyphs and its font's atlas is uploaded (a text node's renderability; ST_CONTENT_READY stays the texture system's)
export const ST_TEXT_BOX = 1 << 26; // derived: composeWorld places the text block by the text box (TextState boxW, boxH, boxX, boxY): contain, alignment, vertical align, offsetY
export const ST_ALPHA_UNUSED = 1 << 27; // derived: the node's params block reads no world alpha (a box with no border and no visible shadow), so perOpMatch does not compare it (ShaderRegistry.pack sets it)
export const ST_RTL = 1 << 28; // derived: the resolved layout direction, the node's own I_DIRECTION when set, else the parent's bit; only the pass sets it. The parent's bit mirrors a child's x, mount and pivot in composeWorld; the node's own swaps its text alignment and clip margins

export const VIS_INIT = 0;
export const VIS_OUT = 1;
export const VIS_IN_BOUNDS = 2;
export const VIS_IN_VIEWPORT = 3;

export function visibilityOf(state: number): number {
  return (state & ST_VIS_MASK) >>> ST_VIS_SHIFT;
}

export function withVisibility(state: number, vis: number): number {
  return ((state & ~ST_VIS_MASK) | (vis << ST_VIS_SHIFT)) >>> 0;
}

/** 1.10 public values: 0 Init, 2 OutOfBounds, 4 InBounds, 8 InViewport. */
export function renderStateOf(vis: number): RenderStateValue {
  return vis === VIS_INIT ? 0 : ((1 << vis) as RenderStateValue);
}
