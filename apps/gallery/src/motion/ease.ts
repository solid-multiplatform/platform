/**
 * The curves the motion experiment uses, as the CSS/SwiftUI-shaped functions
 * they name. A cubic-bezier is solved by bisection on x and evaluated on y,
 * the same way browsers and Core Animation do it.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t;
  return (t: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (xAt(mid) < t) lo = mid;
      else hi = mid;
    }
    return yAt((lo + hi) / 2);
  };
}

/** The sheet-like curve iOS uses for a view that grows into place. */
export const heroEase = cubicBezier(0.32, 0.72, 0, 1);

export const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;
