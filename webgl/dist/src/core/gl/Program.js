import { K_F4, K_I1, K_I4 } from './GlContext.js';
import { F_H, F_STRIDE, F_W, F_WA, F_WB, F_WC, F_WD, F_WORLD_ALPHA, I_STRIDE, I_UV_X1, I_UV_X2, I_UV_Y1, I_UV_Y2, } from '../nodes/NodeLayout.js';
/**
 * The vertex attributes (roadmap 4.4), bound to these locations in every
 * program so that all programs share one layout: world position, uv (the
 * SDF program's glyph UVs too), packed premultiplied colour, the extra
 * scalar (SDF distance range) and the static per-corner node coordinates.
 */
export const ATTRIBUTES = [
    'a_position',
    'a_textureCoords',
    'a_color',
    'a_extra',
    'a_nodeCoords',
];
/**
 * The system uniforms a program may declare, by their index into
 * `Program.system` (spec 7.1: a location cache indexed by a compile-time
 * index, not looked up by name per call). The first five are per-op
 * uniforms, uploaded from the op's first node (`Program.perOp`): world
 * alpha, the world 2x2 and UV rect of a growing quad, the node size (1.10
 * custom shaders) and the shader type's time value. Resolution and pixel
 * ratio never change: GlBackend.registerProgram uploads them once.
 */
export const U_ALPHA = 0;
export const U_TIME = 1;
export const U_TRANSFORM = 2;
export const U_UV_RECT = 3;
export const U_DIMENSIONS = 4;
export const U_RESOLUTION = 5;
export const U_PIXEL_RATIO = 6;
export const SYSTEM_UNIFORMS = [
    'u_alpha',
    'u_time',
    'u_nodeTransform',
    'u_uvRect',
    'u_dimensions',
    'u_resolution',
    'u_pixelRatio',
];
/** The per-op ones among them, as `systemMask` bits. */
const PER_OP = (1 << U_ALPHA) |
    (1 << U_TIME) |
    (1 << U_TRANSFORM) |
    (1 << U_UV_RECT) |
    (1 << U_DIMENSIONS);
/** The kinds of a UniformTable entry, defined beside GlContext.uniformv. */
export { K_F1, K_F2, K_F3, K_F4, K_I1, K_I2, K_I3, K_I4, K_M2, K_M3, K_M4, } from './GlContext.js';
/**
 * The layout of a program's params blocks (spec 8.1): one entry per uniform
 * name, in first-write order, at a fixed float offset into every block. The
 * built-in shaders write rows of `u_params` only, one entry the draw loop
 * uploads straight from the block (`direct`); a custom shader's named
 * uniforms add entries, uploaded through a scratch array each, so that no
 * upload allocates. Append only: an entry's offset and size never change,
 * so a block packed before an entry existed still reads right (an entry
 * past its length uploads 0, as a block that never wrote it holds).
 */
