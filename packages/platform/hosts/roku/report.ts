/**
 * Puts a host failure on the device console. A release build strips
 * `console.*` calls from the bundle; a failure of the host itself (the app
 * could not start, a key handler threw) must still be readable there, so
 * this goes through `globalThis`, which the build leaves alone.
 */
export function reportError(label: string, error: unknown): void {
  const text =
    error instanceof Error ? error.stack || error.message : String(error);
  globalThis.console.error(label + ' ' + text);
}
