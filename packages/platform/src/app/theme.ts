import { darkTheme, type Theme } from '../sdk/theme.jsx';

/** The tokens an app changes; everything left out comes from the base theme. */
export interface ThemeOverrides {
  colorScheme?: Theme['colorScheme'];
  colors?: Partial<Theme['colors']>;
  radius?: Partial<Theme['radius']>;
  typography?: Partial<Theme['typography']>;
  motion?: Partial<Theme['motion']>;
  spacing?: Theme['spacing'];
}

/**
 * A theme made of `base` (the dark theme unless given) with `overrides` on
 * top. Pass it as `options.theme` from `src/app.tsx`, or to `ThemeProvider`.
 */
export function defineTheme(
  overrides: ThemeOverrides,
  base: Theme = darkTheme,
): Theme {
  return {
    colorScheme: overrides.colorScheme ?? base.colorScheme,
    colors: { ...base.colors, ...overrides.colors },
    radius: { ...base.radius, ...overrides.radius },
    typography: { ...base.typography, ...overrides.typography },
    motion: { ...base.motion, ...overrides.motion },
    spacing: (step) =>
      overrides.spacing ? overrides.spacing(step) : base.spacing(step),
  };
}
