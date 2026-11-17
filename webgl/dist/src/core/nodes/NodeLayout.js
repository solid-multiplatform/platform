/**
 * The interleaved layout of NodeStore's per-node records.
 *
 * Every node owns one record in each of two buffers, so that creating a
 * node and visiting it touch two arrays rather than fifty: node `id`'s field
 * `F_X` is `f64[id * F_STRIDE + F_X]`, its field `I_STATE` is
 * `u32[id * I_STRIDE + I_STATE]`. The sibling links are the exception
 * (`NodeStore.prev` / `next`, an Int32Array each): a pass along a sibling
 * list reads one link per node, each read waiting on the one before, so in
 * a record that is one cache line per sibling, missed in turn once the
 * records have left the cache (the first frame after an idle period).
 *
 * - `f64` (Float64Array): props and derived world state (Float64 so a prop
 *   reads back what was written, and the derived state keeps 1.10's
 *   arithmetic bit for bit; see NodeStore).
 * - `i32` / `u32` / `f32`: three views of one buffer. Each field is read
 *   through one view only: links, ids and records through `i32` (NULL is
 *   -1), colours and flag words through `u32`, the UV rect through `f32`.
 *
 * Fields are ordered by when they are read: what a clean visit and its emit
 * read comes first (the first 64-byte line of a record when it is aligned),
 * the props a compose reads after. A read at a destroyed handle's id (NULL,
 * -1) lands at a negative index, so it comes back undefined, as it did with
 * an array per field: keep every offset below its stride.
 */
/** Float64 slots per node in `NodeStore.f64`. */
export const F_STRIDE = 32;
export const F_W = 0;
export const F_H = 1;
export const F_WTX = 2;
export const F_WTY = 3;
export const F_WORLD_ALPHA = 4;
export const F_Z_INDEX = 5;
export const F_WA = 6;
export const F_WD = 7;
export const F_WB = 8;
export const F_WC = 9;
export const F_BX0 = 10;
export const F_BY0 = 11;
export const F_BX1 = 12;
export const F_BY1 = 13;
/**
 * The size of the texture the node shows (the sub-region's for a
 * SubTexture), 0 until one is loaded. Written by TextureNodes; read by
 * composeWorld for a contain resize mode, so the contain scale follows w/h
 * changes and texture arrival in the frame they happen.
 */
export const F_TEX_W = 14;
export const F_TEX_H = 15;
export const F_X = 16;
export const F_Y = 17;
export const F_ALPHA = 18;
export const F_SCALE_X = 19;
export const F_SCALE_Y = 20;
export const F_ROTATION = 21;
export const F_MOUNT_X = 22;
export const F_MOUNT_Y = 23;
export const F_PIVOT_X = 24;
export const F_PIVOT_Y = 25;
/**
 * The f64 slots in use, 0 to F_FIELDS - 1; the rest of the stride is unused
 * (a power-of-two stride keeps records aligned). A new field takes slot
 * F_FIELDS and bumps it (NodeLayout.test.ts checks the offsets are dense).
 */
export const F_FIELDS = 26;
/** 32-bit words per node in the `NodeStore.i32` / `u32` / `f32` buffer. */
export const I_STRIDE = 32;
/** u32: pending DIRTY_* bits. */
export const I_DIRTY = 0;
/** u32: ST_* bits. */
export const I_STATE = 1;
/** i32: the node's unique id; 0 once freed. */
export const I_UID = 2;
/**
 * i32: tree links, NULL-terminated. The sibling links are not here: they
 * are `NodeStore.prev` / `next`, an array each, because following them
 * (the scene pass pushing a parent's children, Node.children) reads one
 * field of every sibling, a whole record each in this buffer. The first
 * child is past the first 16 words (I_FIRST_CHILD): the scene pass pushes
 * children from the last.
 */
export const I_PARENT = 3;
export const I_LAST_CHILD = 4;
/** i32: the clip record the node draws with (0 = none). */
export const I_CLIP = 5;
/** u32: premultiplied corner colours, written by the scene pass. */
export const I_PM_TL = 6;
export const I_PM_TR = 7;
export const I_PM_BL = 8;
export const I_PM_BR = 9;
/**
 * f32: the UV rect the node samples (x1 y1 x2 y2; the unit square without a
 * texture), as the vertices take it and a growing shader's `u_uvRect`
 * (1.10 uploaded the same floats). Written by TextureNodes.
 */
export const I_UV_X1 = 10;
export const I_UV_Y1 = 11;
export const I_UV_X2 = 12;
export const I_UV_Y2 = 13;
/** i32: the program the node draws with (0 = Default), written by ShaderRegistry.pack. */
export const I_SHADER = 14;
/**
 * i32: the texture record whose pixels the node draws (the op texture id).
 * A SubTexture draws its parent's record, and a node switching to a new
 * image keeps drawing the old one until the new one is uploaded (spec 9.4).
 * NULL without a texture.
 */
export const I_TEXTURE = 15;
/** i32: the first child, NULL-terminated (see I_PARENT). */
export const I_FIRST_CHILD = 16;
/** u32: corner colours (RGBA) as written. */
export const I_COLOR_TL = 17;
export const I_COLOR_TR = 18;
export const I_COLOR_BL = 19;
export const I_COLOR_BR = 20;
export const I_PLACEHOLDER_COLOR = 21;
/**
 * i32: the record the node's texture source resolved to: its src's image,
 * or the assigned texture's record (a SubTexture's own record included).
 * The node is in this record's owner list. NULL without a source.
 */
export const I_SOURCE_TEXTURE = 22;
/**
 * i32: the owner list of a texture record (TextureStore.ownerHead): the
 * nodes showing it or switching to it, linked through these.
 * NULL-terminated.
 */
export const I_OWNER_NEXT = 23;
export const I_OWNER_PREV = 24;
/** i32: the free list's link, private to NodeStore. */
export const I_NEXT_FREE = 25;
/**
 * i32: the node's own layout direction, DIR_INHERIT, DIR_LTR or DIR_RTL
 * (the `rtl` prop: null, false, true). The resolved direction is the
 * ST_RTL state bit, derived by the scene pass from this word and the
 * parent's bit; this word is read only when a direction is derived.
 */
export const I_DIRECTION = 26;
export const DIR_INHERIT = 0;
export const DIR_LTR = 1;
export const DIR_RTL = 2;
/** The words in use, 0 to I_FIELDS - 1 (see F_FIELDS). */
export const I_FIELDS = 27;
//# sourceMappingURL=NodeLayout.js.map