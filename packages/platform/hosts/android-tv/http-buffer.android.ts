import type { HttpContent } from '@nativescript/core/http';

/** Core 9.1.3's toArrayBuffer iterates Java bytes through the JS bridge. */
export function httpArrayBuffer(content: HttpContent): ArrayBuffer {
  const from = (ArrayBuffer as any).from;
  if (
    typeof from === 'function' &&
    typeof content.raw?.toByteArray === 'function'
  ) {
    // A heap ByteBuffer is copied in bulk into V8-owned memory by the runtime.
    return from(java.nio.ByteBuffer.wrap(content.raw.toByteArray()));
  }
  return content.toArrayBuffer();
}
