// Decodes a Roku screenshot to RGBA with nothing but node:zlib. The developer
// installer returns a PNG on some models and a baseline JPEG on others (this
// TV: JPEG), so both are read here. Not a general decoder: 8-bit truecolour
// PNG without interlacing, and baseline (SOF0) Huffman JPEG.
import { inflateSync } from 'node:zlib';

/** `{ width, height, data }` with `data` as RGBA bytes, or throws. */
export function decodeImage(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return decodePng(buffer);
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return decodeJpeg(buffer);
  throw new Error('The screenshot is neither a PNG nor a JPEG.');
}

/** `png` or `jpg`, by the file's first bytes. */
export const imageKind = (buffer) => (buffer[0] === 0x89 ? 'png' : 'jpg');

/** The pixel at (x, y) as [r, g, b, a]. */
export function pixel(image, x, y) {
  const px = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const i = (py * image.width + px) * 4;
  const d = image.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

/** The mean of the (2r+1)^2 pixels around (x, y): evens out JPEG noise. */
export function sample(image, x, y, r = 1) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const p = pixel(image, x + dx, y + dy);
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      n++;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export function decodePng(buffer) {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || ![0, 2, 4, 6].includes(colorType))
        throw new Error(
          'Unsupported PNG (needs 8-bit, no palette, no interlace).',
        );
      channels = [1, 0, 3, 0, 2, 0, 4][colorType];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const lines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? lines[to + x - channels] : 0;
      const b = y > 0 ? lines[to + x - stride] : 0;
      const c = x >= channels && y > 0 ? lines[to + x - stride - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      lines[to + x] = (raw[from + x] + predicted) & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < lines.length; i += channels, o += 4) {
    const grey = channels < 3;
    data[o] = lines[i];
    data[o + 1] = grey ? lines[i] : lines[i + 1];
    data[o + 2] = grey ? lines[i] : lines[i + 2];
    data[o + 3] =
      channels === 4 ? lines[i + 3] : channels === 2 ? lines[i + 1] : 255;
  }
  return { width, height, data };
}

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

// cos((2x + 1) * u * pi / 16) * c(u) / 2, for the separable inverse DCT.
const IDCT = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    IDCT[u * 8 + x] =
      Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
      (u === 0 ? Math.SQRT1_2 : 1) *
      0.5;
  }
}

function huffmanTable(counts, symbols) {
  // Canonical codes: for each length, the first code and the first symbol index.
  const table = {
    maxCode: new Int32Array(17).fill(-1),
    firstIndex: new Int32Array(17),
    firstCode: new Int32Array(17),
    symbols,
  };
  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length++) {
    table.firstCode[length] = code;
    table.firstIndex[length] = index;
    if (counts[length - 1] > 0)
      table.maxCode[length] = code + counts[length - 1] - 1;
    code = (code + counts[length - 1]) << 1;
    index += counts[length - 1];
  }
  return table;
}

