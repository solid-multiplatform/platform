// Analyses a Roku Perfetto trace recorded by run-pacing.mjs.
//
// This is the real source, not the JavaScript-thread proxy. The firmware emits
// `render` and `swapBuffers` slices on `RenderThr:Main`; one frame's occupied
// time is the pair's sum, and the budget is 16.67 ms (rsg-sdk documentation,
// runtime-and-debugging/perfetto-profiling.md). The trace is read with
// trace_processor_shell, which the runner finds or downloads.
//
// The trace itself is not committed and may contain device identifiers. This
// module only returns numbers, slice names and thread names.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REFRESH_MS = 1000 / 60;
export const BUDGET_MS = REFRESH_MS;

const round3 = (value) => Math.round(value * 1000) / 1000;
const round2 = (value) => Math.round(value * 100) / 100;

/** Nearest-rank percentile of an ascending array. */
export function percentile(ascending, fraction) {
  if (ascending.length === 0) return NaN;
  const rank = Math.ceil(fraction * ascending.length);
  return ascending[Math.min(ascending.length - 1, Math.max(0, rank - 1))];
}

/** Statistics for a list of per-frame durations in milliseconds. */
export function summarizeFrames(durationsMs, budgetMs = BUDGET_MS) {
  const ascending = [...durationsMs].sort((a, b) => a - b);
  const sum = ascending.reduce((total, value) => total + value, 0);
  return {
    frames: ascending.length,
    meanMs: ascending.length ? round3(sum / ascending.length) : NaN,
    p50Ms: round3(percentile(ascending, 0.5)),
    p95Ms: round3(percentile(ascending, 0.95)),
    p99Ms: round3(percentile(ascending, 0.99)),
    worstMs: ascending.length ? round3(ascending[ascending.length - 1]) : NaN,
    overBudget: ascending.filter((value) => value > budgetMs).length,
    overBudgetPct: ascending.length
      ? round2(
          (ascending.filter((value) => value > budgetMs).length /
            ascending.length) *
            100,
        )
      : 0,
    // A 1 ms tolerance, as the proxy uses, so the two tables are comparable.
    overBudget1ms: ascending.filter((value) => value > budgetMs + 1).length,
    budgetMs: round3(budgetMs),
  };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const parseLine = (line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cell);
        cell = '';
      } else cell += ch;
    }
    cells.push(cell);
    return cells;
  };
  const header = parseLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
  });
}

export function queryTrace(processor, trace, sql) {
  const output = execFileSync(
    processor,
    ['query', '--no-agent', '--format', 'csv', trace, sql],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // trace_processor prints a "Trace loaded" / "Query executed" note to stdout
  // before the CSV; keep the lines from the header onwards.
  const lines = output.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith('"'));
  return parseCsv(at === -1 ? '' : lines.slice(at).join('\n'));
}

/** The version line of a trace processor binary. */
export function processorVersion(processor) {
  const result = spawnSync(processor, ['--version'], { encoding: 'utf8' });
  return (result.stdout || result.stderr || '').split(/\r?\n/)[0] || 'unknown';
}

/**
 * Find trace_processor_shell: an explicit path, TRACE_PROCESSOR, PATH, or the
 * Perfetto prebuilt cache (which is outside the repository).
 */
export function findTraceProcessor(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.TRACE_PROCESSOR) candidates.push(process.env.TRACE_PROCESSOR);
  const onPath = spawnSync('which', ['trace_processor_shell'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0 && onPath.stdout.trim())
    candidates.push(onPath.stdout.trim());
  for (const root of [
    path.join(os.homedir(), '.local/share/perfetto/prebuilts'),
    path.join(os.homedir(), '.cache/smp-perfetto/bin'),
  ]) {
    try {
      for (const name of readdirSync(root).sort()) {
        if (!name.startsWith('trace_processor_shell')) continue;
        candidates.push(path.join(root, name));
      }
    } catch {
      // The cache may not exist.
    }
  }
  const seen = new Set();
  let best;
  for (const candidate of candidates) {
    if (seen.has(candidate) || !existsSync(candidate)) continue;
    seen.add(candidate);
    try {
      const version = processorVersion(candidate);
      if (!/Perfetto v\d/.test(version)) continue;
      const stamp = statSync(candidate).mtimeMs;
      if (!best || stamp > best.stamp)
        best = { path: candidate, version, stamp };
    } catch {
      // Not executable: try the next one.
    }
  }
  return best && { path: best.path, version: best.version };
}

const SLICE_SQL = `
SELECT s.ts AS ts, s.dur AS dur, s.name AS name
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
WHERE t.name = 'RenderThr:Main'
  AND s.name IN ('render', 'swapBuffers')
ORDER BY s.ts, s.dur DESC`;

/**
 * Pair each `render` slice with the `swapBuffers` slice that follows it. A
 * frame's occupied time is the pair's sum (the SDK's rule).
 */
export function pairFrames(rows) {
  const frames = [];
  let pendingRender = null;
  for (const row of rows) {
    const duration = Number(row.dur);
    if (!Number.isFinite(duration)) continue;
    if (row.name === 'render') {
      // Two renders without a swap is malformed; keep the later one.
      pendingRender = duration;
    } else if (row.name === 'swapBuffers' && pendingRender !== null) {
      frames.push((pendingRender + duration) / 1e6);
      pendingRender = null;
    }
  }
  return frames;
}

