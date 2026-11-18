/** Host resources are available after device startup and before the app mounts. */
export type PluginHost =
  | { target: 'web' | 'tizen' | 'webos' | 'vizio' | 'desktop' }
  | { target: 'roku'; root: object }
  | {
      target: 'android' | 'android-tv' | 'ios' | 'apple-tv';
      root: object;
      canvas: object;
    };

export interface HostPlugin {
  attach?(host: PluginHost): void | (() => void);
}

/** Release completed attachments in reverse order, including on partial startup failure. */
export function attachPlugins(
  plugins: Record<string, HostPlugin>,
  host: PluginHost,
): () => void {
  const cleanups: Array<() => void> = [];
  const dispose = () => {
    const failures: unknown[] = [];
    while (cleanups.length) {
      try {
        cleanups.pop()!();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  };
  try {
    for (const plugin of Object.values(plugins)) {
      const cleanup = plugin.attach?.(host);
      if (cleanup) cleanups.push(cleanup);
    }
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      console.error('Plugin cleanup failed', cleanupError);
    }
    throw error;
  }
  return dispose;
}
