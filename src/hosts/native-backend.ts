export const browserHost = undefined;
export function createDefaultRenderer(): never {
  throw new Error('Install the device host before creating the renderer.');
}
export function prefetchFont(): void {
  // Native faces are supplied by the host.
}
