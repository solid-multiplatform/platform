// Analysis for the Roku frame-pacing proxy produced by run-pacing.mjs.
//
// The samples are JavaScript-thread frame callbacks with timestamps taken on
// the device (performance.now(), Date.now() when the engine has no
// performance.now). They are a proxy: they measure whether the JS thread kept
// its 60 Hz cadence, not whether the SceneGraph render thread presented a
// frame. The real source is the firmware's Perfetto `render` + `swapBuffers`
// slices (see docs/performance.md, "Measure on Roku"); this analyser says so
// in every summary it writes.
//
// Vocabulary follows the Android analyser (analyze-android.py): appFrames,
// misses, cadence60Hz, intervals25To100ms, so the two lanes read alike.

export const REFRESH_HZ = 60;
export const PERIOD_MS = 1000 / REFRESH_HZ;
export const TOLERANCE_MS = 1;
export const BUDGET_MS = PERIOD_MS + TOLERANCE_MS;

export const WHAT_THIS_DOES_NOT_MEASURE =
  'GPU and compositor timing. The samples are JavaScript-thread frame callbacks; ' +
  'the firmware presents frames on the SceneGraph render thread, which this proxy ' +
  'does not observe. A gap here is a stalled JS thread, not proof of a dropped ' +
  'displayed frame, and a clean series here is not proof that render + swapBuffers ' +
  'stayed inside 16.67 ms. Use a Perfetto trace for render/swapBuffers.';

/** Nearest-rank percentile of an ascending array. */
export function percentile(ascending, fraction) {
  if (ascending.length === 0) return NaN;
  const rank = Math.ceil(fraction * ascending.length);
  const index = Math.min(ascending.length - 1, Math.max(0, rank - 1));
  return ascending[index];
}

const round2 = (value) => Math.round(value * 100) / 100;

/** True when the interval [from, to] overlaps any deliberate JS block. */
function touchesBlock(from, to, blocks) {
  for (const block of blocks) {
    if (to >= block.start && from <= block.end) return true;
  }
  return false;
}

/**
 * Turn timestamped JS frames into frame-pacing statistics.
 *
 * `input` is `{ frames: number[], blocks?: {start,end}[], idle?: number[] }`
 * where `frames` are timestamps in the same unit (milliseconds), relative to
 * the case's start. `blocks` are deliberate JS-block spans on that same clock.
 */
