// Measurements, not a test: binary size, start-up from source and from
// bytecode, and the cost of a frame of the shared fixture.
//
//   SDL_VIDEODRIVER=x11 LIBGL_ALWAYS_SOFTWARE=1 \
//     xvfb-run -a -s "-screen 0 1280x720x24" node tests/measure.mjs
//
// On a virtual display the GL driver is a software rasterizer, so frame
// intervals say nothing about a GPU; the times of the runtime's own work do.
import path from 'node:path';
import { cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../cli/bundle.mjs';

const RUNS = 15;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(path.join(tmpdir(), 'solid-desktop-measure-'));
cpSync(
  path.resolve(here, '../../platform/tests/webgl/fonts'),
  path.join(out, 'fonts'),
  { recursive: true },
);
const kb = (file) => (statSync(file).size / 1024).toFixed(0) + ' KB';
const median = (values) =>
  values.slice().sort((a, b) => a - b)[values.length >> 1];
const ms = (value) => value.toFixed(1).padStart(6) + ' ms';

/** Run a script; its wall-clock time and the JSON it printed, if any. */
function run(script) {
  const start = process.hrtime.bigint();
  const result = spawnSync(defaultRuntime, [script], { encoding: 'utf8' });
  const wall = Number(process.hrtime.bigint() - start) / 1e6;
  if (result.status !== 0) {
    throw new Error(`${script} exited with ${result.status}\n${result.stderr}`);
  }
  const line = result.stdout.split('\n').find((l) => l.startsWith('MEASURE '));
  return { wall, data: line && JSON.parse(line.slice(8)) };
}

async function build(entry, minify) {
  const outfile = path.join(out, entry + (minify ? '.min.js' : '.js'));
  const bytecode = await bundle({
    entry: path.join(here, 'measure', entry + '.ts'),
    outfile,
    minify,
    bytecode: true,
  });
  return { source: outfile, bytecode };
}

console.log(
  `runtime: ${(statSync(defaultRuntime).size / 1048576).toFixed(2)} MB`,
);

const up = [];
for (let i = 0; i < RUNS; i++) {
  up.push(run(path.join(here, 'measure/up.js')).data.up);
}
console.log(
  `\nstart-up, median of ${RUNS} runs, in ms from the start of main():`,
);
console.log(
  `  the runtime alone (window, GL context, engine): ${ms(median(up)).trim()}`,
);
console.log(
  '  ' +
    [
      'bundle',
      'size',
      'script ran',
      'first frame',
      'with text',
      'spawn to exit*',
    ]
      .map((heading, i) =>
        i === 0 ? heading.padEnd(18) : heading.padStart(15),
      )
      .join(''),
);
for (const minify of [false, true]) {
  const timed = await build('startup', minify);
  const exits = await build('start', minify);
  for (const kind of ['source', 'bytecode']) {
    const samples = [];
    const walls = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(run(timed[kind]).data);
      walls.push(run(exits[kind]).wall);
    }
    const of = (key) => ms(median(samples.map((s) => s[key]))).padStart(15);
    console.log(
      '  ' +
        (kind + (minify ? ', minified' : '')).padEnd(18) +
        kb(timed[kind]).padStart(15) +
        of('mounted') +
        of('firstFrame') +
        of('complete') +
        ms(median(walls)).padStart(15),
    );
  }
}
console.log('  * the whole process, exiting once its first frame is presented');

const frames = run((await build('frames', false)).bytecode).data;
console.log(
  `\nframe of the fixture, ${frames.count} redraws on ${frames.driver}:`,
);
console.log(
  `  JavaScript and GL calls: median ${frames.median.toFixed(3)} ms, ` +
    `95th percentile ${frames.p95.toFixed(3)} ms, worst ${frames.worst.toFixed(3)} ms`,
);
console.log(
  `  frame to frame, with rasterizing and presenting: ${frames.interval.toFixed(2)} ms`,
);

const calls = spawnSync(
  defaultRuntime,
  [path.join(here, 'measure/gl-calls.js')],
  {
    encoding: 'utf8',
  },
).stdout.trim();
console.log(`\nbinding, per call: ${calls}`);
rmSync(out, { recursive: true });
