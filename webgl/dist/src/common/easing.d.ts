export type TimingFunction = (t: number) => number;
/**
 * `EasingCurve.kind`: how a built-in easing evaluates. `EASE_CUSTOM` is no
 * curve's: Animation's kind for a custom TimingFunction, numbered here so
 * that the kinds cannot collide.
 */
export declare const EASE_LINEAR = 0;
export declare const EASE_BEZIER = 1;
export declare const EASE_STEP_START = 2;
export declare const EASE_STEP_END = 3;
export declare const EASE_CUSTOM = 4;
/**
 * A built-in easing resolved from its name (`resolveEasing`): its kind and,
 * for a cubic bezier, the coefficients of x(t) = ((xa t + xb) t + xc) t and
 * of y(t) likewise, 0 for the other kinds.
 */
export interface EasingCurve {
    readonly kind: number;
    readonly xa: number;
    readonly xb: number;
    readonly xc: number;
    readonly ya: number;
    readonly yb: number;
    readonly yc: number;
}
/**
 * How many cubic-bezier strings `beziers` keeps. An app names a handful of
 * curves, and every animation it starts resolves one, so a hit saves the
 * parse each time; one that builds such strings from computed values (a
 * new string per animation) would otherwise grow the table without end.
 * 32 holds several times any app's set of curves, at a few hundred bytes
 * an entry.
 */
export declare const MAX_BEZIERS = 32;
/**
 * A built-in easing by name: `linear`, `step-start`, `step-end` or a named
 * cubic bezier (`ease`, `ease-in-out`, ...), the same record every time; or
 * `cubic-bezier(x1, y1, x2, y2)`, parsed into a record kept for the last
 * MAX_BEZIERS such strings. Null, with a warning, for any other string:
 * the caller eases linearly. getTimingFunction and Animation both resolve
 * through it.
 */
export declare const resolveEasing: (str: string) => EasingCurve | null;
/**
 * The timing function of a built-in easing (`resolveEasing`'s names): the
 * same function at every call for a built-in name, and for a cubic-bezier
 * string while `beziers` keeps it; linear, with a warning at every call,
 * for any other string.
 */
export declare const getTimingFunction: (str: string) => TimingFunction;
/**
 * How many easings the module keeps by name, for tests: the built-in
 * table's, getTimingFunction's functions for them, and the cubic-bezier
 * strings `beziers` keeps (at most MAX_BEZIERS, each with its curve and
 * function).
 */
export declare const cachedEasings: () => number;