export function analyzePacing(input, options = {}) {
  const periodMs = options.periodMs ?? PERIOD_MS;
  const toleranceMs = options.toleranceMs ?? TOLERANCE_MS;
  const budgetMs = periodMs + toleranceMs;
  const blocks = (input.blocks ?? []).map((block) => ({
    start: Number(block.start),
    end: Number(block.end),
    ms: round2(Number(block.end) - Number(block.start)),
  }));
  // Sort and drop duplicate sample timestamps (the sampler may repeat the
  // boundary frame on a coarse clock).
  const frames = [];
  for (const value of input.frames ?? []) {
    const frame = Number(value);
    if (!Number.isFinite(frame)) continue;
    if (frames.length === 0 || frame !== frames[frames.length - 1])
      frames.push(frame);
  }
  frames.sort((a, b) => a - b);
  // Sort after the duplicate pass, then dedupe again by value.
  const unique = frames.filter(
    (frame, i) => i === 0 || frame !== frames[i - 1],
  );

  const intervals = [];
  const starts = [];
  for (let i = 1; i < unique.length; i++) {
    intervals.push(unique[i] - unique[i - 1]);
    starts.push(unique[i - 1]);
  }

  const stats = (values, overBudgetValues) => {
    const ascending = [...values].sort((a, b) => a - b);
    const missed = values.reduce(
      (count, value) => count + Math.max(0, Math.round(value / periodMs) - 1),
      0,
    );
    return {
      intervals: values.length,
      p50Ms: round2(percentile(ascending, 0.5)),
      p95Ms: round2(percentile(ascending, 0.95)),
      p99Ms: round2(percentile(ascending, 0.99)),
      worstMs: round2(ascending.length ? ascending[ascending.length - 1] : NaN),
      overBudget: overBudgetValues.length,
      overBudgetPct: values.length
        ? round2((overBudgetValues.length / values.length) * 100)
        : 0,
      missedFramesEstimate: missed,
      intervals25To100ms: values.filter((value) => value >= 25 && value < 100)
        .length,
    };
  };

  const overBudget = intervals.filter((value) => value > budgetMs);
  const overall = stats(intervals, overBudget);

  const outsideIntervals = [];
  const outsideOver = [];
  if (blocks.length > 0) {
    for (let i = 0; i < intervals.length; i++) {
      if (touchesBlock(starts[i], starts[i] + intervals[i], blocks)) continue;
      outsideIntervals.push(intervals[i]);
      if (intervals[i] > budgetMs) outsideOver.push(intervals[i]);
    }
  }

  const idle = (input.idle ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const idleDeltas = [];
  for (let i = 1; i < idle.length; i++) idleDeltas.push(idle[i] - idle[i - 1]);

  const durationMs =
    input.durationMs ??
    (unique.length > 0 ? unique[unique.length - 1] - unique[0] : 0);

  return {
    kind: 'roku-pacing-proxy',
    case: input.case ?? 'unknown',
    durationSeconds: round2(durationMs / 1000),
    refreshHz: round2(1000 / periodMs),
    periodMs: round2(periodMs),
    toleranceMs,
    budgetMs: round2(budgetMs),
    // Android vocabulary: frames observed, and intervals that exceeded the
    // refresh period plus tolerance ("misses" there).
    appFrames: unique.length,
    frames: unique.length,
    intervals: intervals.length,
    misses: overBudget.length,
    p50Ms: overall.p50Ms,
    p95Ms: overall.p95Ms,
    p99Ms: overall.p99Ms,
    worstMs: overall.worstMs,
    overBudget: overall.overBudget,
    overBudgetPct: overall.overBudgetPct,
    missedFramesEstimate: overall.missedFramesEstimate,
    intervals25To100ms: overall.intervals25To100ms,
    cadence60Hz: {
      matchedDisplayFrames: unique.length,
      overBudget: overall.overBudget,
      intervals25To100ms: overall.intervals25To100ms,
    },
    withoutDeliberateBlocks:
      blocks.length > 0 ? stats(outsideIntervals, outsideOver) : null,
    deliberateBlocks: blocks,
    idleCallbacks: idle.length,
    idleIntervalP50Ms: idleDeltas.length
      ? round2(
          percentile(
            [...idleDeltas].sort((a, b) => a - b),
            0.5,
          ),
        )
      : null,
    // The strict rule is zero intervals over budget. This is the proxy's own
    // verdict; it is not a device certification result.
    proxyBudgetPass: overall.overBudget === 0,
    proxy: true,
    whatThisDoesNotMeasure: WHAT_THIS_DOES_NOT_MEASURE,
  };
}

/** A readable report: one line per fact, ending with the proxy verdict. */
export function formatPacingReport(summary) {
  const lines = [];
  lines.push(`Roku frame pacing (proxy) — case ${summary.case}`);
  lines.push(
    `duration ${summary.durationSeconds}s, ${summary.appFrames} JS frames, ` +
      `${summary.intervals} intervals at ${summary.refreshHz} Hz ` +
      `(budget ${summary.budgetMs} ms = ${summary.periodMs} + ${summary.toleranceMs} tolerance)`,
  );
  lines.push(
    `p50 ${summary.p50Ms} ms, p95 ${summary.p95Ms} ms, p99 ${summary.p99Ms} ms, ` +
      `worst ${summary.worstMs} ms`,
  );
  lines.push(
    `over budget ${summary.overBudget} of ${summary.intervals} intervals ` +
      `(${summary.overBudgetPct}%), missed-frame estimate ${summary.missedFramesEstimate}`,
  );
  lines.push(
    `cadence60Hz matched=${summary.cadence60Hz.matchedDisplayFrames} ` +
      `overBudget=${summary.cadence60Hz.overBudget} ` +
      `intervals25To100ms=${summary.cadence60Hz.intervals25To100ms}`,
  );
  if (summary.withoutDeliberateBlocks) {
    const outside = summary.withoutDeliberateBlocks;
    lines.push(
      `outside the deliberate JS block: ${outside.intervals} intervals, ` +
        `p95 ${outside.p95Ms} ms, worst ${outside.worstMs} ms, ` +
        `over budget ${outside.overBudget}, missed estimate ${outside.missedFramesEstimate}`,
    );
  }
  for (const block of summary.deliberateBlocks ?? [])
    lines.push(`deliberate JS block: ${block.ms} ms`);
  lines.push(
    `proxy gate: ${summary.proxyBudgetPass ? 'no interval over budget' : 'intervals over budget'} ` +
      '(proxy only; not a device certification)',
  );
  lines.push(`does not measure: ${summary.whatThisDoesNotMeasure}`);
  return lines.join('\n');
}

// ---- CLI --------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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
      'Usage: node analyze-roku-pacing.mjs <pacing-results.json> [--out <dir>]',
    );
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const summary = analyzePacing(input);
  const report = formatPacingReport(summary);
  const out = flag('--out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, 'summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
    writeFileSync(path.join(out, 'summary.txt'), report + '\n');
  }
  console.log(report);
  console.log(JSON.stringify(summary));
}
