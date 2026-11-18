import type { AndroidApp } from './runtime.js';

/**
 * A `content://` address another app can open, for a file in the app's own
 * directories. Served by the `androidx.core.content.FileProvider` the
 * manifest declares under the authority `<package>.solid.files`.
 */
export function shareableUri(
  app: AndroidApp,
  file: java.io.File,
): android.net.Uri {
  return androidx.core.content.FileProvider.getUriForFile(
    app.context,
    app.context.getPackageName() + '.solid.files',
    file,
  );
}
