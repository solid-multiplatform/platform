// Builds the text test app, installs it on the Roku named by ROKU_DEV_IP,
// takes a screenshot and checks the ink on screen and what the app reports
// against what the platform's text props mean: alignment in a contained
// box, wrapping, maxLines and the suffix, letter spacing, line height,
// vertical alignment, a flex row laid out from a text's width, the fonts
// that load and the one that cannot, and that nothing is scheduled once the
// text has settled. Expected sizes come from the font files themselves, read
// here with the same build-time reader the Roku preset uses, and are also
// compared with the device's own getFontMeasure(). Exits non-zero on a
// failed probe. This replaces whatever is in the device's developer slot.
// The app that was on screen before is brought back afterwards.
//
//   node tests/roku-device/run-text.mjs [--out results/text] [--keep]
//
// `--out` writes <out>.jpg (or .png) and <out>.txt.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeApp,
  deviceInfo,
  launch,
  readConsole,
  rokuDevice,
  screenshot,
  sideload,
} from '../../cli/roku-device.mjs';
import { decodeImage, imageKind, pixel } from './image.mjs';
import {
  GAP,
  MEASURED_SIZES,
  MEASURED_STRINGS,
  MISSING,
  MISSING_FILE,
  ROWS,
  TEXTS,
  UNREGISTERED,
} from './text-cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-text');
const zip = path.join(out, 'text.zip');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const device = rokuDevice();

const output = [];
const say = (line) => {
  output.push(line);
  console.log(line);
};

const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
say(`Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`);

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
    'text.roku-config.ts',
  ],
  { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] },
);
if (!existsSync(path.join(out, 'pkg-dir/manifest')))
  throw new Error('The Roku build produced no package directory.');
// One registered font's file is taken out of the package: it cannot load.
rmSync(path.join(out, 'pkg-dir', MISSING_FILE));
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
const notes = [];
let fresh = false;
let done = false;
let shooting;
const reading = readConsole(
  device,
  (line) => {
    // On connecting, the console replays what the last app printed.
    if (!fresh) return false;
    const at = line.search(/TEXT |ROKU_[A-Z_]+ /);
    if (at === -1) return false;
    const text = line.slice(at);
    if (text.startsWith('TEXT START')) notes.length = 0;
    notes.push(text);
    // The screen is final at READY; the app then measures fonts off screen.
    if (text.startsWith('TEXT READY') && !shooting)
      shooting = screenshot(device).catch((error) => error);
    done = text.startsWith('TEXT DONE') || text.startsWith('TEXT ERROR');
    return done;
  },
  150_000,
);
let shot;
try {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  fresh = true;
  await sideload(device, zip);
  await reading.done;
  shot = await shooting;
} finally {
  reading.stop();
  if (!args.includes('--keep') && previous && previous !== 'dev')
    await launch(device, previous).catch(() => {});
}

for (const note of notes)
  if (!/^TEXT (NODE|MARK|DEVICE) /.test(note)) say(note);
if (!Buffer.isBuffer(shot)) {
  console.error(
    'The app never reported TEXT READY, or no screenshot was returned: ' +
      String(shot ?? ''),
  );
  process.exit(2);
}
const target = flag('--out');
if (target) {
  mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  writeFileSync(target + '.' + imageKind(shot), shot);
  say('Screenshot: ' + target + '.' + imageKind(shot));
}

// ---- what the app reported ------------------------------------------------------

const reported = {};
const marks = {};
const measured = [];
for (const note of notes) {
  let found = /^TEXT NODE (\w+) (.*)$/.exec(note);
  if (found) reported[found[1]] = JSON.parse(found[2]);
  found = /^TEXT MARK (\w+) (.*)$/.exec(note);
  if (found) marks[found[1]] = Number(found[2]);
  found = /^TEXT DEVICE (\w+) (\d+) (\d+) (\d+) (.*)$/.exec(note);
  if (found)
    measured.push({
      font: found[1],
      size: +found[2],
      ascent: +found[3],
      lineHeight: +found[4],
      widths: found[5].split(',').map(Number),
    });
}

