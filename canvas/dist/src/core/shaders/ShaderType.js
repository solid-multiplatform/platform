import { getNormalizedRgbaComponents } from '../../common/color.js';
import { K_F1, K_F4, K_I1, K_M2 } from '../gl/Program.js';
/**
 * Records one params block. Built-in shaders write rows of
 * `uniform vec4 u_params[N]` only (`row`), uploaded with one uniform4fv;
 * the named forms (`f1` to `f4`, `fv`, `iv`, `mat`, `rgba`) record
 * per-uniform values into the same block, laid out by the program's
 * UniformTable. One writer serves every pack; `finish` creates the block.
 * The first pack of a program fixes the layout: a later pack writing more
 * rows, or a longer array under a name, is cut to it (warned once).
 */
export class UniformWriter {
    constructor(pixelRatio) {
        /**
         * The pack called `alphaUnused`; read before `finish`, which clears it.
         *
         * @hidden
         */
        this.noAlpha = false;
        this.rows = new Float32Array(64);
        this.rowCount = 0;
        this.names = [];
        this.kinds = [];
        this.values = [];
        this.pixelRatio = pixelRatio;
    }
    /** Row `i` of `u_params`. */
    row(i, x, y, z, w) {
        let rows = this.rows;
        const at = i * 4;
        if (at + 4 > rows.length) {
            const grown = new Float32Array((i + 1) * 8);
            grown.set(rows);
            rows = grown;
            this.rows = grown;
        }
        rows[at] = x;
        rows[at + 1] = y;
        rows[at + 2] = z;
        rows[at + 3] = w;
        if (i >= this.rowCount) {
            this.rowCount = i + 1;
        }
    }
    f1(name, x) {
        this.named(name, K_F1, [x]);
    }
    f2(name, x, y) {
        this.named(name, K_F1 + 1, [x, y]);
    }
    f3(name, x, y, z) {
        this.named(name, K_F1 + 2, [x, y, z]);
    }
    f4(name, x, y, z, w) {
        this.named(name, K_F4, [x, y, z, w]);
    }
    /** A float uniform of `n` components, or an array of them: `values` holds every element. */
    fv(name, n, values) {
        this.named(name, K_F1 + n - 1, values);
    }
    /** An int uniform of `n` components, or an array of them. */
    iv(name, n, values) {
        this.named(name, K_I1 + n - 1, values);
    }
    /** A mat2, mat3 or mat4 (`n` 2, 3 or 4). */
    mat(name, n, values) {
        this.named(name, K_M2 + n - 2, values);
    }
    /** A 0xRRGGBBAA colour as normalized RGBA (1.10 uniformRGBA). */
    rgba(name, color) {
        this.named(name, K_F4, getNormalizedRgbaComponents(color));
    }
    /**
     * The block's draw reads no world alpha (`u_alpha`): a built-in box that
     * draws neither a border nor a visible shadow. Nodes that share the
     * block then batch whatever their world alpha.
     *
     * @hidden
     */
    alphaUnused() {
        this.noAlpha = true;
    }
    /**
     * End the pack: lay what was written out by `table` (adding an entry for
     * each uniform written for the first time) into a new block, and reset.
     *
     * @hidden
     */
    finish(table) {
        const rowCount = this.rowCount;
        if (rowCount > 0 && table.indexOf('u_params') === -1) {
            table.add('u_params', K_F4, rowCount * 4);
        }
        const names = this.names;
        const values = this.values;
        for (let i = 0; i < names.length; i++) {
            if (table.indexOf(names[i]) === -1) {
                table.add(names[i], this.kinds[i], values[i].length);
            }
        }
        const block = new Float32Array(table.length);
        if (rowCount > 0) {
            copy(table, block, table.indexOf('u_params'), this.rows, rowCount * 4);
        }
        for (let i = 0; i < names.length; i++) {
            const v = values[i];
            copy(table, block, table.indexOf(names[i]), v, v.length);
        }
        this.reset();
        return block;
    }
    /**
     * Drop what was written (a pack that threw), zeroing the rows used: a
     * row the next pack leaves unwritten reads 0, not this pack's value.
     */
    reset() {
        // A loop: typed-array fill is Chrome 45, above the Chrome 38 floor.
        const rows = this.rows;
        const n = this.rowCount * 4;
        for (let i = 0; i < n; i++) {
            rows[i] = 0;
        }
        this.rowCount = 0;
        this.noAlpha = false;
        this.names.length = 0;
        this.kinds.length = 0;
        this.values.length = 0;
    }
    named(name, kind, values) {
        const i = this.names.indexOf(name);
        if (i === -1) {
            this.names.push(name);
            this.kinds.push(kind);
            this.values.push(values);
            return;
        }
        this.kinds[i] = kind;
        this.values[i] = values;
    }
}
/**
 * Copy `count` values into entry `e` of `block`, cut to the entry's size:
 * the size of its first write. A cut is warned about once per table.
 */