export function decodeJpeg(buffer) {
  const quant = [];
  const dc = [];
  const ac = [];
  let frame = null;
  let restartInterval = 0;
  let at = 2;
  while (at < buffer.length) {
    if (buffer[at] !== 0xff) throw new Error('Corrupt JPEG marker.');
    const marker = buffer[at + 1];
    const length = buffer.readUInt16BE(at + 2);
    const body = buffer.subarray(at + 4, at + 2 + length);
    if (marker === 0xdb) {
      for (let i = 0; i < body.length; ) {
        const wide = body[i] >> 4;
        const id = body[i] & 15;
        i++;
        const table = new Int32Array(64);
        for (let k = 0; k < 64; k++) {
          table[ZIGZAG[k]] = wide ? body.readUInt16BE(i) : body[i];
          i += wide ? 2 : 1;
        }
        quant[id] = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      frame = {
        height: body.readUInt16BE(1),
        width: body.readUInt16BE(3),
        components: [],
      };
      for (let i = 0; i < body[5]; i++) {
        frame.components.push({
          id: body[6 + i * 3],
          h: body[7 + i * 3] >> 4,
          v: body[7 + i * 3] & 15,
          quant: body[8 + i * 3],
        });
      }
    } else if (marker === 0xc2) {
      throw new Error('Progressive JPEG screenshots are not supported.');
    } else if (marker === 0xc4) {
      for (let i = 0; i < body.length; ) {
        const kind = body[i] >> 4;
        const id = body[i] & 15;
        const counts = body.subarray(i + 1, i + 17);
        let total = 0;
        for (const count of counts) total += count;
        const table = huffmanTable(
          counts,
          body.subarray(i + 17, i + 17 + total),
        );
        (kind === 0 ? dc : ac)[id] = table;
        i += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = body.readUInt16BE(0);
    } else if (marker === 0xda) {
      const scan = [];
      for (let i = 0; i < body[0]; i++) {
        const component = frame.components.find(
          (c) => c.id === body[1 + i * 2],
        );
        component.dc = dc[body[2 + i * 2] >> 4];
        component.ac = ac[body[2 + i * 2] & 15];
        scan.push(component);
      }
      return decodeScan(
        buffer,
        at + 2 + length,
        frame,
        scan,
        quant,
        restartInterval,
      );
    }
    at += 2 + length;
  }
  throw new Error('The JPEG has no scan.');
}

function decodeScan(buffer, start, frame, scan, quant, restartInterval) {
  const maxH = Math.max(...frame.components.map((c) => c.h));
  const maxV = Math.max(...frame.components.map((c) => c.v));
  const mcuW = 8 * maxH;
  const mcuH = 8 * maxV;
  const mcusX = Math.ceil(frame.width / mcuW);
  const mcusY = Math.ceil(frame.height / mcuH);
  for (const c of frame.components) {
    c.stride = mcusX * c.h * 8;
    c.plane = new Uint8Array(c.stride * mcusY * c.v * 8);
    c.pred = 0;
  }

  let at = start;
  let bits = 0;
  let bitCount = 0;
  const readBit = () => {
    if (bitCount === 0) {
      let byte = buffer[at++];
      if (byte === 0xff) {
        const next = buffer[at];
        if (next === 0) at++;
        else byte = 0; // A marker: feed zeros, the caller handles restarts.
      }
      bits = byte;
      bitCount = 8;
    }
    bitCount--;
    return (bits >> bitCount) & 1;
  };
  const receive = (length) => {
    let value = 0;
    for (let i = 0; i < length; i++) value = (value << 1) | readBit();
    return value;
  };
  const extend = (value, length) =>
    length === 0
      ? 0
      : value < 1 << (length - 1)
        ? value - (1 << length) + 1
        : value;
  const decodeSymbol = (table) => {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | readBit();
      if (table.maxCode[length] >= code && code >= table.firstCode[length])
        return table.symbols[
          table.firstIndex[length] + code - table.firstCode[length]
        ];
    }
    throw new Error('Corrupt JPEG Huffman code.');
  };

  const block = new Float64Array(64);
  const temp = new Float64Array(64);
  const decodeBlock = (c, plane, px, py) => {
    block.fill(0);
    const q = quant[c.quant];
    const size = decodeSymbol(c.dc);
    c.pred += extend(receive(size), size);
    block[0] = c.pred * q[0];
    for (let k = 1; k < 64; ) {
      const symbol = decodeSymbol(c.ac);
      const run = symbol >> 4;
      const bitsNeeded = symbol & 15;
      if (bitsNeeded === 0) {
        if (run !== 15) break;
        k += 16;
        continue;
      }
      k += run;
      const z = ZIGZAG[k];
      block[z] = extend(receive(bitsNeeded), bitsNeeded) * q[z];
      k++;
    }
    // Rows, then columns.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) sum += block[y * 8 + u] * IDCT[u * 8 + x];
        temp[y * 8 + x] = sum;
      }
    }
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) sum += temp[v * 8 + x] * IDCT[v * 8 + y];
        const value = Math.round(sum + 128);
        plane[(py + y) * c.stride + px + x] =
          value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
  };

  let untilRestart = restartInterval;
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      if (restartInterval > 0 && untilRestart === 0) {
        bitCount = 0;
        while (
          !(
            buffer[at] === 0xff &&
            buffer[at + 1] >= 0xd0 &&
            buffer[at + 1] <= 0xd7
          )
        )
          at++;
        at += 2;
        for (const c of scan) c.pred = 0;
        untilRestart = restartInterval;
      }
      untilRestart--;
      for (const c of scan) {
        for (let by = 0; by < c.v; by++) {
          for (let bx = 0; bx < c.h; bx++) {
            decodeBlock(c, c.plane, (mx * c.h + bx) * 8, (my * c.v + by) * 8);
          }
        }
      }
    }
  }

  const { width, height } = frame;
  const data = new Uint8Array(width * height * 4);
  const [Y, Cb, Cr] = frame.components;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  // Chroma is read bilinearly, as viewers do, so that a subsampled edge
  // does not turn into blocks.
  const chroma = (c, x, y) => {
    const fx = Math.max(0, ((x + 0.5) * c.h) / maxH - 0.5);
    const fy = Math.max(0, ((y + 0.5) * c.v) / maxV - 0.5);
    const maxX = Math.ceil((width * c.h) / maxH) - 1;
    const maxY = Math.ceil((height * c.v) / maxV) - 1;
    const x0 = Math.min(maxX, Math.floor(fx));
    const y0 = Math.min(maxY, Math.floor(fy));
    const x1 = Math.min(maxX, x0 + 1);
    const y1 = Math.min(maxY, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const p = c.plane;
    const s = c.stride;
    return (
      (p[y0 * s + x0] * (1 - tx) + p[y0 * s + x1] * tx) * (1 - ty) +
      (p[y1 * s + x0] * (1 - tx) + p[y1 * s + x1] * tx) * ty
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luma = Y.plane[y * Y.stride + x];
      const o = (y * width + x) * 4;
      if (!Cb) {
        data[o] = data[o + 1] = data[o + 2] = luma;
      } else {
        const cb = chroma(Cb, x, y) - 128;
        const cr = chroma(Cr, x, y) - 128;
        data[o] = clamp(luma + 1.402 * cr);
        data[o + 1] = clamp(luma - 0.344136 * cb - 0.714136 * cr);
        data[o + 2] = clamp(luma + 1.772 * cb);
      }
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}
