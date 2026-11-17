import { NULL } from './NodeFlags.js';
import { I_FIRST_CHILD, I_PARENT, I_STRIDE } from './NodeLayout.js';
let scratch = new Int32Array(256);
/**
 * Re-entrancy depth: nonzero while a destroySubtree walk is in progress.
 *
 * This only needs to protect against a nested call on a node OUTSIDE the
 * subtree currently being walked: a `releaseNode` hook (filled in by later
 * phases for textures and clips) that destroys an unrelated node gets its
 * own local stack instead of the shared `scratch`, so it cannot clobber the
 * outer walk's pending ids. A hook that destroys a node INSIDE the current
 * subtree never reaches a nested call at all, because every handle in the
 * subtree is neutralized (phase A, below) before any `releaseNode` runs
 * (phase B): `Node.destroy()` on an already-neutralized handle is a no-op.
 *
 * Not restored by a try/finally if a hook throws: depth would stay
 * permanently raised, so every later destroySubtree call would (correctly
 * but needlessly) allocate its own local stack instead of reusing `scratch`.
 * That costs one small array per call; it does not corrupt state. Acceptable
 * per the project's no try/catch-in-non-hot-paths style.
 */
let depth = 0;
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
export function destroySubtree(owner, root) {
    const s = owner.nodes;
    if (root === NULL) {
        return;
    }
    const parent = s.i32[root * I_STRIDE + I_PARENT];
    s.unlink(root);
    if (parent !== NULL) {
        // Draw order changed under the parent: a frame is needed.
        s.markDirty(parent, 0);
    }
    const reentrant = depth > 0;
    let list = reentrant === true ? new Int32Array(256) : scratch;
    depth++;
    // Phase A: collect (breadth-first) and neutralize every handle.
    let count = 0;
    list[count++] = root;
    let read = 0;
    while (read < count) {
        const id = list[read++];
        let c = s.i32[id * I_STRIDE + I_FIRST_CHILD];
        while (c !== NULL) {
            if (count === list.length) {
                const bigger = new Int32Array(list.length * 2);
                bigger.set(list);
                list = bigger;
                if (reentrant === false) {
                    scratch = list;
                }
            }
            list[count++] = c;
            c = s.next[c];
        }
        const handle = s.handles[id];
        if (handle !== null) {
            handle.removeAllListeners();
            handle.id = NULL;
        }
    }
    // Phase B: release, stop animations, free. Every handle collected above
    // is already neutralized, so a hook that reaches back into this subtree
    // (via a handle's own `.destroy()`) is already a no-op.
    for (let i = 0; i < count; i++) {
        const id = list[i];
        if (owner.releaseNode !== undefined) {
            owner.releaseNode(id);
        }
        const anims = s.animations[id];
        if (anims !== null) {
            for (const key in anims) {
                anims[key].controller.stop();
            }
        }
        s.free(id);
    }
    depth--;
}
//# sourceMappingURL=destroy.js.map