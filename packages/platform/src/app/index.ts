/**
 * `@solid-multiplatform/platform/app`: the one import an app is written
 * with. Re-exports only: importing a name costs that name's module and
 * nothing else. Everything here is also available from its own subpath.
 */

// Reactivity and control flow.
export {
  ErrorBoundary,
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';

// Components that need no coordinates.
export { Screen, type ScreenProps } from '../primitives/Screen.jsx';
export { Text, type TextProps } from '../primitives/Text.jsx';
export { Button, type ButtonProps } from '../primitives/Button.jsx';
export { List, type ListProps } from '../primitives/List.jsx';
export {
  TextField,
  SearchField,
  type TextFieldProps,
  type SearchFieldProps,
} from '../primitives/TextField.jsx';
export { Spacer } from '../primitives/Spacer.jsx';

// Layout, lists and images.
export { Row } from '../primitives/Row.jsx';
export { Column } from '../primitives/Column.jsx';
export { Grid } from '../primitives/Grid.jsx';
export { VirtualColumn, VirtualRow } from '../primitives/Virtual.jsx';
export { VirtualGrid } from '../primitives/VirtualGrid.jsx';
export { Image } from '../primitives/Image.jsx';
export { Visible } from '../primitives/Visible.jsx';

// Overlays and feedback.
export { Modal } from '../primitives/Modal.jsx';
export { Toast } from '../primitives/Toast.jsx';
export { Alert } from '../primitives/Alert.jsx';
export { Sheet } from '../primitives/Sheet.jsx';
export { AppErrorBoundary } from '../primitives/AppErrorBoundary.jsx';

// Routing. `Route`, `useNavigate` and the rest come from `@solidjs/router`.
export { HashRouter } from '../primitives/router.js';
export { KeepAliveRoute } from '../primitives/KeepAlive.jsx';

// The host, plugins and services, without props.
export {
  available,
  deviceColorScheme,
  useBattery,
  useColorScheme,
  useConnectivity,
  useHost,
  useLifecycle,
  useLocale,
  usePlugin,
  usePlugins,
  useViewport,
  type HostInfo,
} from './hooks.js';
export { useBreakpoint } from '../sdk/responsive.js';
export { loadService } from '../sdk/registry.js';
export {
  deviceInfo,
  impact,
  keepAwake,
  openExternal,
  readClipboard,
  share,
  writeClipboard,
} from '../sdk/device.js';
export { setupI18n, t } from '../sdk/i18n.js';

// Theme.
export { defineTheme, type ThemeOverrides } from './theme.js';
export { ThemeProvider, useTheme, type Theme } from '../sdk/theme.jsx';

// The types of the optional `options` export of `src/app.tsx`.
export type { AppSettings } from './entry.js';
export type { DesignSize } from './context.js';
