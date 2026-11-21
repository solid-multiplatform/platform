// Builds the visual test app, installs it on the Roku named by ROKU_DEV_IP,
// takes a screenshot and checks rounded corners, borders, gradients, corner
// colours, a shadow, clipping and text against what the platform's styles
// mean (the WebGL backend's geometry). Exits non-zero on a failed probe.
// This replaces whatever is in the device's developer slot. The app that was
// on screen before is brought back afterwards.
//
//   node tests/roku-device/run-visual.mjs [--out shot.jpg] [--tier assets] [--keep]
//
// `--tier assets` holds the backend to its image tier, the one a Roku
// without the Effect node gets: corners are expected square and a slanted
// gradient on an axis, and each must be reported as a gap on the console.
//
// The probes read colours away from edges and allow for JPEG loss: this TV's
// screenshots are 4:2:0 JPEGs, so a hue is only exact some pixels in.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  launch,
  readConsole,
  rokuDevice,
  screenshot,
  sideload,
} from '../../cli/roku-device.mjs';
import { decodeImage, imageKind, sample } from './image.mjs';
import { BG, CASES as C, PANEL } from './visual-cases.mjs';

const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-visual');
const zip = path.join(out, 'visual.zip');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const assetsTier = flag('--tier') === 'assets';
const device = rokuDevice();

const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
console.log(
  `Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`,
);

rmSync(out, { recursive: true, force: true });
execFileSync(
  path.join(project, 'node_modules/.bin/rk'),
  [
    'build',
    '--local',
    '--no-drop-console',
    '--no-source-map',
    '--out-dir',
    out,
    '--config',
    assetsTier ? 'visual-assets.roku-config.ts' : 'visual.roku-config.ts',
  ],
  { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] },
);
if (!existsSync(path.join(out, 'pkg-dir/manifest')))
  throw new Error('The Roku build produced no package directory.');
execFileSync(
  'python3',
  [
    '-c',
    'import sys,zipfile,pathlib\n' +
      'root=pathlib.Path(sys.argv[1])\n' +
      'with zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n' +
      '    [z.write(f,f.relative_to(root)) for f in sorted(root.rglob("*")) if f.is_file()]',
    path.join(out, 'pkg-dir'),
    zip,
  ],
  { stdio: 'inherit' },
);

const previous = await activeApp(device);
let notes = [];
let fresh = false;
let ready = false;
let shot;
const reading = readConsole(
  device,
  (line) => {
    // On connecting, the console replays what the last app printed.
    if (!fresh) return false;
    // What the app and the backend say about themselves: mounted cases,
    // the tier, capability gaps and errors.
    const at = line.search(/VISUAL |ROKU_[A-Z_]+ /);
    if (at === -1) return false;
    const text = line.slice(at);
    if (text.startsWith('VISUAL START')) notes = [];
    if (!text.startsWith('ROKU_PERF ')) notes.push(text);
    ready = text.startsWith('VISUAL READY');
    return ready;
  },
  90_000,
);
try {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  fresh = true;
  await sideload(device, zip);
  await reading.done;
  if (ready) shot = await screenshot(device);
} finally {
  reading.stop();
  if (!args.includes('--keep') && previous && previous !== 'dev')
    await launch(device, previous).catch(() => {});
}

for (const note of [...new Set(notes)]) console.log(note);
if (!shot) {
  console.error('The app never reported VISUAL READY (did it start?).');
  process.exit(2);
}
const target = flag('--out');
if (target) {
  const file = target.replace(/\.(png|jpe?g)$/i, '') + '.' + imageKind(shot);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, shot);
  console.log('Screenshot: ' + file);
}

// ---- probes ---------------------------------------------------------------

const image = decodeImage(shot);
if (image.width !== 1920 || image.height !== 1080)
  throw new Error(
    `Expected a 1920x1080 screenshot, got ${image.width}x${image.height}.`,
  );

const rgb = (c) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const worst = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const show = (c) => '[' + c.map((v) => Math.round(v)).join(',') + ']';
const FLAT = 14; // per channel, a flat colour away from edges
const RAMP = 20; // per channel, a point on a gradient