function copy(table, block, e, values, count) {
    const offset = table.offsets[e];
    const size = table.sizes[e];
    let n = count;
    if (count > size) {
        n = size;
        if (table.warned === false) {
            table.warned = true;
            console.warn(`Shader uniform ${table.names[e]} holds ${size} values, the size of its first pack; ${count} were written and the rest is dropped`);
        }
    }
    for (let k = 0; k < n; k++) {
        block[offset + k] = values[k];
    }
}
/**
 * `this` in a 1.10 `update`: the props and the `uniform*` calls of 1.10's
 * WebGlShaderNode, recorded into the pack's writer. One per shader type,
 * reused for every pack.
 */
export class UpdateContext {
    constructor(pixelRatio) {
        this.props = null;
        this.u = null;
        this.stage = { pixelRatio };
    }
    uniform1f(name, x) {
        this.u.f1(name, x);
    }
    uniform2f(name, x, y) {
        this.u.f2(name, x, y);
    }
    uniform3f(name, x, y, z) {
        this.u.f3(name, x, y, z);
    }
    uniform4f(name, x, y, z, w) {
        this.u.f4(name, x, y, z, w);
    }
    uniform2fa(name, v) {
        this.u.fv(name, 2, v);
    }
    uniform3fa(name, v) {
        this.u.fv(name, 3, v);
    }
    uniform4fa(name, v) {
        this.u.fv(name, 4, v);
    }
    uniform1fv(name, v) {
        this.u.fv(name, 1, v);
    }
    uniform2fv(name, v) {
        this.u.fv(name, 2, v);
    }
    uniform3fv(name, v) {
        this.u.fv(name, 3, v);
    }
    uniform4fv(name, v) {
        this.u.fv(name, 4, v);
    }
    uniform1i(name, x) {
        this.u.iv(name, 1, [x]);
    }
    uniform2i(name, x, y) {
        this.u.iv(name, 2, [x, y]);
    }
    uniform3i(name, x, y, z) {
        this.u.iv(name, 3, [x, y, z]);
    }
    uniform4i(name, x, y, z, w) {
        this.u.iv(name, 4, [x, y, z, w]);
    }
    uniform1iv(name, v) {
        this.u.iv(name, 1, v);
    }
    uniform2iv(name, v) {
        this.u.iv(name, 2, v);
    }
    uniform3iv(name, v) {
        this.u.iv(name, 3, v);
    }
    uniform4iv(name, v) {
        this.u.iv(name, 4, v);
    }
    uniformMatrix2fv(name, v) {
        this.u.mat(name, 2, v);
    }
    uniformMatrix3fv(name, v) {
        this.u.mat(name, 3, v);
    }
    uniformMatrix4fv(name, v) {
        this.u.mat(name, 4, v);
    }
    uniformRGBA(name, color) {
        this.u.rgba(name, color);
    }
}
//# sourceMappingURL=ShaderType.js.map