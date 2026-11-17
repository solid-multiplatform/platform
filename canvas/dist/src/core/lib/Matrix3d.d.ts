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
export declare class Matrix3d {
    ta: number;
    tb: number;
    tx: number;
    tc: number;
    td: number;
    ty: number;
    /**
     * Creates a new 3x3 matrix.
     *
     * @param entries Row-major 3x3 matrix
     */
    constructor();
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
    static get temp(): Matrix3d;
    static multiply(a: Matrix3d, b: Matrix3d, out?: Matrix3d): Matrix3d;
    static identity(out?: Matrix3d): Matrix3d;
    static translate(x: number, y: number, out?: Matrix3d): Matrix3d;
    static scale(sx: number, sy: number, out?: Matrix3d): Matrix3d;
    static rotate(angle: number, out?: Matrix3d): Matrix3d;
    static copy(src: Matrix3d, dst?: Matrix3d): Matrix3d;
    translate(x: number, y: number): Matrix3d;
    /**
     * Writes `tx`/`ty` directly.
     *
     * Caller is responsible for ensuring `ta`/`tb`/`tc`/`td` are already the
     * desired values — typically the identity rotation/scale (1, 0, 0, 1).
     * Used by hot paths that know the matrix is in identity-shape so the
     * 4 redundant field writes performed by `Matrix3d.translate` can be skipped.
     */
    setTranslate(x: number, y: number): void;
    scale(sx: number, sy: number): Matrix3d;
    rotate(angle: number): Matrix3d;
    multiply(other: Matrix3d): Matrix3d;
    translateOrMultiply(other: Matrix3d): Matrix3d;
}
