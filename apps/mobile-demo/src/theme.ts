/**
 * The demo's look: a black-and-white editorial theme with one warm,
 * desaturated red accent. Every colour is an 8-digit hex (RRGGBBAA), as the
 * scene requires.
 *
 * Design grounding (full references in README.md): MUBI's monochrome,
 * typography-led editoral surface; Letterboxd's poster-first hierarchy and
 * small metadata; Netflix/Apple TV's gradient hero with two pill actions and
 * peeking poster rails; iMessage/ChatGPT/Claude's asymmetric bubbles and
 * composer; Material 3's 8 dp grid and 48 dp touch target; Apple HIG's
 * 44 pt target and safe-area margins.
 */
export const C = {
  background: 0x0a0a0bff,
  backgroundRaised: 0x101012ff,
  surface: 0x161618ff,
  surfaceHigh: 0x1d1d20ff,
  line: 0x2a2a2eff,
  lineSoft: 0x1f1f23ff,
  /** Pure white is reserved for the primary title on a screen. */
  textPrimary: 0xffffffff,
  text: 0xf4f4f5ff,
  muted: 0x9c9ca4ff,
  dim: 0x6a6a72ff,
  /** A desaturated red: the only chromatic note in the app. */
  accent: 0xc05643ff,
  accentSoft: 0xc0564326,
  onAccent: 0xfff4f0ff,
  black: 0x000000ff,
  white: 0xf4f4f5ff,
  skeleton: 0x18181bff,
  skeletonStrong: 0x222226ff,
  skeletonSheen: 0xffffff12,
  bubbleThem: 0x1b1b1eff,
  bubbleMe: 0xc05643ff,
  online: 0x6fbf8aff,
};

export interface Metrics {
  width: number;
  height: number;
  top: number;
  bottom: number;
  margin: number;
  barY: number;
  barH: number;
  contentY: number;
  heroH: number;
  cardW: number;
  cardH: number;
  cardGap: number;
  railH: number;
  chatTop: number;
  inputH: number;
  messageSize: number;
}

/**
 * One phone layout, committed to before styling. At 540 logical units
 * (1080 physical at density 2): 20 unit side margins, 12 unit gutters, rail
 * card width (540 - 40 - 24) / 2.4 = 198, so the third poster peeks. Poster
 * 2:3. Hero 62% of the height. Type: title 34/40, section 21, body 15-16,
 * meta 13. Touch targets are at least 48 units.
 */
export function metricsFor(
  width: number,
  height: number,
  safeTop: number,
  safeBottom: number,
  _keyboard: number,
): Metrics {
  const margin = width >= 700 ? 28 : 20;
  const gap = 12;
  const barH = 56;
  const barY = safeTop + 10;
  const contentY = barY + barH + 12;
  const heroH = Math.round(height * 0.62);
  const cardW = Math.round((width - 2 * margin - 2 * gap) / 2.4);
  const cardH = Math.round((cardW * 3) / 2);
  const railH = cardH + 38;
  const inputH = 64;
  return {
    width,
    height,
    top: safeTop,
    bottom: safeBottom,
    margin,
    barY,
    barH,
    contentY,
    heroH,
    cardW,
    cardH,
    cardGap: gap,
    railH,
    chatTop: contentY,
    inputH,
    messageSize: 15,
  };
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
