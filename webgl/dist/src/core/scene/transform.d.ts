import type { NodeStore } from '../nodes/NodeStore.js';
/**
 * Where a text node's block sits (TextState, NodeStore.texts), read for a
 * node with ST_TEXT_BOX: the box its mount and pivot use (a contained max
 * size, else its own) and the block's offset inside the node (alignment
 * in the contained width, vertical align, offsetY).
 */
export interface TextBox {
    boxW: number;
    boxH: number;
    boxX: number;
    boxY: number;
}
/**
 * Recompute node `id`'s world transform (wa wb wc wd wtx wty), its world
 * bounds (bx0 by0 bx1 by1) and its ST_SIMPLE / ST_WORLD_TRANSLATE bits from
 * its props and its parent's world state. `parent` may be NULL (identity).
 *
 * The arithmetic mirrors 1.10's updateLocalTransform, the Global branch of
 * update() and updateGlobalGeometry so that pixels match. A contain resize
 * mode (ST_CONTAIN) applies once the texture size is known (texW/texH,
 * written by TextureNodes with DIRTY_LOCAL): its scale and alignment are
 * recomputed from w/h and that size on every compose, so a w/h change and
 * a texture arrival take effect in the same frame. That is more often than
 * 1.10, which recomputed them only on the node's own Local updates: a
 * compose also runs when only an ancestor's transform changed, so a contain
 * node under a scrolling row pays the resizeMode read (a side-array load
 * and two property loads on app objects), the texW/texH loads and four
 * divisions every scroll frame. Caching the factors waits for a device
 * trace (phase 7).
 */
export declare function composeWorld(s: NodeStore, id: number, parent: number): void;
