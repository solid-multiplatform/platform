import type { NodeStore } from './NodeStore.js';
export interface DestroyOwner {
    readonly nodes: NodeStore;
}
/**
 * Destroy node `root` and every descendant: release resources, neutralize
 * handles, unlink, free slots.
 *
 * Two phases over one collected id list (used as a FIFO: `write` appends,
 * `read` consumes, breadth-first order):
 *
 * Phase A collects every id in the subtree and neutralizes its handle
 * (`removeAllListeners()`, `handle.id = NULL`) as it is collected, before
 * any hook runs. This matters for two reasons: it puts listener removal
 * before `releaseNode` for every node (1.10 order), and it makes a
 * `releaseNode` hook's `node.destroy()` on any node already in this subtree
 * a no-op (its handle's id is already NULL), which is what prevents a
 * double free when a hook reaches for a node that is still pending in this
 * same walk.
 *
 * Phase B then calls `releaseNode`, stops animations, and frees each
 * collected id, in the same order they were collected.
 *
 * Iterative; allocates only when the list has to grow, or when the call is
 * re-entrant (see `depth` above).
 */
export declare function destroySubtree(owner: DestroyOwner, root: number): void;