// ---- the fonts, read as the build reads them ----------------------------------------

const installed = path.dirname(
  createRequire(path.join(project, 'package.json')).resolve(
    '@solid-multiplatform/renderer/roku',
  ),
);
const { parseFont, packFontMetrics } = await import(
  pathToFileURL(path.join(installed, 'font-file.js')).href
);
const { FontMetrics } = await import(
  pathToFileURL(path.join(installed, 'font-metrics.js')).href
);
const table = (file) =>
  FontMetrics.decode(
    packFontMetrics(parseFont(new Uint8Array(readFileSync(file)))),
  );
const FONTS = {
  regular: table(path.join(here, 'fonts/Roboto-Regular.ttf')),
  bold: table(path.join(here, 'fonts/Roboto-Bold.ttf')),
  raleway: table(path.join(here, 'fonts/Raleway-ExtraBold.ttf')),
};
/** The font a case's props name, at its size. */
function fontOf(props) {
  const metrics =
    props.fontFamily === 'Raleway'
      ? FONTS.raleway
      : props.fontWeight >= 600
        ? FONTS.bold
        : FONTS.regular;
  return metrics.at(props.fontSize);
}
/** The first baseline below a text's top and the line height, as the scene lays text out. */
function lineBox(props) {
  const m = fontOf(props).metrics;
  const bare = m.ascender - m.descender + m.lineGap;
  const lineHeight =
    props.lineHeight === undefined
      ? 1.2 * bare
      : props.lineHeight <= 3
        ? props.lineHeight * bare
        : props.lineHeight;
  return {
    lineHeight,
    baseline: (lineHeight + (m.capHeight + m.xHeight) / 2) / 2,
  };
}

// ---- the ink ------------------------------------------------------------------------

const image = decodeImage(shot);
if (image.width !== 1920 || image.height !== 1080)
  throw new Error(
    `Expected a 1920x1080 screenshot, got ${image.width}x${image.height}.`,
  );
// Text is white, marks are red, the screen is black: green tells text from both.
const isInk = (x, y) => pixel(image, x, y)[1] > 100;
const isMark = (x, y) => {
  const [r, g, b] = pixel(image, x, y);
  return r > 130 && g < 90 && b < 90;
};

/** The ink in a rectangle: its bounds, and the same per run of rows that hold ink (the lines). */
function ink(x0, y0, w, h) {
  const rows = [];
  let run = null;
  for (let y = Math.round(y0); y < y0 + h; y++) {
    let l = Infinity;
    let r = -Infinity;
    for (let x = Math.round(x0); x < x0 + w; x++) {
      if (!isInk(x, y)) continue;
      if (x < l) l = x;
      if (x > r) r = x;
    }
    if (r >= 0) {
      if (!run) rows.push((run = { t: y, b: y, l, r }));
      run.b = y;
      run.l = Math.min(run.l, l);
      run.r = Math.max(run.r, r);
    } else run = null;
  }
  if (rows.length === 0) return null;
  return {
    l: Math.min(...rows.map((row) => row.l)),
    r: Math.max(...rows.map((row) => row.r)),
    t: rows[0].t,
    b: rows[rows.length - 1].b,
    rows,
  };
}

// ---- probes ---------------------------------------------------------------------------

let failures = [];
const fail = (text) => failures.push(text);
const near = (what, got, want, tolerance) => {
  if (!(Math.abs(got - want) <= tolerance))
    fail(
      `${what}: got ${Number(got).toFixed(1)}, want ${Number(want).toFixed(1)} +-${tolerance}`,
    );
};
const within = (what, got, low, high) => {
  if (!(got >= low && got <= high))
    fail(
      `${what}: got ${Number(got).toFixed(1)}, want ${low.toFixed(1)}..${high.toFixed(1)}`,
    );
};
/** Ink width against a measured width: 2% of it, or 2 px. The ink is narrower by the side bearings of its end glyphs. */
const widthTolerance = (width) => Math.max(2, width * 0.02);
const facts = [];
const fact = (text) => facts.push(text);

