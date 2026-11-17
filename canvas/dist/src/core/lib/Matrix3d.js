/**
 * A 3D matrix representing a 2D graphics transformation
 *
 * @remarks
 * For convenience, entries in the first two rows can be accessed by the following
 * properties:
 * | ta tb tx |
 * | tc td ty |
 * | 0  0  1  |
 *
 * This matrix is optimized for 2D transformations and hence the last row will
 * always be considered [0, 0 ,1].
 */
export class Matrix3d {
    ta;
    tb;
    tx;
    tc;
    td;
    ty;
    /**
     * Creates a new 3x3 matrix.
     *
     * @param entries Row-major 3x3 matrix
     */
    constructor() {
        this.ta = 0;
        this.tb = 0;
        this.tx = 0;
        this.tc = 0;
        this.td = 0;
        this.ty = 0;
    }
    /**
     * Returns a temporary matrix that can be used for calculations.
     *
     * @remarks
     * This is useful for avoiding allocations in tight loops.
     *
     * The matrix is not guaranteed to be the same between calls.
     *
     * @returns
     */
    static get temp() {
        return tempMatrix;
    }
    static multiply(a, b, out) {
        const e0 = a.ta * b.ta + a.tb * b.tc;
        const e1 = a.ta * b.tb + a.tb * b.td;
        const e2 = a.ta * b.tx + a.tb * b.ty + a.tx;
        const e3 = a.tc * b.ta + a.td * b.tc;
        const e4 = a.tc * b.tb + a.td * b.td;
        const e5 = a.tc * b.tx + a.td * b.ty + a.ty;
        if (!out) {
            out = new Matrix3d();
        }
        out.ta = e0;
        out.tb = e1;
        out.tx = e2;
        out.tc = e3;
        out.td = e4;
        out.ty = e5;
        return out;
    }
    static identity(out) {
        if (!out) {
            out = new Matrix3d();
        }
        out.ta = 1;
        out.tb = 0;
        out.tx = 0;
        out.tc = 0;
        out.td = 1;
        out.ty = 0;
        return out;
    }
    static translate(x, y, out) {
        if (!out) {
            out = new Matrix3d();
        }
        out.ta = 1;
        out.tb = 0;
        out.tx = x;
        out.tc = 0;
        out.td = 1;
        out.ty = y;
        return out;
    }
    static scale(sx, sy, out) {
        if (!out) {
            out = new Matrix3d();
        }
        out.ta = sx;
        out.tb = 0;
        out.tx = 0;
        out.tc = 0;
        out.td = sy;
        out.ty = 0;
        return out;
    }
    static rotate(angle, out) {
        if (out === undefined) {
            out = new Matrix3d();
        }
        if (angle === 0) {
            // Skip Math.cos(0) / Math.sin(0) — neither V8 nor JSC constant-folds
            // these calls. Identity rotation is the common case when callers
            // combine rotate().scale() and only the scale is non-default.
            out.ta = 1;
            out.tb = 0;
            out.tx = 0;
            out.tc = 0;
            out.td = 1;
            out.ty = 0;
            return out;
        }
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        out.ta = cos;
        out.tb = -sin;
        out.tx = 0;
        out.tc = sin;
        out.td = cos;
        out.ty = 0;
        return out;
    }
    static copy(src, dst) {
        if (!dst) {
            dst = new Matrix3d();
        }
        dst.ta = src.ta;
        dst.tc = src.tc;
        dst.tb = src.tb;
        dst.td = src.td;
        dst.tx = src.tx;
        dst.ty = src.ty;
        return dst;
    }
    translate(x, y) {
        this.tx = this.ta * x + this.tb * y + this.tx;
        this.ty = this.tc * x + this.td * y + this.ty;
        return this;
    }
    /**
     * Writes `tx`/`ty` directly.
     *
     * Caller is responsible for ensuring `ta`/`tb`/`tc`/`td` are already the
     * desired values — typically the identity rotation/scale (1, 0, 0, 1).
     * Used by hot paths that know the matrix is in identity-shape so the
     * 4 redundant field writes performed by `Matrix3d.translate` can be skipped.
     */
    setTranslate(x, y) {
        this.tx = x;
        this.ty = y;
    }
    scale(sx, sy) {
        this.ta = this.ta * sx;
        this.tb = this.tb * sy;
        this.tc = this.tc * sx;
        this.td = this.td * sy;
        return this;
    }
    rotate(angle) {
        if (angle === 0) {
            return this;
        }
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const e0 = this.ta * cos + this.tb * sin;
        const e1 = this.tb * cos - this.ta * sin;
        const e3 = this.tc * cos + this.td * sin;
        const e4 = this.td * cos - this.tc * sin;
        this.ta = e0;
        this.tb = e1;
        this.tc = e3;
        this.td = e4;
        return this;
    }
    multiply(other) {
        return Matrix3d.multiply(this, other, this);
    }
    translateOrMultiply(other) {
        if (other.ta === 1 && other.td === 1 && other.tb === 0 && other.tc === 0) {
            return this.translate(other.tx, other.ty);
        }
        return this.multiply(other);
    }
}
const tempMatrix = new Matrix3d();
//# sourceMappingURL=Matrix3d.js.map