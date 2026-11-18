// Generates the images the Roku SceneGraph backend draws with: alpha ramps
// for gradients, corner weights for four-corner colours, and pre-blurred
// 9-patch shadows. Every pixel is white; the backend tints with blendColor.
//
//   node packages/renderer/roku/assets/generate.mjs
//
// writes the files beside this script. The outputs are committed and the
// Roku preset copies them to pkg:/assets/smp/. tests/roku-assets.test.mjs
// holds this script to the committed bytes, so change both together and
// keep the tables below in step with ../assets.ts.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Shadow corner radii and blurs shipped; a request draws with the nearest. */
export const SHADOW_RADII = [0, 8, 16, 32, 64];
export const SHADOW_BLURS = [4, 8, 16, 32];

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** An 8-bit RGBA PNG. `rgba(x, y)` returns [r, g, b, a]. */
export function png(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgba(x, y);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const white = (alpha) => [255, 255, 255, Math.max(0, Math.min(255, Math.round(alpha * 255)))];

const RAMP = 256;
const WEIGHT = 128;

/** Where the shadow box and its fade sit in a 9-patch. */
export function shadowLayout(radius, blur) {
  // The corner cell holds everything that is not constant along an edge:
  // the fade (blur outside the box, blur inside) and the corner arc.
  const cell = blur + Math.max(radius, blur);
  return { cell, size: 2 * cell + 2 };
}

/**
 * The shadow of a rounded box as the WebGL backend draws it: alpha runs
 * from 1 at `blur` inside the box edge to 0 at `blur` outside, by
 * smoothstep. A 9-patch: a 1 px guide frame whose black pixels on the top
 * and left mark the 2 px middle that stretches.
 */
function shadow(radius, blur) {
  const { cell, size } = shadowLayout(radius, blur);
  const half = size / 2 - blur; // half extent of the box
  return png(size + 2, size + 2, (px, py) => {
    const x = px - 1;
    const y = py - 1;
    if (x < 0 || y < 0 || x >= size || y >= size) {
      const along = px === 0 || px === size + 1 ? y : x;
      const corner = (px === 0 || px === size + 1) && (py === 0 || py === size + 1);
      const guide = (px === 0 || py === 0) && !corner && along >= cell && along < cell + 2;
      return guide ? [0, 0, 0, 255] : [0, 0, 0, 0];
    }
    // Signed distance from the pixel centre to the rounded box.
    const qx = Math.abs(x + 0.5 - size / 2) - half + radius;
    const qy = Math.abs(y + 0.5 - size / 2) - half + radius;
    const distance =
      Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
    const t = Math.max(0, Math.min(1, (distance + blur) / (2 * blur)));
    return white(1 - t * t * (3 - 2 * t));
  });
}

/** Every generated file, by name. */
export function renderAssets() {
  const files = new Map();
  // Alpha 0 -> 1 left to right, and top to bottom. Over a base colour and
  // tinted with a second, each draws a two-colour gradient.
  files.set('ramp-h.png', png(RAMP, 2, (x) => white(x / (RAMP - 1))));
  files.set('ramp-v.png', png(2, RAMP, (_x, y) => white(y / (RAMP - 1))));
  // Alpha 1 at the centre -> 0 at the edge of the inscribed ellipse.
  files.set(
    'ramp-radial.png',
    png(RAMP, RAMP, (x, y) =>
      white(1 - Math.hypot(x + 0.5 - RAMP / 2, y + 0.5 - RAMP / 2) / (RAMP / 2)),
    ),
  );
  // Four-corner colours, drawn as layers: the top-left colour, the top-right
  // through ramp-h, then the bottom-left through weight-bl and the
  // bottom-right through weight-br. With u across and v down, the last two
  // alphas are v(1-u)/(1-uv) and uv, which composite to the bilinear blend.
  const at = (i) => (i + 0.5) / WEIGHT;
  files.set(
    'weight-bl.png',
    png(WEIGHT, WEIGHT, (x, y) => {
      const u = at(x);
      const v = at(y);
      return white((v * (1 - u)) / (1 - u * v));
    }),
  );
  files.set('weight-br.png', png(WEIGHT, WEIGHT, (x, y) => white(at(x) * at(y))));
  for (const radius of SHADOW_RADII) {
    for (const blur of SHADOW_BLURS) {
      files.set(`shadow-r${radius}-b${blur}.9.png`, shadow(radius, blur));
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, bytes] of renderAssets()) {
    writeFileSync(new URL(name, import.meta.url), bytes);
    console.log(name, bytes.length);
  }
}