/** The app's report for a text, or a failure. */
function node(name) {
  const found = reported[name];
  if (!found) fail('the app reported nothing for ' + name);
  return found ?? { x: 0, y: 0, width: 0, height: 0, w: 0, h: 0, lines: [] };
}
/** The ink of a text: its box when contained, else its reported size, with a margin. */
function inkOf(name, c, widthHint, heightHint) {
  const w = c.props.width ?? widthHint ?? 600;
  const h = c.props.height ?? heightHint ?? lineBox(c.props).lineHeight;
  const found = ink(c.x - 14, c.y - 10, w + 28, h + 24);
  if (!found) fail('no ink for ' + name);
  return found;
}

function aligned(name, side) {
  const c = TEXTS[name];
  const found = inkOf(name, c);
  if (!found) return;
  const box = c.props.width;
  const lineWidth = fontOf(c.props).measure(c.text, 0);
  fact(
    `${name}: ink ${found.l}..${found.r} in box ${c.x}..${c.x + box}, measured width ${lineWidth}`,
  );
  // The ink sits inside the line by the side bearings of its end glyphs (a few px).
  if (side === 'left') within('ink left edge', found.l, c.x, c.x + 6);
  else if (side === 'right')
    within('ink right edge', found.r, c.x + box - 7, c.x + box);
  else near('ink centre', (found.l + found.r + 1) / 2, c.x + box / 2, 3);
  near(
    'ink width against the measured line',
    found.r - found.l + 1,
    lineWidth,
    widthTolerance(lineWidth) + 6,
  );
  near('reported box width', node(name).width, box, 0.01);
  near('reported line width', node(name).w, lineWidth, 0.01);
}