/** The failures of the case being probed. */
let failures = [];
function expectColor(what, x, y, want, tolerance = FLAT) {
  const got = sample(image, x, y);
  if (worst(got, want) > tolerance)
    failures.push(
      `${what} at (${Math.round(x)},${Math.round(y)}): got ${show(got)}, want ${show(want)} +-${tolerance}`,
    );
}

/** The colour of a gradient with these stops at t. */
function gradientAt(colors, stops, t) {
  const at = stops ?? colors.map((_, i) => i / (colors.length - 1));
  if (t <= at[0]) return rgb(colors[0]);
  for (let i = 1; i < colors.length; i++) {
    if (t <= at[i])
      return mix(
        rgb(colors[i - 1]),
        rgb(colors[i]),
        (t - at[i - 1]) / (at[i] - at[i - 1]),
      );
  }
  return rgb(colors[colors.length - 1]);
}

const T5 = [0.1, 0.3, 0.5, 0.7, 0.9];

/** A point outside a rounded corner: background, or `square` where the tier draws corners square. */
function expectOutside(what, x, y, square, tolerance = FLAT) {
  // A few pixels inside a square corner the JPEG's shared chroma has bled.
  if (assetsTier)
    expectColor(
      what + ' (square on this tier)',
      x,
      y,
      square,
      Math.max(tolerance, 32),
    );
  else expectColor(what, x, y, bg, tolerance);
}

/** On the image tier, the console must have reported this gap. */
function expectGap(pattern) {
  if (
    assetsTier &&
    !notes.some(
      (note) => note.startsWith('ROKU_EFFECT_GAP') && pattern.test(note),
    )
  )
    failures.push(`no ROKU_EFFECT_GAP matching ${pattern} on the console`);
}

/**
 * Five samples from `from` to `to` (screen points): each within tolerance of
 * the interpolated colour, and for two colours each channel moves one way.
 */
function expectRamp(what, from, to, colors, stops, ts = T5) {
  const got = ts.map((t) =>
    sample(
      image,
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ),
  );
  ts.forEach((t, i) => {
    const want = gradientAt(colors, stops, t);
    if (worst(got[i], want) > RAMP)
      failures.push(
        `${what} at t=${t}: got ${show(got[i])}, want ${show(want)} +-${RAMP}`,
      );
  });
  if (colors.length === 2) {
    const a = rgb(colors[0]);
    const b = rgb(colors[1]);
    for (let ch = 0; ch < 3; ch++) {
      const range = b[ch] - a[ch];
      if (Math.abs(range) < 40) continue;
      // Each step should cover its share of the range; ask for a third of it.
      const rises = ts.every(
        (t, i) =>
          i === 0 ||
          (got[i][ch] - got[i - 1][ch]) * Math.sign(range) >=
            (Math.abs(range) * (t - ts[i - 1])) / 3,
      );
      if (!rises)
        failures.push(
          `${what} is not monotonic in channel ${'rgb'[ch]}: ${got.map((c) => Math.round(c[ch])).join(' ')}`,
        );
    }
  }
}

/** How many pixels from `from` along (dx, dy) are nearest to `color` among `palette`. */
function runLength(from, step, count, color, palette) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const got = sample(image, from[0] + step[0] * i, from[1] + step[1] * i, 0);
    let best = palette[0];
    for (const candidate of palette)
      if (worst(got, candidate) < worst(got, best)) best = candidate;
    if (best === color) n++;
  }
  return n;
}

