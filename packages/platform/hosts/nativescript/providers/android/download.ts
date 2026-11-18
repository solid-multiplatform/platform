import type { DownloadPort } from '../../../../src/sdk/download.js';
import { copyStream, writeBytesFile, writeTextFile } from './io.js';
import type { AndroidApp } from './runtime.js';

/**
 * Saves into the shared Downloads collection through `MediaStore` (Android 10
 * and later, where it needs no storage permission); `saveUrl` hands the
 * address to `DownloadManager`, which fetches it outside the app and shows
 * its own notification. The data is staged in the app's cache and copied
 * across on a background thread. Synchronous to construct, for `downloadUrl`.
 */
export function download(app: AndroidApp): DownloadPort {
  const context = app.context;
  const columns = android.provider.MediaStore.MediaColumns;
  return {
    async save(data, options) {
      const staged = new java.io.File(
        context.getCacheDir(),
        `solid-download-${Date.now()}`,
      );
      const path = String(staged.getPath());
      if (typeof data === 'string') await writeTextFile(path, data);
      else
        await writeBytesFile(
          path,
          data instanceof Uint8Array
            ? data
            : new Uint8Array(await data.arrayBuffer()),
        );
      const resolver = context.getContentResolver();
      const values = new android.content.ContentValues();
      values.put(columns.DISPLAY_NAME, options.name);
      values.put(
        columns.MIME_TYPE,
        (
          options.mimeType ??
          (typeof data === 'string' ? 'text/plain' : 'application/octet-stream')
        ).split(';')[0]!,
      );
      values.put(columns.IS_PENDING, java.lang.Integer.valueOf(1));
      const uri = resolver.insert(
        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
        values,
      );
      try {
        const output = uri && resolver.openOutputStream(uri);
        if (!uri || !output) throw new Error('Could not create the download');
        await copyStream(new java.io.FileInputStream(staged), output);
        const done = new android.content.ContentValues();
        done.put(columns.IS_PENDING, java.lang.Integer.valueOf(0));
        resolver.update(uri, done, null, null);
      } catch (error) {
        if (uri) resolver.delete(uri, null, null);
        throw error;
      } finally {
        staged.delete();
      }
    },
    saveUrl(url, name) {
      const address = android.net.Uri.parse(url);
      const request = new android.app.DownloadManager.Request(address);
      request.setNotificationVisibility(
        android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
      );
      request.setDestinationInExternalPublicDir(
        android.os.Environment.DIRECTORY_DOWNLOADS,
        name ?? String(address.getLastPathSegment() ?? 'download'),
      );
      const manager: android.app.DownloadManager = context.getSystemService(
        android.content.Context.DOWNLOAD_SERVICE,
      );
      manager.enqueue(request);
    },
  };
}
