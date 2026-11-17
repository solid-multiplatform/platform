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
export declare function writeQuad(stream: VertexStream, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, u1: number, v1: number, u2: number, v2: number, c0: number, c1: number, c2: number, c3: number, extra: number): void;