const bg = rgb(BG);
const probes = {
  rounded(c) {
    const fill = rgb(c.color);
    const r = c.radius;
    // 45 degrees out from each corner's centre: 11 px outside the arc is
    // background, 11 px inside is fill. A square corner fills both.
    const outside = r - (r + 11) * Math.SQRT1_2;
    const inside = r - (r - 11) * Math.SQRT1_2;
    for (const [name, sx, sy] of [
      ['top-left', 0, 0],
      ['top-right', 1, 0],
      ['bottom-right', 1, 1],
      ['bottom-left', 0, 1],
    ]) {
      const px = (d) => c.x + (sx ? c.w - 1 - d : d);
      const py = (d) => c.y + (sy ? c.h - 1 - d : d);
      expectOutside(
        `${name} outside the radius`,
        px(outside),
        py(outside),
        fill,
      );
      expectColor(`${name} inside the radius`, px(inside), py(inside), fill);
    }
    expectColor('centre', c.x + c.w / 2, c.y + c.h / 2, fill);
    expectGap(/rounded corners/);
  },
  // The same shape as `rounded`, reached through an animated transition.
  animatedRadius(c) {
    probes.rounded(c);
  },
  roundedCorners(c) {
    const fill = rgb(c.color);
    const [, tr, br] = c.radius;
    expectColor('top-left is square', c.x + 6, c.y + 6, fill);
    expectColor('bottom-left is square', c.x + 6, c.y + c.h - 7, fill);
    const out = (r) => r - (r + 11) * Math.SQRT1_2;
    const inn = (r) => r - (r - 11) * Math.SQRT1_2;
    expectOutside(
      'top-right outside radius 40',
      c.x + c.w - 1 - out(tr),
      c.y + out(tr),
      fill,
    );
    expectColor(
      'top-right inside radius 40',
      c.x + c.w - 1 - inn(tr),
      c.y + inn(tr),
      fill,
    );
    expectOutside(
      'bottom-right outside radius 80',
      c.x + c.w - 1 - out(br),
      c.y + c.h - 1 - out(br),
      fill,
    );
    expectColor(
      'bottom-right inside radius 80',
      c.x + c.w - 1 - inn(br),
      c.y + c.h - 1 - inn(br),
      fill,
    );
    // Filled at radius 40, background at radius 80: tells the corners apart.
    expectOutside(
      'bottom-right is the larger radius',
      c.x + c.w - 1 - inn(tr),
      c.y + c.h - 1 - inn(tr),
      fill,
    );
  },
  pill(c) {
    const fill = rgb(c.color);
    const r = c.h / 2; // the radius the node size allows
    const outside = r - (r + 11) * Math.SQRT1_2;
    const inside = r - (r - 11) * Math.SQRT1_2;
    expectOutside(
      'top-left outside the arc',
      c.x + outside,
      c.y + outside,
      fill,
    );
    expectColor('top-left inside the arc', c.x + inside, c.y + inside, fill);
    expectOutside(
      'bottom-right outside the arc',
      c.x + c.w - 1 - outside,
      c.y + c.h - 1 - outside,
      fill,
    );
    // Inside a half-height arc, outside the lens an unclamped radius draws.
    expectColor('above the left arc centre', c.x + r, c.y + 8, fill);
    expectColor(
      'below the right arc centre',
      c.x + c.w - r,
      c.y + c.h - 9,
      fill,
    );
    expectColor('left end', c.x + 8, c.y + c.h / 2, fill);
  },
  borderInside(c) {
    const fill = rgb(c.color);
    const edge = rgb(c.borderColor);
    const bw = c.borderWidth;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    expectColor('fill', cx, cy, fill);
    expectColor('left band, inside the node', c.x + bw / 2, cy, edge);
    expectColor('bottom band, inside the node', cx, c.y + c.h - bw / 2, edge);
    expectColor('outside the node', c.x - 10, cy, bg);
    expectColor('below the node', cx, c.y + c.h + 10, bg);
    const left = runLength([c.x - 20, cy], [1, 0], bw + 40, edge, [
      bg,
      edge,
      fill,
    ]);
    if (Math.abs(left - bw) > 3)
      failures.push(`left border is ${left} px thick, want ${bw} +-3`);
  },
  imageRounded(c) {
    const edge = rgb(c.borderColor);
    const bw = c.borderWidth;
    const black = [0, 0, 0];
    expectColor('image', c.x + c.w / 2, c.y + c.h / 2, black);
    expectColor('left band', c.x - bw / 2, c.y + c.h / 2, edge);
    const ox = c.x - bw;
    const oy = c.y - bw;
    const outer = c.radius + bw;
    const at = (radial) => outer - radial * Math.SQRT1_2;
    expectOutside(
      'outside the outer corner',
      ox + at(outer + 11),
      oy + at(outer + 11),
      edge,
    );
    if (!assetsTier)
      expectColor(
        'border on the corner arc',
        ox + at(outer - bw / 2),
        oy + at(outer - bw / 2),
        edge,
        40,
      );
    expectColor(
      'image inside the corner',
      ox + at(c.radius - 11),
      oy + at(c.radius - 11),
      black,
    );
  },
  imageCrop(c) {
    // The ramp's alpha runs 0 -> 1 over 256 px; its right half is 0.5 -> 1,
    // over the background. Uncropped it would start at 0.
    const tint = rgb(c.color);
    const cy = c.y + c.h / 2;
    for (const t of T5) {
      const alpha = (c.srcX + c.srcWidth * t) / 255;
      expectColor(
        `alpha ${alpha.toFixed(2)} at t=${t}`,
        c.x + c.w * t,
        cy,
        mix(bg, tint, Math.min(1, alpha)),
        RAMP,
      );
    }
    expectColor('nothing drawn past the node', c.x + c.w + 12, cy, bg);
    expectColor('nothing drawn before the node', c.x - 12, cy, bg);
  },
  cornersRounded(c) {
    const r = c.radius;
    const outside = r - (r + 11) * Math.SQRT1_2;
    const at = (u, v) =>
      mix(
        mix(rgb(c.colorTl), rgb(c.colorTr), u),
        mix(rgb(c.colorBl), rgb(c.colorBr), u),
        v,
      );
    for (const [name, sx, sy] of [
      ['top-left', 0, 0],
      ['top-right', 1, 0],
      ['bottom-left', 0, 1],
      ['bottom-right', 1, 1],
    ]) {
      const dx = sx ? c.w - 1 - outside : outside;
      const dy = sy ? c.h - 1 - outside : outside;
      expectOutside(
        `${name} outside the radius`,
        c.x + dx,
        c.y + dy,
        at(dx / c.w, dy / c.h),
        26,
      );
    }
    for (const [name, u, v] of [
      ['near top-left', 0.2, 0.2],
      ['near top-right', 0.8, 0.2],
      ['near bottom-left', 0.2, 0.8],
      ['near bottom-right', 0.8, 0.8],
      ['centre', 0.5, 0.5],
    ]) {
      expectColor(name, c.x + c.w * u, c.y + c.h * v, at(u, v), 26);
    }
  },
  borderGap(c) {
    const fill = rgb(c.color);
    const edge = rgb(c.borderColor);
    const cy = c.y + c.h / 2;
    expectColor('fill', c.x + c.w / 2, cy, fill);
    expectColor('gap shows the background', c.x - c.borderGap / 2, cy, bg, 30);
    expectColor(
      'band past the gap',
      c.x - c.borderGap - c.borderWidth / 2,
      cy,
      edge,
      30,
    );
    expectColor(
      'outside the band',
      c.x - c.borderGap - c.borderWidth - 9,
      cy,
      bg,
    );
    const band = runLength(
      [c.x - c.borderGap - c.borderWidth - 16, cy],
      [1, 0],
      c.borderWidth + 16 + c.borderGap,
      edge,
      [bg, edge, fill],
    );
    if (Math.abs(band - c.borderWidth) > 3)
      failures.push(
        `left border is ${band} px thick, want ${c.borderWidth} +-3`,
      );
  },
  linear45wide(c) {
    if (assetsTier) {
      expectGap(/angle snaps to an axis/);
      const cx = c.x + c.w / 2;
      expectRamp(
        'top to bottom (snapped)',
        [cx, c.y],
        [cx, c.y + c.h],
        c.colors,
        c.stops,
      );
      return;
    }
    // The WebGL axis for 45 degrees on w x h (LinearGradient.pack) runs
    // (-1, 1) through the centre and is (w + h) / sqrt 2 long, so its ends
    // lie outside a box that is not square.
    const reach = (c.w + c.h) / 4;
    const from = [c.x + c.w / 2 + reach, c.y + c.h / 2 - reach];
    const to = [c.x + c.w / 2 - reach, c.y + c.h / 2 + reach];
    expectRamp(
      'top-right to bottom-left',
      from,
      to,
      c.colors,
      c.stops,
      [0.2, 0.35, 0.5, 0.65, 0.8],
    );
    const mid = gradientAt(c.colors, c.stops, 0.5);
    expectColor(
      'across the axis, up-left',
      c.x + c.w / 2 - 45,
      c.y + c.h / 2 - 45,
      mid,
      RAMP,
    );
    expectColor(
      'across the axis, down-right',
      c.x + c.w / 2 + 45,
      c.y + c.h / 2 + 45,
      mid,
      RAMP,
    );
  },
  border(c) {
    const fill = rgb(c.color);
    const edge = rgb(c.borderColor);
    const bw = c.borderWidth;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    expectColor('fill', cx, cy, fill);
    expectColor('left band', c.x - bw / 2, cy, edge);
    expectColor('right band', c.x + c.w + bw / 2, cy, edge);
    expectColor('top band', cx, c.y - bw / 2, edge);
    expectColor('bottom band', cx, c.y + c.h + bw / 2, edge);
    expectColor('outside the border', c.x - bw - 10, cy, bg);
    expectColor('inside the border', c.x + 10, cy, fill);
    const palette = [bg, edge, fill];
    const left = runLength([c.x - bw - 20, cy], [1, 0], bw + 40, edge, palette);
    const top = runLength([cx, c.y - bw - 20], [0, 1], bw + 40, edge, palette);
    if (Math.abs(left - bw) > 3)
      failures.push(`left border is ${left} px thick, want ${bw} +-3`);
    if (Math.abs(top - bw) > 3)
      failures.push(`top border is ${top} px thick, want ${bw} +-3`);
  },
  roundedBorder(c) {
    const fill = rgb(c.color);
    const edge = rgb(c.borderColor);
    const bw = c.borderWidth;
    const cy = c.y + c.h / 2;
    const palette = [bg, edge, fill];
    const left = runLength([c.x - bw - 20, cy], [1, 0], bw + 40, edge, palette);
    if (Math.abs(left - bw) > 3)
      failures.push(`left border is ${left} px thick, want ${bw} +-3`);
    expectColor('fill', c.x + c.w / 2, cy, fill);
    // The outer box and its radius (node radius + border width), from the
    // outer box's top-left corner along the diagonal.
    const ox = c.x - bw;
    const oy = c.y - bw;
    const outer = c.radius + bw;
    const at = (radial) => outer - radial * Math.SQRT1_2;
    expectOutside(
      'outside the outer corner',
      ox + at(outer + 11),
      oy + at(outer + 11),
      edge,
    );
    if (!assetsTier)
      expectColor(
        'border on the corner arc',
        ox + at(outer - bw / 2),
        oy + at(outer - bw / 2),
        edge,
        40,
      );
    expectColor(
      'fill inside the corner',
      ox + at(c.radius - 11),
      oy + at(c.radius - 11),
      fill,
    );
  },
  borderBottom(c) {
    const fill = rgb(c.color);
    const edge = rgb(c.borderColor);
    const bw = c.borderWidth;
    const cx = c.x + c.w / 2;
    expectColor('fill', cx, c.y + c.h / 2, fill);
    expectColor('bottom band', cx, c.y + c.h + bw / 2, edge);
    expectColor('below the band', cx, c.y + c.h + bw + 10, bg);
    expectColor('no top border', cx, c.y - 8, bg);
    expectColor('no left border', c.x - 8, c.y + c.h / 2, bg);
    expectColor('no right border', c.x + c.w + 8, c.y + c.h / 2, bg);
    const band = runLength([cx, c.y + c.h - 20], [0, 1], bw + 40, edge, [
      bg,
      edge,
      fill,
    ]);
    if (Math.abs(band - bw) > 3)
      failures.push(`bottom border is ${band} px thick, want ${bw} +-3`);
  },
  roundedGradient(c) {
    const r = c.radius;
    const outside = r - (r + 11) * Math.SQRT1_2;
    expectOutside(
      'top-left outside the radius',
      c.x + outside,
      c.y + outside,
      rgb(c.colorTop),
      RAMP,
    );
    expectOutside(
      'bottom-right outside the radius',
      c.x + c.w - 1 - outside,
      c.y + c.h - 1 - outside,
      rgb(c.colorBottom),
      RAMP,
    );
    const cx = c.x + c.w / 2;
    expectRamp(
      'top to bottom',
      [cx, c.y],
      [cx, c.y + c.h],
      [c.colorTop, c.colorBottom],
    );
  },
  linear0(c) {
    const cx = c.x + c.w / 2;
    expectRamp('top to bottom', [cx, c.y], [cx, c.y + c.h], c.colors, c.stops);
  },
  linear90(c) {
    const cy = c.y + c.h / 2;
    expectRamp('right to left', [c.x + c.w, cy], [c.x, cy], c.colors, c.stops);
  },
  linear45(c) {
    if (assetsTier) {
      // No slanted ramp without the Effect node: the nearer axis, reported.
      expectGap(/angle snaps to an axis/);
      const cx = c.x + c.w / 2;
      expectRamp(
        'top to bottom (snapped)',
        [cx, c.y],
        [cx, c.y + c.h],
        c.colors,
        c.stops,
      );
      return;
    }
    expectRamp(
      'top-right to bottom-left',
      [c.x + c.w, c.y],
      [c.x, c.y + c.h],
      c.colors,
      c.stops,
    );
    // Constant across the axis: the other diagonal is the midpoint colour.
    const mid = gradientAt(c.colors, c.stops, 0.5);
    expectColor(
      'across the axis, near top-left',
      c.x + c.w * 0.2,
      c.y + c.h * 0.2,
      mid,
      RAMP,
    );
    expectColor(
      'across the axis, near bottom-right',
      c.x + c.w * 0.8,
      c.y + c.h * 0.8,
      mid,
      RAMP,
    );
  },
  linear3(c) {
    const cx = c.x + c.w / 2;
    expectRamp(
      'top to bottom',
      [cx, c.y],
      [cx, c.y + c.h],
      c.colors,
      c.stops,
      [0.06, 0.25, 0.4, 0.625, 0.94],
    );
  },
  linear4(c) {
    const cy = c.y + c.h / 2;
    expectRamp('right to left', [c.x + c.w, cy], [c.x, cy], c.colors, c.stops, [
      0.05,
      1 / 3,
      0.5,
      2 / 3,
      0.95,
    ]);
  },
  radial(c) {
    const cx = c.x + c.w * c.pivot[0];
    const cy = c.y + c.h * c.pivot[1];
    expectRamp(
      'centre to the right',
      [cx, cy],
      [cx + c.radiusW, cy],
      c.colors,
      c.stops,
    );
    expectRamp(
      'centre to the top',
      [cx, cy],
      [cx, cy - c.radiusH],
      c.colors,
      c.stops,
    );
    // Past the radius the last colour holds.
    expectColor('corner', c.x + 8, c.y + 8, rgb(c.colors[1]), RAMP);
  },
  topBottom(c) {
    const cx = c.x + c.w / 2;
    expectRamp(
      'top to bottom',
      [cx, c.y],
      [cx, c.y + c.h],
      [c.colorTop, c.colorBottom],
    );
    expectRamp(
      'top to bottom, left side',
      [c.x + 12, c.y],
      [c.x + 12, c.y + c.h],
      [c.colorTop, c.colorBottom],
    );
  },
  leftRight(c) {
    const cy = c.y + c.h / 2;
    expectRamp(
      'left to right',
      [c.x, cy],
      [c.x + c.w, cy],
      [c.colorLeft, c.colorRight],
    );
    expectRamp(
      'left to right, top side',
      [c.x, c.y + 12],
      [c.x + c.w, c.y + 12],
      [c.colorLeft, c.colorRight],
    );
  },
  corners(c) {
    const at = (u, v) =>
      mix(
        mix(rgb(c.colorTl), rgb(c.colorTr), u),
        mix(rgb(c.colorBl), rgb(c.colorBr), u),
        v,
      );
    for (const [name, u, v] of [
      ['top-left', 0.08, 0.08],
      ['top-right', 0.92, 0.08],
      ['bottom-left', 0.08, 0.92],
      ['bottom-right', 0.92, 0.92],
      ['centre', 0.5, 0.5],
      ['left edge', 0.08, 0.5],
      ['top edge', 0.5, 0.08],
    ]) {
      expectColor(name, c.x + c.w * u, c.y + c.h * v, at(u, v), 26);
    }
  },
  shadow(c) {
    const panel = rgb(PANEL);
    const shade = rgb(c.shadowColor);
    const cx = c.x + c.w / 2;
    expectColor('node', cx, c.y + c.h / 2, rgb(c.color));
    expectColor('panel above the node', cx, c.y - 8, panel);
    // Below the node: the shadow box's edge is shadowY below the node's, and
    // its alpha runs 1 -> 0 from blur inside that edge to blur outside it.
    const blur = c.shadowBlur;
    const alphaAt = (d) => {
      const t = Math.max(0, Math.min(1, (d - c.shadowY + blur) / (2 * blur)));
      return 1 - t * t * (3 - 2 * t);
    };
    const below = [4, 14, 24, 34, 46];
    const got = below.map((d) => sample(image, cx, c.y + c.h + d));
    below.forEach((d, i) => {
      const want = mix(panel, shade, alphaAt(d));
      if (worst(got[i], want) > 40)
        failures.push(
          `shadow ${d} px below the node: got ${show(got[i])}, want ${show(want)} +-40`,
        );
    });
    for (let i = 1; i < got.length; i++) {
      if (got[i][1] < got[i - 1][1] - 6)
        failures.push(
          `shadow does not fall off below the node: ${got.map((p) => Math.round(p[1])).join(' ')}`,
        );
    }
    if (got[got.length - 1][1] - got[0][1] < 120)
      failures.push(
        `no shadow below the node: ${got.map((p) => Math.round(p[1])).join(' ')}`,
      );
  },
  clip(c) {
    const child = rgb(c.child.color);
    expectColor('parent', c.x + 40, c.y + 30, rgb(c.color));
    expectColor(
      'child inside the parent',
      c.x + c.child.x + 40,
      c.y + c.child.y + 30,
      child,
    );
    expectColor(
      'child cut on the right',
      c.x + c.w + 30,
      c.y + c.child.y + 30,
      bg,
    );
    expectColor(
      'child cut at the bottom',
      c.x + c.child.x + 40,
      c.y + c.h + 30,
      bg,
    );
  },
  textOverGradient(c) {
    expectRamp(
      'gradient beside the text',
      [c.x + 10, c.y],
      [c.x + 10, c.y + c.h],
      c.colors,
      c.stops,
    );
    // The white glyph pixels: centred in the box (textAlign center in a
    // contain="width" box), and all of them inside it.
    let left = Infinity;
    let right = -Infinity;
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x - 20; x < c.x + c.w + 20; x++) {
        if (Math.min(...sample(image, x, y, 0)) < 190) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    if (right < 0) failures.push('no white text over the gradient');
    else {
      const centre = (left + right + 1) / 2;
      if (Math.abs(centre - (c.x + c.w / 2)) > 3)
        failures.push(
          `text is centred on ${centre}, want ${c.x + c.w / 2} +-3 (ink ${left}..${right})`,
        );
      if (left < c.x || right >= c.x + c.w)
        failures.push(
          `text ink ${left}..${right} leaves the box ${c.x}..${c.x + c.w - 1}`,
        );
    }
  },
};

for (const name of Object.keys(C)) {
  if (!probes[name]) throw new Error('No probe for case ' + name);
}
let failed = 0;
failures = [];
expectColor('background', 20, 20, bg);
if (failures.length) console.log('FAIL background: ' + failures.join('; '));
for (const [name, probe] of Object.entries(probes)) {
  failures = [];
  const threw = notes.find((note) =>
    note.startsWith(`VISUAL CASE ${name} threw`),
  );
  if (threw) failures.push(threw.slice(`VISUAL CASE ${name} `.length));
  probe(C[name]);
  if (failures.length) {
    failed++;
    console.log(`FAIL ${name}\n  ` + failures.join('\n  '));
  } else console.log(`PASS ${name}`);
}
const total = Object.keys(probes).length;
console.log(
  `VISUAL DONE tier=${assetsTier ? 'assets' : 'device'} passed=${total - failed} failed=${failed}`,
);
process.exit(failed ? 1 : 0);