export class UniformTable {
    constructor() {
        this.names = [];
        this.kinds = [];
        this.offsets = [];
        this.sizes = [];
        this.scratch = [];
        /** Floats in a block packed now. */
        this.length = 0;
        /** The one entry is `u_params`: uploaded with uniform4fv straight from the block. */
        this.direct = false;
        /** A pack wrote past an entry's size and was cut: warned about once. */
        this.warned = false;
    }
    indexOf(name) {
        return this.names.indexOf(name);
    }
    /** Append an entry of `size` floats; returns its index. */
    add(name, kind, size) {
        const e = this.names.length;
        this.names.push(name);
        this.kinds.push(kind);
        this.offsets.push(this.length);
        this.sizes.push(size);
        this.scratch.push(kind >= K_I1 && kind <= K_I4
            ? new Int32Array(size)
            : new Float32Array(size));
        this.length += size;
        this.direct = e === 0 && name === 'u_params' && kind === K_F4;
        return e;
    }
}
/** A linked program and the per-program state the draw loop shadows. */
export class Program {
    constructor(ctx, vertex, fragment, name) {
        /** Locations of SYSTEM_UNIFORMS by index, null for one the program does not use. */
        this.system = [];
        /**
         * The params block last uploaded to this program. Uniform values are
         * program state that survives program switches, and blocks are immutable
         * and shared by reference, so the same reference needs no upload. This
         * holds only because a params block is never mutated or recycled after
         * upload: a block a shader outgrows is dropped and replaced, never
         * trimmed and pooled for reuse, since a recycled reference would still
         * match this shadow and the draw loop would skip an upload the new
         * content needs.
         */
        this.lastParams = null;
        /**
         * Uploads the program's per-op system uniforms for the op whose first
         * node is `node` (bindSystem installs it); null when the program uses
         * none.
         */
        this.perOp = null;
        /** The layout of this program's params blocks; null for a program without them. */
        this.table = null;
        /** Locations of the table's entries, looked up on each one's first upload. */
        this.locations = [];
        this.nodes = null;
        this.time = null;
        // Shadows of the per-op uniforms: NaN never equals a value, so the first
        // op always uploads.
        this.alpha = NaN;
        this.t = NaN;
        this.ta = NaN;
        this.tb = NaN;
        this.tc = NaN;
        this.td = NaN;
        this.ux1 = NaN;
        this.uy1 = NaN;
        this.ux2 = NaN;
        this.uy2 = NaN;
        this.w = NaN;
        this.h = NaN;
        this.name = name;
        this.ctx = ctx;
        const handle = ctx.compile(vertex, fragment, ATTRIBUTES);
        this.handle = handle;
        this.params = ctx.uniformLocation(handle, 'u_params');
        let systemMask = 0;
        for (let i = 0; i < SYSTEM_UNIFORMS.length; i++) {
            const location = ctx.uniformLocation(handle, SYSTEM_UNIFORMS[i]);
            this.system.push(location);
            if (location !== null) {
                systemMask |= 1 << i;
            }
        }
        this.systemMask = systemMask;
    }
    /**
     * Bind the program to the store its per-op uniforms read and to its shader
     * type's time value (null without one), and install `perOp` when it uses
     * a per-op uniform. Whether a timed op asks for the next frame is the
     * time function's to say (ShaderRegistry): here it only uploads.
     */
    bindSystem(nodes, time) {
        this.nodes = nodes;
        this.time = time;
        if ((this.systemMask & PER_OP) !== 0) {
            this.perOp = (node) => {
                this.uploadSystem(node);
            };
        }
    }
    /**
     * Upload `block` through the table: one call per entry, from its scratch
     * array. An entry added after the block was packed (a name a later pack
     * wrote first) is past the block's end: it uploads 0, as a fresh block
     * that never wrote it does, never the value another block left.
     */
    uploadTable(block) {
        const table = this.table;
        const ctx = this.ctx;
        const names = table.names;
        const length = block.length;
        const n = names.length;
        for (let e = 0; e < n; e++) {
            let location = this.locations[e];
            if (location === undefined) {
                location = ctx.uniformLocation(this.handle, names[e]);
                this.locations[e] = location;
            }
            if (location === null) {
                continue;
            }
            const offset = table.offsets[e];
            const size = table.sizes[e];
            const scratch = table.scratch[e];
            for (let k = 0; k < size; k++) {
                const at = offset + k;
                scratch[k] = at < length ? block[at] : 0;
            }
            ctx.uniformv(table.kinds[e], location, scratch);
        }
    }
    uploadSystem(node) {
        const s = this.nodes;
        const fo = node * F_STRIDE;
        const io = node * I_STRIDE;
        const ctx = this.ctx;
        const system = this.system;
        const alpha = system[U_ALPHA];
        if (alpha !== null) {
            const a = s.f64[fo + F_WORLD_ALPHA];
            if (a !== this.alpha) {
                this.alpha = a;
                ctx.uniform1f(alpha, a);
            }
        }
        const transform = system[U_TRANSFORM];
        if (transform !== null) {
            const a = s.f64[fo + F_WA];
            const b = s.f64[fo + F_WB];
            const c = s.f64[fo + F_WC];
            const d = s.f64[fo + F_WD];
            if (a !== this.ta || b !== this.tb || c !== this.tc || d !== this.td) {
                this.ta = a;
                this.tb = b;
                this.tc = c;
                this.td = d;
                // xy: the local x axis in world px, zw: the local y axis (1.10).
                ctx.uniform4f(transform, a, c, b, d);
            }
        }
        const uvRect = system[U_UV_RECT];
        if (uvRect !== null) {
            const x1 = s.f32[io + I_UV_X1];
            const y1 = s.f32[io + I_UV_Y1];
            const x2 = s.f32[io + I_UV_X2];
            const y2 = s.f32[io + I_UV_Y2];
            if (x1 !== this.ux1 ||
                y1 !== this.uy1 ||
                x2 !== this.ux2 ||
                y2 !== this.uy2) {
                this.ux1 = x1;
                this.uy1 = y1;
                this.ux2 = x2;
                this.uy2 = y2;
                ctx.uniform4f(uvRect, x1, y1, x2, y2);
            }
        }
        const dimensions = system[U_DIMENSIONS];
        if (dimensions !== null) {
            const w = s.f64[fo + F_W];
            const h = s.f64[fo + F_H];
            if (w !== this.w || h !== this.h) {
                this.w = w;
                this.h = h;
                ctx.uniform2f(dimensions, w, h);
            }
        }
        const time = system[U_TIME];
        const timeOf = this.time;
        if (time !== null && timeOf !== null) {
            const t = timeOf(node);
            if (t !== this.t) {
                this.t = t;
                ctx.uniform1f(time, t);
            }
        }
    }
}
//# sourceMappingURL=Program.js.map