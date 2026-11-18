import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';

/** The platform-reported appearance. `system` is resolved by the host. */
export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  background: number;
  surface: number;
  surfaceRaised: number;
  text: number;
  textMuted: number;
  primary: number;
  onPrimary: number;
  border: number;
  focus: number;
  danger: number;
  success: number;
  warning: number;
  overlay: number;
}

export interface Theme {
  colorScheme: ColorScheme;
  colors: ThemeColors;
  /** 4-point spacing scale: spacing(2) === 8. */
  spacing(step: number): number;
  radius: { small: number; medium: number; large: number };
  typography: {
    body: number;
    label: number;
    title: number;
    headline: number;
  };
  motion: { fast: number; normal: number; slow: number };
}

const shared = {
  spacing: (step: number) => step * 4,
  radius: { small: 4, medium: 8, large: 16 },
  typography: { body: 24, label: 20, title: 34, headline: 48 },
  motion: { fast: 120, normal: 220, slow: 400 },
};

/** Light palette. Colours are 0xRRGGBBAA, matching Solid node props. */
export const lightTheme: Theme = {
  colorScheme: 'light',
  colors: {
    background: 0xf5f7faff,
    surface: 0xffffffff,
    surfaceRaised: 0xffffffff,
    text: 0x16202aff,
    textMuted: 0x5b6b7cff,
    primary: 0x2563ebff,
    onPrimary: 0xffffffff,
    border: 0xd6dee8ff,
    focus: 0x2563ebff,
    danger: 0xdc2626ff,
    success: 0x15803dff,
    warning: 0xb45309ff,
    overlay: 0x00000080,
  },
  ...shared,
};

/** Dark palette. */
export const darkTheme: Theme = {
  colorScheme: 'dark',
  colors: {
    background: 0x0b1118ff,
    surface: 0x151e28ff,
    surfaceRaised: 0x1d2937ff,
    text: 0xf2f6faff,
    textMuted: 0xa6b4c4ff,
    primary: 0x60a5faff,
    onPrimary: 0x06121fff,
    border: 0x2f3d4eff,
    focus: 0x60a5faff,
    danger: 0xf87171ff,
    success: 0x4ade80ff,
    warning: 0xfbbf24ff,
    overlay: 0x000000b3,
  },
  ...shared,
};

const [colorScheme, setColorSchemeSignal] = createSignal<ColorScheme>('light');

/** Reactive, platform-reported colour scheme. */
export const useColorScheme: Accessor<ColorScheme> = colorScheme;

/** Hosts call this when the system appearance changes. */
export function setColorScheme(scheme: ColorScheme): void {
  setColorSchemeSignal(scheme);
}

/**
 * Bind to the browser's `prefers-color-scheme`. Native hosts call
 * `setColorScheme` from their trait/configuration listeners instead.
 */
export function bindColorScheme(
  match: MediaQueryList | undefined = typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : undefined,
): () => void {
  if (!match) return () => {};
  const update = () => setColorScheme(match.matches ? 'dark' : 'light');
  update();
  match.addEventListener?.('change', update);
  return () => match.removeEventListener?.('change', update);
}

export function themeFor(scheme: ColorScheme): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}

const ThemeContext = createContext<Accessor<Theme>>();

/**
 * Supplies design tokens to the scene. The theme follows the host colour
 * scheme unless an explicit theme is passed.
 */
export function ThemeProvider(props: {
  theme?: Theme | Accessor<Theme>;
  children?: JSX.Element;
}): JSX.Element {
  const value = createMemo<Theme>(() => {
    const theme = props.theme;
    if (typeof theme === 'function') return theme();
    return theme ?? themeFor(colorScheme());
  });
  return (
    <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
  );
}

/** Design tokens for the current provider, or the platform default theme. */
export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  return context ? context() : themeFor(colorScheme());
}
