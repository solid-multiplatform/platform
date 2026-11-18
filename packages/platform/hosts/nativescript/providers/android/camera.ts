import type { CameraPort } from '../../../../src/sdk/capture.js';
import { shareableUri } from './content-uri.js';
import { startForResult } from './results.js';
import type { AndroidApp } from './runtime.js';

/**
 * One photo from the device's camera app (`ACTION_IMAGE_CAPTURE`), written to
 * a file in the app's cache that the camera app reaches through the
 * FileProvider. The app needs no camera permission, and must not declare one:
 * Android then demands it for this intent too. `quality` is the camera app's
 * choice. The photo's `dataUrl` is a `file://` address; the app removes the
 * file when it is done with it.
 */
export function camera(app: AndroidApp): CameraPort {
  const Intent = android.content.Intent;
  return {
    async capture(options) {
      const directory = new java.io.File(
        app.context.getCacheDir(),
        'solid-capture',
      );
      directory.mkdirs();
      const file = new java.io.File(directory, `photo-${Date.now()}.jpg`);
      const uri = shareableUri(app, file);
      const intent = new Intent(
        android.provider.MediaStore.ACTION_IMAGE_CAPTURE,
      );
      intent.putExtra(
        android.provider.MediaStore.EXTRA_OUTPUT,
        uri as android.os.Parcelable,
      );
      intent.setClipData(android.content.ClipData.newRawUri('', uri));
      intent.addFlags(
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
          Intent.FLAG_GRANT_READ_URI_PERMISSION,
      );
      // A hint camera apps may follow; there is no public extra for it.
      if (options.facingMode === 'user')
        intent.putExtra('android.intent.extras.CAMERA_FACING', 1);
      const result = await startForResult(app, intent);
      if (result.resultCode !== android.app.Activity.RESULT_OK) {
        file.delete();
        const error = new Error('The photo was not taken');
        error.name = 'AbortError';
        throw error;
      }
      const bounds = new android.graphics.BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      android.graphics.BitmapFactory.decodeFile(file.getPath(), bounds);
      return {
        dataUrl: 'file://' + String(file.getPath()),
        width: bounds.outWidth,
        height: bounds.outHeight,
      };
    },
  };
}
