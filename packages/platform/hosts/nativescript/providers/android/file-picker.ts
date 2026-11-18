import type { FilePickerPort, PickedFile } from '../../../../src/sdk/files.js';
import { copyStream } from './io.js';
import { startForResult } from './results.js';
import { fromUtf8, sdk, strings, type AndroidApp } from './runtime.js';

/** MIME types for an `accept` list such as `image/*,.pdf`. Empty: any file. */
function acceptedTypes(accept: string | undefined): string[] {
  const types: string[] = [];
  for (const raw of (accept ?? '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    const type = entry.startsWith('.')
      ? android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(
          entry.slice(1),
        )
      : entry;
    // An extension Android has no type for cannot be filtered on.
    if (!type) return [];
    types.push(String(type));
  }
  return types;
}

function picked(app: AndroidApp, uri: android.net.Uri): PickedFile {
  const resolver = app.context.getContentResolver();
  const columns = android.provider.OpenableColumns;
  let name = String(uri.getLastPathSegment() ?? '');
  let size = 0;
  // One row of metadata from the document provider.
  const cursor = resolver.query(uri, null, null, null, null);
  if (cursor) {
    try {
      if (cursor.moveToFirst()) {
        const nameAt = cursor.getColumnIndex(columns.DISPLAY_NAME);
        const sizeAt = cursor.getColumnIndex(columns.SIZE);
        if (nameAt >= 0) name = String(cursor.getString(nameAt) ?? name);
        if (sizeAt >= 0 && !cursor.isNull(sizeAt))
          size = cursor.getLong(sizeAt);
      }
    } finally {
      cursor.close();
    }
  }
  // Read on a background thread, each time the app asks.
  const read = async (): Promise<androidNative.Array<number>> => {
    const input = resolver.openInputStream(uri);
    if (!input) throw new Error('Could not open ' + name);
    const output = new java.io.ByteArrayOutputStream();
    await copyStream(input, output);
    return output.toByteArray();
  };
  return {
    name,
    type: String(resolver.getType(uri) ?? ''),
    size,
    text: async () => fromUtf8(await read()),
    bytes: async () =>
      new Uint8Array(ArrayBuffer.from(java.nio.ByteBuffer.wrap(await read()))),
  };
}

/**
 * The system document picker (`ACTION_OPEN_DOCUMENT`), or the photo picker
 * (Android 13 and later) when only images or video are accepted. Neither
 * needs a storage permission. Resolves with an empty list when the user
 * backs out.
 */
export function filePicker(app: AndroidApp): FilePickerPort {
  const Intent = android.content.Intent;
  return {
    async pick(options) {
      const types = acceptedTypes(options.accept);
      const media =
        types.length > 0 &&
        types.every((type) => /^(image|video)\//.test(type));
      let intent: android.content.Intent;
      if (media && sdk() >= 33) {
        intent = new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
        if (types.length === 1) intent.setType(types[0]!);
        if (options.multiple)
          intent.putExtra(
            android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX,
            android.provider.MediaStore.getPickImagesMaxLimit(),
          );
      } else {
        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(types.length === 1 ? types[0]! : '*/*');
        if (types.length > 1)
          intent.putExtra(Intent.EXTRA_MIME_TYPES, strings(types));
        if (options.multiple)
          intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      }
      const result = await startForResult(app, intent);
      const data = result.intent;
      if (result.resultCode !== android.app.Activity.RESULT_OK || !data)
        return [];
      const uris: android.net.Uri[] = [];
      const clip = data.getClipData();
      if (clip)
        for (let i = 0; i < clip.getItemCount(); i++)
          uris.push(clip.getItemAt(i).getUri());
      else {
        const single = data.getData();
        if (single) uris.push(single);
      }
      return uris.map((uri) => picked(app, uri));
    },
  };
}
