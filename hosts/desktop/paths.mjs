import os from 'node:os';
import path from 'node:path';

/** Per-user application data directory used by window state, locks and updates. */
export function desktopDataDir() {
  if (process.env.SOLID_APP_DATA) return process.env.SOLID_APP_DATA;
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'solid-multiplatform',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'solid-multiplatform',
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'solid-multiplatform',
  );
}
