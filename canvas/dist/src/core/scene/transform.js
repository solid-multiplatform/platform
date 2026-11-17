import { NULL, ST_CONTAIN, ST_RTL, ST_SIMPLE, ST_TEXT, ST_TEXT_BOX, ST_WORLD_TRANSLATE, } from '../nodes/NodeFlags.js';
import { F_BX0, F_BX1, F_BY0, F_BY1, F_H, F_MOUNT_X, F_MOUNT_Y, F_PIVOT_X, F_PIVOT_Y, F_ROTATION, F_SCALE_X, F_SCALE_Y, F_STRIDE, F_TEX_H, F_TEX_W, F_W, F_WA, F_WB, F_WC, F_WD, F_WTX, F_WTY, F_X, F_Y, I_STATE, I_STRIDE, } from '../nodes/NodeLayout.js';
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
export function composeWorld(s, id, parent) {
    const f = s.f64;
    const u32 = s.u32;
    const o = id * F_STRIDE;
    const io = id * I_STRIDE;
    const w = f[o + F_W];
    const h = f[o + F_H];
    const rotation = f[o + F_ROTATION];
    const sx = f[o + F_SCALE_X];
    const sy = f[o + F_SCALE_Y];
    let state = u32[io + I_STATE];
    // The parent's state word, read once: its ST_WORLD_TRANSLATE picks the
    // world path below, and its ST_RTL mirrors this node within the parent
    // (the anchor from the right edge, mount and pivot flipped). 0 at the
    // root, which has nothing to mirror within. An LTR node pays one test
    // on this word and never takes the branches.
    const pstate = parent === NULL ? 0 : u32[parent * I_STRIDE + I_STATE];
    const mirrored = (pstate & ST_RTL) !== 0;
    const po = parent * F_STRIDE;
    // The texture size is read only for a contain node: every other node
    // composed in a scroll frame skips the two loads. A text node ignores
    // its texture's contain: its box is its text's (1.10).
    const contain = (state & (ST_CONTAIN | ST_TEXT)) === ST_CONTAIN &&
        f[o + F_TEX_W] > 0 &&
        f[o + F_TEX_H] > 0;
    // Whether the local transform needs the pivot/rotate/scale treatment at
    // all. A contain-only node (rotation 0, scale 1) never goes through the
    // pivot: 1.10's texture-contain branch translates directly with no pivot
    // term. `(tx + px) - px` is not exact in floating point even at ordinary
    // values (e.g. x 0.1, w 200.6 with the default pivot), which is why a
    // contain-only node skips the pivot as 1.10 does: routing it through the
    // pivot dance anyway would round differently even though it is
    // algebraically a no-op.
    const transformed = rotation !== 0 || sx !== 1 || sy !== 1;
    const simple = transformed === false && contain === false;
    // A text block placed in its box (1.10 CoreTextNode.updateLocalTransform):
    // mount and pivot use the box, and the block's offset follows the rest.
    let mw = w;
    let mh = h;
    let box = null;
    if ((state & ST_TEXT_BOX) !== 0) {
        box = s.texts[id];
        mw = box.boxW;
        mh = box.boxH;
    }
    // Local transform.
    let x = f[o + F_X];
    let mx = f[o + F_MOUNT_X];
    if (mirrored === true) {
        // The mirror image of the box within the parent's width: x measured
        // from the parent's right edge, the mount from the other side. With the
        // pivot below, exact under scale too. Nothing else changes: y, size,
        // scale, rotation and the texture stay as written (the 2026-10-18 RTL
        // design, section 5). A parent of width 0 mirrors about its origin.
        x = f[po + F_W] - x;
        mx = 1 - mx;
    }
    let tx = x - mx * mw;
    let ty = f[o + F_Y] - f[o + F_MOUNT_Y] * mh;
    let la = 1;
    let lb = 0;
    let lc = 0;
    let ld = 1;
    if (transformed === true) {
        let pivotX = f[o + F_PIVOT_X];
        if (mirrored === true) {
            pivotX = 1 - pivotX;
        }
        const px = pivotX * mw;
        const py = f[o + F_PIVOT_Y] * mh;
        let cos = 1;
        let sin = 0;
        if (rotation !== 0) {
            cos = Math.cos(rotation);
            sin = Math.sin(rotation);
        }
        // R * S
        la = cos * sx;
        // (0 - sin), not -sin: 1.10 zero-sign parity for unrotated negative scale.
        lb = (0 - sin) * sy;
        lc = sin * sx;
        ld = cos * sy;
        // T(tx + px, ty + py) * (R * S) * T(-px, -py)
        const tx0 = tx + px;
        const ty0 = ty + py;
        tx = la * -px + lb * -py + tx0;
        ty = lc * -px + ld * -py + ty0;
    }
    if (contain === true) {
        // Sibling of the block above, not nested in it: applies to whatever
        // la..ld/tx/ty are at this point, identity-shaped when not transformed
        // (matching 1.10, which applies the contain translate and scale to the
        // local transform regardless of which primary branch built it). The
        // factors are 1.10's: fit the texture's aspect ratio inside w x h and
        // align the slack by resizeMode.x / .y (0.5 when unset).
        const mode = s.textureOptions[id].resizeMode;
        const tw = f[o + F_TEX_W];
        const th = f[o + F_TEX_H];
        let ex = 0;
        let ey = 0;
        let rsx = 1;
        let rsy = 1;
        if (tw / th > w / h) {
            const scaledTxHeight = th * (w / tw);
            ey = (h - scaledTxHeight) * (mode.y ?? 0.5);
            rsy = scaledTxHeight / h;
        }
        else {
            const scaledTxWidth = tw * (h / th);
            let alignX = mode.x ?? 0.5;
            if (mirrored === true) {
                alignX = 1 - alignX;
            }
            ex = (w - scaledTxWidth) * alignX;
            rsx = scaledTxWidth / w;
        }
        tx = la * ex + lb * ey + tx;
        ty = lc * ex + ld * ey + ty;
        la = la * rsx;
        lb = lb * rsy;
        lc = lc * rsx;
        ld = ld * rsy;
    }
    if (box !== null) {
        // 1.10 localTransform.translate(containX, containY): after the rest.
        const bx = box.boxX;
        const by = box.boxY;
        tx = la * bx + lb * by + tx;
        ty = lc * bx + ld * by + ty;
    }
    // World transform.
    const wasWorldTranslate = (state & ST_WORLD_TRANSLATE) !== 0;
    const parentTranslate = parent === NULL || (pstate & ST_WORLD_TRANSLATE) !== 0;
    let wa;
    let wb;
    let wc;
    let wd;
    let wtx;
    let wty;
    let writeLinear;
    if (simple === true && parentTranslate === true) {
        wa = 1;
        wb = 0;
        wc = 0;
        wd = 1;
        if (parent === NULL) {
            wtx = tx;
            wty = ty;
        }
        else {
            wtx = f[po + F_WTX] + tx;
            wty = f[po + F_WTY] + ty;
        }
        state |= ST_WORLD_TRANSLATE;
        // Already translate-only last frame: wa/wb/wc/wd are already 1/0/0/1 in
        // the store, so skip rewriting them (4 stores saved per translating
        // node per scroll frame).
        writeLinear = wasWorldTranslate === false;
    }
    else {
        let pa = 1;
        let pb = 0;
        let pc = 0;
        let pd = 1;
        let ptx = 0;
        let pty = 0;
        if (parent !== NULL) {
            pa = f[po + F_WA];
            pb = f[po + F_WB];
            pc = f[po + F_WC];
            pd = f[po + F_WD];
            ptx = f[po + F_WTX];
            pty = f[po + F_WTY];
        }
        if (la === 1 && ld === 1 && lb === 0 && lc === 0) {
            // translateOrMultiply: local is identity-shaped
            wa = pa;
            wb = pb;
            wc = pc;
            wd = pd;
        }
        else {
            wa = pa * la + pb * lc;
            wb = pa * lb + pb * ld;
            wc = pc * la + pd * lc;
            wd = pc * lb + pd * ld;
        }
        wtx = pa * tx + pb * ty + ptx;
        wty = pc * tx + pd * ty + pty;
        state &= ~ST_WORLD_TRANSLATE;
        writeLinear = true;
    }
    if (writeLinear === true) {
        f[o + F_WA] = wa;
        f[o + F_WB] = wb;
        f[o + F_WC] = wc;
        f[o + F_WD] = wd;
    }
    f[o + F_WTX] = wtx;
    f[o + F_WTY] = wty;
    // Bounds (updateGlobalGeometry).
    if (wb === 0 && wc === 0) {
        f[o + F_BX0] = wtx;
        f[o + F_BY0] = wty;
        f[o + F_BX1] = wtx + w * wa;
        f[o + F_BY1] = wty + h * wd;
    }
    else {
        const x2 = wtx + w * wa;
        const y2 = wty + w * wc;
        const x3 = x2 + h * wb;
        const y3 = y2 + h * wd;
        const x4 = wtx + h * wb;
        const y4 = wty + h * wd;
        f[o + F_BX0] = Math.min(wtx, x2, x3, x4);
        f[o + F_BY0] = Math.min(wty, y2, y3, y4);
        f[o + F_BX1] = Math.max(wtx, x2, x3, x4);
        f[o + F_BY1] = Math.max(wty, y2, y3, y4);
    }
    if (simple === true) {
        state |= ST_SIMPLE;
    }
    else {
        state &= ~ST_SIMPLE;
    }
    u32[io + I_STATE] = state;
}
//# sourceMappingURL=transform.js.map