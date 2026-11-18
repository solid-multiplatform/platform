// Standard globals the renderer reads and Hermes does not have. Each is the
// narrowest thing that satisfies the reader, and each should go once the
// reader takes it from the platform adapter instead:
//
// - `Blob`: packages/renderer/webgl/src/core/textures/sources.ts:71 tells a
//   prefetched font atlas (what `Platform.fetch(url, 'blob')` resolved with)
//   from `ImageData` by `src instanceof Blob`, and
//   packages/renderer/webgl/src/common/utils.ts:85 builds one from a data
//   URI. Without the global a prefetched atlas would be uploaded as if it
//   were pixels.
//
// Nothing here is `window` or `document`.

const bytesOf = new WeakMap<object, Uint8Array>();

/**
 * `Blob`, as far as an image source needs it: bytes with a media type. Text
 * parts, `slice`, `stream` and `text` are not implemented.
 */
export class DesktopBlob {
  readonly size: number;
  readonly type: string;

  constructor(parts: unknown[] = [], options?: { type?: string }) {
    const chunks = parts.map((part): Uint8Array => {
      if (part instanceof ArrayBuffer) return new Uint8Array(part);
      if (ArrayBuffer.isView(part))
        return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      const inner = bytesOf.get(part as object);
      if (inner !== undefined) return inner;
      throw new TypeError(
        'Blob: only ArrayBuffer, typed array and Blob parts are implemented by the desktop host',
      );
    });
    let bytes: Uint8Array;
    if (chunks.length === 1) {
      // The usual case, a fetched file: kept, not copied.
      bytes = chunks[0]!;
    } else {
      bytes = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
    }
    bytesOf.set(this, bytes);
    this.size = bytes.byteLength;
    this.type = options?.type ?? '';
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = bytesOf.get(this)!;
    return Promise.resolve(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  }
}

/** The bytes of a `Blob` made here, in place; undefined for anything else. */
export function blobBytes(blob: unknown): Uint8Array | undefined {
  return blob !== null && typeof blob === 'object'
    ? bytesOf.get(blob)
    : undefined;
}

// Installed with the module: whatever uses the adapter needs it in place.
const scope = globalThis as { Blob?: unknown };
if (scope.Blob === undefined) scope.Blob = DesktopBlob;
