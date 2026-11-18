export type TimingFunction = (t: number) => number;

/**
 * `EasingCurve.kind`: how a built-in easing evaluates. `EASE_CUSTOM` is no
 * curve's: Animation's kind for a custom TimingFunction, numbered here so
 * that the kinds cannot collide.
 */
export const EASE_LINEAR = 0;
export const EASE_BEZIER = 1;
export const EASE_STEP_START = 2;
export const EASE_STEP_END = 3;
export const EASE_CUSTOM = 4;

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
 * A cubic bezier's timing function: Newton's method on x(t) = time,
 * bisection where the slope vanishes, then y(t). `Animation.ease` solves
 * the same way in place, so that no double crosses a call: a change here
 * is made there too, and Animation.test.ts pins the two together at every
 * millisecond of a run.
 */
const bezierTiming = (curve: EasingCurve): TimingFunction => {
  const xa = curve.xa;
  const xb = curve.xb;
  const xc = curve.xc;
  const ya = curve.ya;
  const yb = curve.yb;
  const yc = curve.yc;

  return function (time: number): number {
    if (time >= 1.0) {
      return 1;
    }
    if (time <= 0) {
      return 0;
    }

    let t = 0.5;
    let cbx = 0;
    let cbxd = 0;
    let dx = 0;

    for (let it = 0; it < 20; it++) {
      cbx = t * (t * (t * xa + xb) + xc);
      dx = time - cbx;
      if (dx > -1e-8 && dx < 1e-8) {
        return t * (t * (t * ya + yb) + yc);
      }

      cbxd = t * (t * (3 * xa) + 2 * xb) + xc;

      if (cbxd > -1e-10 && cbxd < 1e-10) {
        // Near-zero slope: Newton would diverge, fall back to bisection.
        break;
      }

      t += dx / cbxd;
    }

    let minT = 0;
    let maxT = 1;
    for (let it = 0; it < 20; it++) {
      t = 0.5 * (minT + maxT);
      cbx = t * (t * (t * xa + xb) + xc);
      dx = time - cbx;
      if (dx > -1e-8 && dx < 1e-8) {
        return t * (t * (t * ya + yb) + yc);
      }
      if (dx < 0) {
        maxT = t;
      } else {
        minT = t;
      }
    }

    return t * (t * (t * ya + yb) + yc);
  };
};

/**
 * The tables are read by own property only: a name such as `constructor`
 * or `__proto__` is no easing, whatever Object.prototype holds for it.
 */
const hasOwn = Object.prototype.hasOwnProperty;

const makeCurve = (
  kind: number,
  xa: number,
  xb: number,
  xc: number,
  ya: number,
  yb: number,
  yc: number,
): EasingCurve => ({ kind, xa, xb, xc, ya, yb, yc });

/** The cubic bezier through the control points (a, b) and (c, d). */
const bezierCurve = (
  a: number,
  b: number,
  c: number,
  d: number,
): EasingCurve => {
  const xc = 3.0 * a;
  const xb = 3.0 * (c - a) - xc;
  const yc = 3.0 * b;
  const yb = 3.0 * (d - b) - yc;
  return makeCurve(EASE_BEZIER, 1.0 - xc - xb, xb, xc, 1.0 - yc - yb, yb, yc);
};

/**
 * The built-in easings by name, each resolved once, as the module loads.
 * Nothing is added to it: cubic-bezier strings go to `beziers`, which is
 * bounded.
 */
const curves: { [key: string]: EasingCurve } = {
  linear: makeCurve(EASE_LINEAR, 0, 0, 0, 0, 0, 0),
  'step-start': makeCurve(EASE_STEP_START, 0, 0, 0, 0, 0, 0),
  'step-end': makeCurve(EASE_STEP_END, 0, 0, 0, 0, 0, 0),
  ease: bezierCurve(0.25, 0.1, 0.25, 1.0),
  'ease-in': bezierCurve(0.42, 0, 1.0, 1.0),
  'ease-out': bezierCurve(0, 0, 0.58, 1.0),
  'ease-in-out': bezierCurve(0.42, 0, 0.58, 1.0),
  'ease-in-sine': bezierCurve(0.12, 0, 0.39, 0),
  'ease-out-sine': bezierCurve(0.61, 1, 0.88, 1),
  'ease-in-out-sine': bezierCurve(0.37, 0, 0.63, 1),
  'ease-in-cubic': bezierCurve(0.32, 0, 0.67, 0),
  'ease-out-cubic': bezierCurve(0.33, 1, 0.68, 1),
  'ease-in-out-cubic': bezierCurve(0.65, 0, 0.35, 1),
  'ease-in-circ': bezierCurve(0.55, 0, 1, 0.45),
  'ease-out-circ': bezierCurve(0, 0.55, 0.45, 1),
  'ease-in-out-circ': bezierCurve(0.85, 0, 0.15, 1),
  'ease-in-back': bezierCurve(0.36, 0, 0.66, -0.56),
  'ease-out-back': bezierCurve(0.34, 1.56, 0.64, 1),
  'ease-in-out-back': bezierCurve(0.68, -0.6, 0.32, 1.6),
};

