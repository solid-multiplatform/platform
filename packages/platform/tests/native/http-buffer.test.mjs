import test from 'node:test';
import assert from 'node:assert/strict';
import { httpArrayBuffer } from '../../hosts/android-tv/http-buffer.android.ts';

test('Android image bytes reach the runtime in bulk without the per-byte fallback', () => {
  const nativeBytes = [0, 127, -128, -1];
  const expected = new Uint8Array([0, 127, 128, 255]).buffer;
  globalThis.java = {
    nio: {
      ByteBuffer: {
        wrap(bytes) {
          assert.equal(bytes, nativeBytes);
          return { bytes };
        },
      },
    },
  };
  ArrayBuffer.from = (buffer) => {
    assert.equal(buffer.bytes, nativeBytes);
    return expected;
  };
  try {
    assert.equal(
      httpArrayBuffer({
        raw: { toByteArray: () => nativeBytes },
        toArrayBuffer() {
          throw new Error('Per-byte bridge path must not run');
        },
      }),
      expected,
    );
  } finally {
    delete ArrayBuffer.from;
  }
});

test('unknown HTTP content retains the normal adapter fallback', () => {
  const expected = new ArrayBuffer(4);
  assert.equal(
    httpArrayBuffer({ raw: {}, toArrayBuffer: () => expected }),
    expected,
  );
});