/** The whole real-source analysis for one trace. */
export function analyzePerfetto({ processor, trace, caseName = 'unknown' }) {
  const rows = queryTrace(processor, trace, SLICE_SQL);
  const renderMs = rows
    .filter((row) => row.name === 'render')
    .map((row) => Number(row.dur) / 1e6)
    .filter(Number.isFinite);
  const swapMs = rows
    .filter((row) => row.name === 'swapBuffers')
    .map((row) => Number(row.dur) / 1e6)
    .filter(Number.isFinite);
  const frames = pairFrames(rows);
  const summary = summarizeFrames(frames);

  // Wake/observer work the firmware reports, if present. An explicit `idle`
  // slice is not emitted on this firmware; consumeAllTasks is the wake path.
  let wakes = [];
  try {
    wakes = queryTrace(
      processor,
      trace,
      `SELECT t.name AS thread, s.name AS slice, COUNT(*) AS n
       FROM slice s
       JOIN thread_track tt ON s.track_id = tt.id
       JOIN thread t ON tt.utid = t.utid
       WHERE s.name IN ('consumeAllTasks', 'observer.callback', 'idle')
       GROUP BY t.name, s.name ORDER BY n DESC`,
    );
  } catch {
    // Older firmware traces may not carry these slices.
  }
  const idleNames = rows
    .map((row) => row.name)
    .filter((name) => typeof name === 'string' && /idle/i.test(name));

  const version = processorVersion(processor);
  const bytes = statSync(trace).size;
  const traceSha256 = createHash('sha256')
    .update(readFileSync(trace))
    .digest('hex');
  const processorSha256 = createHash('sha256')
    .update(readFileSync(processor))
    .digest('hex');

  return {
    kind: 'roku-perfetto',
    source: 'Perfetto render + swapBuffers slices on RenderThr:Main',
    case: caseName,
    frames: summary.frames,
    renderSlices: renderMs.length,
    swapBuffersSlices: swapMs.length,
    render: summarizeFrames(renderMs),
    swapBuffers: summarizeFrames(swapMs),
    frameBudget: summary,
    over16_67: summary.overBudget,
    over17_67: summary.overBudget1ms,
    wakeSlices: wakes.map((row) => ({
      thread: row.thread,
      slice: row.slice,
      count: Number(row.n),
    })),
    explicitIdleSlices: idleNames.length,
    idleWakeNote:
      'No explicit `idle` slice was emitted on this firmware; consumeAllTasks is the firmware wake/observer slice. The workload animates for the whole sample, so this is not an idle-scene measurement.',
    traceBytes: bytes,
    traceSha256,
    processorVersion: version,
    processorSha256,
    budgetNote:
      'swapBuffers pads to the frame boundary on this firmware, so the strict >16.67 ms count includes frames sitting on the boundary. >17.67 ms (the same 1 ms tolerance the proxy uses) is the stable comparison; render alone is the SceneGraph work.',
    whatThisMeasures:
      'Render-thread frame occupancy: render + swapBuffers on RenderThr:Main, the SDK frame-budget rule. It does not separate GPU execution from SceneGraph flush/swap time.',
  };
}

/** A readable report for the real-source numbers. */
export function formatPerfettoReport(summary) {
  const f = summary.frameBudget;
  const lines = [];
  lines.push(
    `Roku frame pacing (Perfetto, real) — case ${summary.case}, ${summary.frames} frames`,
  );
  lines.push(
    `render+swap: p50 ${f.p50Ms} ms, p95 ${f.p95Ms} ms, p99 ${f.p99Ms} ms, worst ${f.worstMs} ms, mean ${f.meanMs} ms`,
  );
  lines.push(
    `over 16.67 ms: ${f.overBudget}/${f.frames} (${f.overBudgetPct}%), over 17.67 ms: ${f.overBudget1ms}/${f.frames}`,
  );
  lines.push(
    `render alone: p95 ${summary.render.p95Ms} ms, worst ${summary.render.worstMs} ms; ` +
      `swapBuffers alone: p95 ${summary.swapBuffers.p95Ms} ms, worst ${summary.swapBuffers.worstMs} ms`,
  );
  lines.push(`budget note: ${summary.budgetNote}`);
  lines.push(
    `wake slices: ${summary.wakeSlices.map((w) => `${w.thread}/${w.slice}=${w.count}`).join(', ') || 'none'}; explicit idle slices=${summary.explicitIdleSlices}`,
  );
  lines.push(
    `trace ${summary.traceBytes} bytes sha256=${summary.traceSha256.slice(0, 16)}…; ${summary.processorVersion}`,
  );
  lines.push(`measures: ${summary.whatThisMeasures}`);
  return lines.join('\n');
}

// ---- CLI --------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  if (!file) {
    console.error(
      'Usage: node analyze-roku-perfetto.mjs <trace.perfetto-trace> --processor <trace_processor_shell> [--out <dir>]',
    );
    process.exit(2);
  }
  const found = findTraceProcessor(flag('--processor'));
  if (!found) {
    console.error('No trace_processor_shell found; pass --processor <path>.');
    process.exit(2);
  }
  const summary = analyzePerfetto({
    processor: found.path,
    trace: path.resolve(file),
    caseName: flag('--case') ?? 'unknown',
  });
  const report = formatPerfettoReport(summary);
  const out = flag('--out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, 'perfetto-summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
    writeFileSync(path.join(out, 'perfetto-summary.txt'), report + '\n');
  }
  console.log(report);
  console.log(JSON.stringify(summary));
}
