/**
 * The keys the probe presses. They go through the focus manager's own
 * `pressKey`, which runs a press and its release down the focus path as a key
 * from the host would: no host entry has to tap its key target, so the UI
 * assertions run on every host.
 */
import { pressKey } from '@solid-multiplatform/platform/focusManager';

/** The platform's key names, as the default key map names them. */
const MAPPED: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  Backspace: 'Back',
};

/** A key down and up, by the platform's key name (`ArrowDown`, `Enter`). */
export function pressProbeKey(key: string): void {
  pressKey(MAPPED[key] ?? key, { key, keyCode: 0, repeat: false });
}
