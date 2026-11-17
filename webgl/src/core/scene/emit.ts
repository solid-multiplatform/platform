import type { VertexStream } from '../gl/VertexStream.js';

/**
 * Write one quad (TL, TR, BL, BR) into the stream: the vertex layout of
 * roadmap section 4.4, twenty-four stores, the UV rect (u1, v1) to (u2, v2)
 * spread over the corners. Callers check `isFull` before
 * calling. ScenePass.emit and TextEmitter.emitText store the same words
 * inline: V8 boxes every double passed to a call it has not inlined, about
 * 2 kB a frame in the probe's scroll scene while emit was still warming up
 * (phase 7). Tests build the streams they expect with it, and pin both
 * inline writers against it.
 */
export function writeQuad(
  stream: VertexStream,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  u1: number,
  v1: number,
  u2: number,
  v2: number,
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  extra: number,
): void {
  const f = stream.f32;
  const u = stream.u32;
  const i = stream.cursor;
  f[i] = x0;
  f[i + 1] = y0;
  f[i + 2] = u1;
  f[i + 3] = v1;
  u[i + 4] = c0;
  f[i + 5] = extra;

  f[i + 6] = x1;
  f[i + 7] = y1;
  f[i + 8] = u2;
  f[i + 9] = v1;
  u[i + 10] = c1;
  f[i + 11] = extra;

  f[i + 12] = x2;
  f[i + 13] = y2;
  f[i + 14] = u1;
  f[i + 15] = v2;
  u[i + 16] = c2;
  f[i + 17] = extra;

  f[i + 18] = x3;
  f[i + 19] = y3;
  f[i + 20] = u2;
  f[i + 21] = v2;
  u[i + 22] = c3;
  f[i + 23] = extra;
  stream.cursor = i + 24;
}