/**
 * How many cubic-bezier strings `beziers` keeps. An app names a handful of
 * curves, and every animation it starts resolves one, so a hit saves the
 * parse each time; one that builds such strings from computed values (a
 * new string per animation) would otherwise grow the table without end.
 * 32 holds several times any app's set of curves, at a few hundred bytes
 * an entry.
 */
export const MAX_BEZIERS = 32;

/** A cubic-bezier string's curve, and getTimingFunction's function for it. */
interface BezierEntry {
  readonly curve: EasingCurve;
  /** Made at the first getTimingFunction call for the string. */
  timing: TimingFunction | null;
}

/**
 * The last MAX_BEZIERS cubic-bezier strings resolved, the oldest first out.
 * A string that does not parse is not kept: it warns at every resolve.
 */
const beziers = new Map<string, BezierEntry>();

/** A `cubic-bezier(...)` string's entry; null, with a warning, if short. */
const resolveBezier = (str: string): BezierEntry | null => {
  let entry = beziers.get(str);
  if (entry !== undefined) {
    return entry;
  }
  const match = str.match(/-?\d*\.?\d+/g);
  if (match === null || match.length < 4) {
    console.warn('Unknown cubic-bezier timing: ' + str);
    return null;
  }
  if (beziers.size >= MAX_BEZIERS) {
    beziers.delete(beziers.keys().next().value as string);
  }
  entry = {
    curve: bezierCurve(
      parseFloat(match[0]!),
      parseFloat(match[1]!),
      parseFloat(match[2]!),
      parseFloat(match[3]!),
    ),
    timing: null,
  };
  beziers.set(str, entry);
  return entry;
};

/**
 * A built-in easing by name: `linear`, `step-start`, `step-end` or a named
 * cubic bezier (`ease`, `ease-in-out`, ...), the same record every time; or
 * `cubic-bezier(x1, y1, x2, y2)`, parsed into a record kept for the last
 * MAX_BEZIERS such strings. Null, with a warning, for any other string:
 * the caller eases linearly. getTimingFunction and Animation both resolve
 * through it.
 */
export const resolveEasing = (str: string): EasingCurve | null => {
  if (hasOwn.call(curves, str) === true) {
    return curves[str]!;
  }
  if (str.indexOf('cubic-bezier') === 0) {
    const entry = resolveBezier(str);
    return entry === null ? null : entry.curve;
  }
  console.warn('Unknown timing function: ' + str);
  return null;
};

const linear: TimingFunction = (t) => t;
const stepStart: TimingFunction = () => 1;
const stepEnd: TimingFunction = (t) => (t === 1 ? 1 : 0);

/**
 * getTimingFunction's functions for the built-in names, made once each. A
 * cubic-bezier string's is kept on its `beziers` entry.
 */
const timings: { [key: string]: TimingFunction } = {};

/**
 * The timing function of a built-in easing (`resolveEasing`'s names): the
 * same function at every call for a built-in name, and for a cubic-bezier
 * string while `beziers` keeps it; linear, with a warning at every call,
 * for any other string.
 */
export const getTimingFunction = (str: string): TimingFunction => {
  if (hasOwn.call(timings, str) === true) {
    return timings[str]!;
  }
  if (str.indexOf('cubic-bezier') === 0) {
    const entry = resolveBezier(str);
    if (entry === null) {
      return linear;
    }
    if (entry.timing === null) {
      entry.timing = bezierTiming(entry.curve);
    }
    return entry.timing;
  }
  const curve = resolveEasing(str);
  if (curve === null) {
    return linear;
  }
  let timing = linear;
  if (curve.kind === EASE_BEZIER) {
    timing = bezierTiming(curve);
  } else if (curve.kind === EASE_STEP_START) {
    timing = stepStart;
  } else if (curve.kind === EASE_STEP_END) {
    timing = stepEnd;
  }
  if (hasOwn.call(curves, str) === true) {
    timings[str] = timing;
  }
  return timing;
};

/**
 * How many easings the module keeps by name, for tests: the built-in
 * table's, getTimingFunction's functions for them, and the cubic-bezier
 * strings `beziers` keeps (at most MAX_BEZIERS, each with its curve and
 * function).
 */
export const cachedEasings = (): number =>
  Object.keys(curves).length + Object.keys(timings).length + beziers.size;
