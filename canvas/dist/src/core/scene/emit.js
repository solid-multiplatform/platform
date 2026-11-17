/**
 * Write one quad (TL, TR, BL, BR) into the stream: the vertex layout of
 * roadmap section 4.4, twenty stores. Callers check `isFull` before
 * calling. ScenePass.emit and TextEmitter.emitText store the same words
 * inline: V8 boxes every double passed to a call it has not inlined, about
 * 2 kB a frame in the probe's scroll scene while emit was still warming up
 * (phase 7). Tests build the streams they expect with it, and pin both
 * inline writers against it.
 */
export function writeQuad(stream, x0, y0, x1, y1, x2, y2, x3, y3, uv0, uv1, uv2, uv3, c0, c1, c2, c3, extra) {
    const f = stream.f32;
    const u = stream.u32;
    const i = stream.cursor;
    f[i] = x0;
    f[i + 1] = y0;
    u[i + 2] = uv0;
    u[i + 3] = c0;
    f[i + 4] = extra;
    f[i + 5] = x1;
    f[i + 6] = y1;
    u[i + 7] = uv1;
    u[i + 8] = c1;
    f[i + 9] = extra;
    f[i + 10] = x2;
    f[i + 11] = y2;
    u[i + 12] = uv2;
    u[i + 13] = c2;
    f[i + 14] = extra;
    f[i + 15] = x3;
    f[i + 16] = y3;
    u[i + 17] = uv3;
    u[i + 18] = c3;
    f[i + 19] = extra;
    stream.cursor = i + 20;
}
//# sourceMappingURL=emit.js.map