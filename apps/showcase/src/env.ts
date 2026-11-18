/**
 * What a host entry gives the showcase. Everything platform-specific stays in
 * the entry file (`main.web.ts` for browsers); the app sees only this.
 */
import { createContext, useContext } from 'solid-js';
import type { ControlSurface } from '@solid-multiplatform/platform/controls';
import type { Navigation } from '@solid-multiplatform/platform/navigation';
import type { LaunchParams } from './launch';
import type { ProbeResult } from './probe/result';

export interface ShowcaseEnv {
  /** The host's target name, as `startApp` was given it. */
  target: string;
  /** The scene backend the entry started (`webgl`, `canvas`, `scenegraph`…). */
  backend: string;
  launch: LaunchParams;
  /** Hands the probe result to whoever drives the device. */
  report(result: ProbeResult): void;
  /**
   * Raises a key on the host's key target, as the remote would. Absent on a
   * host whose entry does not tap its keys; the UI assertions are then
   * `unverified`.
   */
  pressKey?(key: string): void;
  /** Native text fields, where the host has them. */
  controls?: ControlSurface;
}

export interface Showcase {
  env: ShowcaseEnv;
  nav: Navigation;
  go(path: string): void;
  /** False at the home screen: the host handles Back itself. */
  back(): boolean;
}

export const ShowcaseContext = createContext<Showcase>();

export function useShowcase(): Showcase {
  const value = useContext(ShowcaseContext);
  if (!value) throw new Error('No showcase context');
  return value;
}