/** Words onto lines, each the longest that fits: what word wrap means for words that all fit. */
function greedy(text, font, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && font.measure(next, 0) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

/** Each reported line has a row of ink of its measured width. */
function linesMatchInk(name, c, lines) {
  const font = fontOf(c.props);
  const found = inkOf(
    name,
    c,
    undefined,
    Math.max(1, lines.length) * lineBox(c.props).lineHeight,
  );
  if (!found) return;
  if (found.rows.length !== lines.length) {
    fail(
      `${found.rows.length} lines of ink for ${lines.length} reported lines`,
    );
    return;
  }
  lines.forEach((text, i) => {
    const width = font.measure(text, 0);
    if (width > c.props.width + 0.01)
      fail(
        `line ${i + 1} "${text}" measures ${width}, wider than its box ${c.props.width}`,
      );
    near(
      `ink width of line ${i + 1} "${text}"`,
      found.rows[i].r - found.rows[i].l + 1,
      width,
      widthTolerance(width) + 6,
    );
  });
}

const probes = {
  alignLeft: () => aligned('alignLeft', 'left'),
  alignCenter: () => aligned('alignCenter', 'center'),
  alignRight: () => aligned('alignRight', 'right'),

  wrap() {
    const c = TEXTS.wrap;
    const want = greedy(c.text, fontOf(c.props), c.props.width);
    const got = node('wrap').lines;
    if (got.join('|') !== want.join('|'))
      fail(`lines are ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    linesMatchInk('wrap', c, got);
    near(
      'reported height',
      node('wrap').height,
      want.length * lineBox(c.props).lineHeight,
      0.01,
    );
    fact(`wrap: ${got.length} lines, ${JSON.stringify(got)}`);
  },
  maxLines() {
    const c = TEXTS.maxLines;
    const font = fontOf(c.props);
    const all = greedy(c.text, font, c.props.width);
    const got = node('maxLines').lines;
    if (got.length !== 2) return fail(`${got.length} lines, want 2`);
    if (got[0] !== all[0]) fail(`first line is "${got[0]}", want "${all[0]}"`);
    // The last line allowed keeps its words and ends with the suffix, losing
    // only the characters that must go for the suffix to fit.
    let last = all[1];
    while (last.length > 0 && font.measure(last + '...', 0) > c.props.width)
      last = last.slice(0, -1);
    if (got[1] !== last + '...')
      fail(`last line is "${got[1]}", want "${last}..."`);
    linesMatchInk('maxLines', c, got);
    fact(`maxLines: ${JSON.stringify(got)}`);
  },
  suffix() {
    const c = TEXTS.suffix;
    const got = node('suffix').lines;
    if (got.length !== 1) return fail(`${got.length} lines, want 1`);
    if (!got[0].endsWith(c.props.overflowSuffix))
      fail(`"${got[0]}" does not end with "${c.props.overflowSuffix}"`);
    if (!c.text.startsWith(got[0].slice(0, -c.props.overflowSuffix.length)))
      fail(`"${got[0]}" is not the start of the text`);
    linesMatchInk('suffix', c, got);
    fact(`suffix: ${JSON.stringify(got)}`);
  },
  longWord() {
    const c = TEXTS.longWord;
    const font = fontOf(c.props);
    const got = node('longWord').lines;
    // The word is wider than the line: it is cut where the line is full, and
    // what follows starts the next line.
    const word = c.text.split(' ')[0];
    let head = word;
    while (font.measure(head, 0) > c.props.width) head = head.slice(0, -1);
    if (got[0] !== head) fail(`first line is "${got[0]}", want "${head}"`);
    if (got.join('').replace(/ /g, '') !== c.text.replace(/ /g, ''))
      fail(`lines ${JSON.stringify(got)} do not add up to the text`);
    linesMatchInk('longWord', c, got);
    fact(`longWord: ${JSON.stringify(got)}`);
  },

  letterSpacing() {
    const plain = inkOf('plain', TEXTS.plain, 370);
    const spaced = inkOf('spaced', TEXTS.spaced, 520);
    const gaps = TEXTS.spaced.text.length - 1;
    const want = gaps * TEXTS.spaced.props.letterSpacing;
    near(
      'reported widening',
      node('spaced').w - node('plain').w,
      want - kerningOf(TEXTS.plain),
      0.01,
    );
    if (plain && spaced) {
      const widening = spaced.r - spaced.l - (plain.r - plain.l);
      near('ink widening', widening, want - kerningOf(TEXTS.plain), 3);
      fact(
        `letterSpacing ${TEXTS.spaced.props.letterSpacing}: ink ${plain.r - plain.l + 1} -> ${spaced.r - spaced.l + 1} px (${gaps} gaps), reported ${node('plain').w} -> ${node('spaced').w}`,
      );
    }
    const c = TEXTS.spacedCenter;
    const centred = inkOf('spacedCenter', c);
    if (centred)
      near(
        'centred letter-spaced ink',
        (centred.l + centred.r + 1) / 2,
        c.x + c.props.width / 2,
        3,
      );
  },

  linePixels: () => lineHeight('linePixels'),
  lineMultiple: () => lineHeight('lineMultiple'),
  lineDefault: () => lineHeight('lineDefault'),
  lineRight() {
    const c = TEXTS.lineRight;
    const found = inkOf(
      'lineRight',
      c,
      undefined,
      3 * lineBox(c.props).lineHeight,
    );
    if (!found) return;
    if (found.rows.length !== 3)
      return fail(`${found.rows.length} lines of ink, want 3`);
    found.rows.forEach((row, i) =>
      within(
        `right edge of line ${i + 1}`,
        row.r,
        c.x + c.props.width - 7,
        c.x + c.props.width,
      ),
    );
  },

  measuredWidths() {
    for (const name of [
      'widthRegular',
      'widthBold',
      'widthLigatures',
      'widthSmall',
      'widthNearest',
      'widthLarge',
    ]) {
      const c = TEXTS[name];
      const seen = node(name).w;
      const model = fontOf(c.props).measure(c.text, 0);
      const found = inkOf(name, c, seen || model);
      if (!found) continue;
      const width = found.r - found.l + 1;
      near(
        `${name}: width the platform reads against the ink`,
        seen,
        width,
        widthTolerance(width),
      );
      near(
        `${name}: width the platform reads against the font's table`,
        seen,
        model,
        0.01,
      );
      fact(
        `${name}: platform ${seen}, table ${model}, ink ${width} px (${(((seen - width) / width) * 100).toFixed(2)}%)`,
      );
    }
  },

  verticalTop: () => vertical('top', () => 0),
  verticalMiddle: () => vertical('middle', (slack) => slack / 2),
  verticalBottom: () => vertical('bottom', (slack) => slack),

  flexRegistered() {
    const c = ROWS.flexRegistered;
    const width = fontOf(c.props).measure(c.text, 0);
    near('reported text width', node('flexRegistered').w, width, 0.01);
    flexRow('flexRegistered', width);
  },
  flexUnregistered() {
    const width = node('flexUnregistered').w;
    if (!(width > 50)) fail(`the system-font text reads a width of ${width}`);
    flexRow('flexUnregistered', width);
    const warnings = notes.filter(
      (note) =>
        note.startsWith('ROKU_FONT') && note.includes(`"${UNREGISTERED}"`),
    );
    if (warnings.length !== 1)
      fail(`${warnings.length} warnings name the unregistered family, want 1`);
  },
  flexMissing() {
    const width = node('flexMissing').w;
    if (!(width > 50))
      fail(`the text of the font that cannot load reads a width of ${width}`);
    flexRow('flexMissing', width);
  },

  fontsLoad() {
    for (const family of ['Roboto', 'Roboto700', 'Raleway']) {
      const line = notes.find((note) =>
        note.startsWith(`TEXT FONT ${family} `),
      );
      const took = /loaded (\d+)/.exec(line ?? '');
      if (!took) fail(`${family} did not load: ${line ?? 'no report'}`);
      else fact(`${family} loaded after ${took[1]} ms`);
    }
  },
  missingFontSettles() {
    const line = notes.find((note) => note.startsWith(`TEXT FONT ${MISSING} `));
    const took = /rejected (\d+)/.exec(line ?? '');
    if (!took)
      fail(
        `the load of the missing file did not reject: ${line ?? 'no report'}`,
      );
    else {
      within('time to reject', +took[1], 500, 3500);
      fact(`missing file: ${line.slice(5)}`);
    }
  },
  idle() {
    const line = notes.find((note) => note.startsWith('TEXT IDLE '));
    const timers = /timers=(\d+)/.exec(line ?? '');
    if (!timers) fail('no idle report');
    else if (+timers[1] !== 0)
      fail(`${timers[1]} timers were armed in 2 s with the text settled`);
  },
  deviceMeasure() {
    let worst = 0;
    let worstCase = '';
    let total = 0;
    let exact = 0;
    let count = 0;
    for (const font of ['regular', 'bold', 'raleway']) {
      for (const size of MEASURED_SIZES) {
        const got = measured.find((m) => m.font === font && m.size === size);
        if (!got) {
          fail(`no device measurement for ${font} at ${size}`);
          continue;
        }
        const sized = FONTS[font].at(size);
        if (
          got.ascent !== sized.labelAscent ||
          got.lineHeight !== sized.labelLineHeight
        )
          fail(
            `${font} ${size}: device ascent ${got.ascent} and line height ${got.lineHeight}, table ${sized.labelAscent} and ${sized.labelLineHeight}`,
          );
        MEASURED_STRINGS.forEach((text, i) => {
          const model = sized.measure(text, 0);
          const error = Math.abs(model - got.widths[i]);
          count++;
          total += error;
          if (error === 0) exact++;
          if (error > worst) {
            worst = error;
            worstCase = `${font} ${size} "${text}": device ${got.widths[i]}, table ${model}`;
          }
          if (error > Math.max(2, got.widths[i] * 0.02))
            fail(
              `${font} ${size} "${text}": device ${got.widths[i]}, table ${model}`,
            );
        });
      }
    }
    if (count)
      fact(
        `build-time widths against getFontMeasure(): ${exact}/${count} exact, mean error ${(total / count).toFixed(3)} px, worst ${worst} px${worst ? ' (' + worstCase + ')' : ''}`,
      );
  },
};

