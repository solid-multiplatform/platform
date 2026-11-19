/**
 * What the framework hands an app without props: the host it runs on
 * (`mountApp` provides it) and the project's plugins and design size (the
 * generated entry provides them through `appEntry`).
 */
import { createContext } from 'solid-js';
import type { PlatformTarget } from '../sdk/capabilities.js';

/** A design coordinate space, such as 1920 by 1080. */
export interface DesignSize {
  width: number;
  height: number;
}

export const HostScope = createContext<{
  target?: PlatformTarget;
  native?: unknown;
}>();

export const AppScope = createContext<{
  plugins: Record<string, unknown>;
  designSize?: DesignSize;
}>();
