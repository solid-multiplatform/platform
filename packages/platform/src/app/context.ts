/**
 * What the framework hands an app without props: the host it runs on
 * (`mountApp` provides it) and the project's plugins and design size (the
 * generated entry provides them through `appEntry`).
 */
import { createContext } from 'solid-js';
import type { HistorySource } from '../core/history.js';
import type { PlatformTarget } from '../sdk/capabilities.js';
import type { EditorHost } from '../sdk/editor.js';
import type { BackDispatcher } from '../sdk/shortcuts.js';

/** A design coordinate space, such as 1920 by 1080. */
export interface DesignSize {
  width: number;
  height: number;
}

export const HostScope = createContext<{
  target?: PlatformTarget;
  native?: unknown;
  /** The host's native text entry, where it has one. */
  text?: EditorHost;
  /** The host's history, where it has one: the router reads it, not `window`. */
  history?: HistorySource;
  /** The host's one Back dispatcher, shared by keys, history and screen history. */
  back?: BackDispatcher;
  /** Leaves the app, where the target can. Omitted where it cannot. */
  exit?(): void;
}>();

export const AppScope = createContext<{
  plugins: Record<string, unknown>;
  designSize?: DesignSize;
  /**
   * The host's editor, carried here so `/app` fields need no `Controls`
   * wrapper. It comes from the `HostScope` `mountApp` provides.
   */
  text?: EditorHost;
}>();