/** Kerning is not applied to letter-spaced text: the pixels the plain text's pairs took. */
function kerningOf(c) {
  const font = fontOf(c.props);
  let alone = 0;
  for (const glyph of c.text) alone += font.measure(glyph, 0);
  return font.measure(c.text, 0) - alone;
}

function lineHeight(name) {
  const c = TEXTS[name];
  const box = lineBox(c.props);
  const found = inkOf(name, c, 300, 3 * box.lineHeight);
  near('reported height', node(name).h, 3 * box.lineHeight, 0.01);
  if (!found) return;
  if (found.rows.length !== 3)
    return fail(`${found.rows.length} lines of ink, want 3`);
  // No descenders in these lines: each row of ink ends on its baseline.
  found.rows.forEach((row, i) =>
    near(
      `baseline of line ${i + 1}`,
      row.b + 1,
      c.y + box.baseline + i * box.lineHeight,
      2,
    ),
  );
  fact(
    `${name}: line height ${box.lineHeight}, baselines at ${found.rows.map((row) => row.b + 1).join(', ')} (want ${[0, 1, 2].map((i) => (c.y + box.baseline + i * box.lineHeight).toFixed(1)).join(', ')})`,
  );
}

function vertical(name, place) {
  const c = TEXTS[name];
  const box = lineBox(c.props);
  const found = inkOf(name, c);
  if (!found) return;
  const want = c.y + place(c.props.height - box.lineHeight) + box.baseline;
  near('baseline', found.b + 1, want, 2);
  near('reported box height', node(name).height, c.props.height, 0.01);
  fact(`${name}: baseline at ${found.b + 1}, want ${want.toFixed(1)}`);
}

