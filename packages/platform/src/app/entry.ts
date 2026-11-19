/**
 * What a target's generated entry calls for an app whose `src/app.tsx`
 * default-exports a component: it turns the project's settings into the
 * options `startApp`/`mountApp` take and wraps the component in what the
 * `/app` hooks and components read. App code never imports this.
 */
import {
  createComponent,
  onCleanup,
  useContext,
  type Component,
  type JSXElement,
} from 'solid-js';
import { Config } from '../core/config.js';
import type { AppOptions } from '../host.js';
import {
  ThemeProvider,
  bindColorScheme,
  themeFor,
  type Theme,
} from '../sdk/theme.jsx';
import { AppScope, HostScope, type DesignSize } from './context.js';

/** The `app` settings of the project config, and the `options` export of `src/app.tsx`. */
export interface AppSettings extends AppOptions {
  /** The coordinate space `Screen` scales to the viewport. */
  designSize?: DesignSize;
  /** `system` (the default) follows the device; or a theme from `defineTheme`. */
  theme?: 'system' | 'light' | 'dark' | Theme;
}

export function appEntry(
  App: Component,
  plugins: Record<string, unknown>,
  settings: AppSettings = {},
  overrides: AppSettings = {},
): { root: () => JSXElement; options: AppOptions } {
  const {
    designSize,
    theme = 'system',
    ...options
  } = { ...settings, ...overrides };
  // Text without a family draws in the project's first font.
  const fontFamily = options.fonts?.[0]?.fontFamily;
  if (typeof fontFamily === 'string')
    Config.fontSettings = { ...Config.fontSettings, fontFamily };
  const root = () => {
    if (theme === 'system') onCleanup(bindColorScheme());
    // `/app` fields take the host's editor from here, so an app never has to
    // wrap them in `Controls`.
    const text = useContext(HostScope)?.text;
    return createComponent(AppScope.Provider, {
      value: { plugins, designSize, text },
      get children() {
        return createComponent(ThemeProvider, {
          // A named scheme still follows the high-contrast and text-scale
          // settings; `system` leaves the choice to the provider.
          theme:
            theme === 'system'
              ? undefined
              : typeof theme === 'string'
                ? () => themeFor(theme)
                : theme,
          get children() {
            return createComponent(App, {});
          },
        });
      },
    });
  };
  return { root, options };
}
