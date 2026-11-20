/**
 * The gallery's design tokens. One accent, one type scale, one spacing
 * grid — every screen composes these; nothing invents a colour or a size.
 */
export const C = {
  background: 0x08080aff,
  surface: 0x111114ff,
  raised: 0x18181dff,
  line: 0x27272eff,
  lineSoft: 0x1b1b21ff,
  text: 0xf4f4f6ff,
  muted: 0x9b9ba5ff,
  dim: 0x5f5f69ff,
  /** A warm terracotta: the only hue in the app. */
  accent: 0xe2603fff,
  accentSoft: 0xe2603f2e,
  onAccent: 0xfff5f1ff,
  black: 0x000000ff,
  white: 0xf4f4f6ff,
  shadow: 0x00000066,
};

/** The type scale, in scene units at 1x. */
export const T = {
  display: 56,
  title: 34,
  headline: 24,
  body: 16,
  label: 13,
  caption: 11,
};

/** The 4-point spacing grid. */
export const S = (steps: number): number => steps * 4;

export const R = {
  small: 8,
  medium: 14,
  large: 22,
  pill: 999,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatTotal(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