/** The mark sits GAP after the width the layout saw, and the ink ends there too. */
function flexRow(name, width) {
  const c = ROWS[name];
  const y = c.y + 20;
  let markX = -1;
  for (let x = c.x; x < c.x + 840 && markX < 0; x++)
    if (isMark(x, y) && isMark(x + 3, y)) markX = x;
  if (markX < 0) return fail('no mark on screen');
  near('mark on screen', markX, c.x + width + GAP, 1.5);
  near('mark as the platform placed it', marks[name], c.x + width + GAP, 0.51);
  const found = ink(c.x - 10, c.y - 10, markX - c.x, 70);
  if (!found) return fail('no ink');
  within('ink right edge', found.r, markX - GAP - 9, markX - GAP);
  fact(
    `${name}: text width ${width}, mark at ${markX} (want ${(c.x + width + GAP).toFixed(1)}), ink ends at ${found.r}`,
  );
}

let failed = 0;
for (const [name, probe] of Object.entries(probes)) {
  failures = [];
  try {
    probe();
  } catch (error) {
    fail(
      'the probe threw: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (failures.length) {
    failed++;
    say(`FAIL ${name}\n  ` + failures.join('\n  '));
  } else say(`PASS ${name}`);
}
for (const line of facts) say('  ' + line);
const total = Object.keys(probes).length;
say(`TEXT RESULT passed=${total - failed} failed=${failed}`);
// The results file also keeps what the app reported and what the device measured.
if (target)
  writeFileSync(
    target + '.txt',
    output
      .concat(notes.filter((note) => /^TEXT (NODE|MARK|DEVICE) /.test(note)))
      .join('\n') + '\n',
  );
process.exit(failed ? 1 : 0);
