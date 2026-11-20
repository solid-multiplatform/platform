// Parses a corpus of agent-chat messages and reports the cost of a cache miss
// and a cache hit. Run after `pnpm build` in packages/platform:
//
//   node bench/markdown.mjs
//
// The number that matters for a virtualised transcript is the cache-hit cost
// (a scroll must parse nothing) and the miss cost against the 8.33 ms frame
// budget of a 120 Hz panel. One message is a fraction of a frame; a screenful
// is what a scroll can expose at once.
import { performance } from 'node:perf_hooks';
import {
  clearMarkdownCache,
  markdown,
  markdownCacheSize,
} from '../dist/src/markdown/index.js';

const messages = [
  `## Ship notes

The build is up. **Frame times** are steady and the \`0.998\` decay holds.

- rail snaps on release
- chat keeps its position
- \`SCROLL_DEBUG=0\` for a quiet log

See [the PR](https://example.com/pr/62 "Refresh rate") for the numbers.`,
  `I moved the hero copy down so it clears the status bar.

Next: the skeleton sweep.`,
  `\`\`\`ts
const scroller = createScroller({ axis: 'y' });
const offset = scroller.offset();
\`\`\``,
  `Three things:

1. skeletons match the card size
2. the rail snaps on release
3. the meter is off by default

> Restraint: one accent, generous spacing.`,
  `Ran \`npm test\` — **1291 passed**. The one failure is the PNG fixture under Node 26, which CI's Node 24 passes.

| file | result |
| --- | --- |`,
];

/** A larger message, the worst case a single row can be. */
const long = [
  'Here is the whole story, in order, because the ordering is the point.',
  '',
  ...Array.from(
    { length: 12 },
    (_, i) => `- step ${i + 1}: do the thing and check it twice`,
  ),
  '',
  '```js',
  ...Array.from({ length: 20 }, (_, i) => `const value${i} = compute(${i});`),
  '```',
  '',
  'And a closing paragraph with `inline code`, **strong**, *emphasis*, ~~struck~~ and a [link](https://example.com).',
].join('\n');

function time(label, fn, runs) {
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn(i);
  const ms = performance.now() - start;
  return { label, runs, ms, per: (ms * 1000) / runs };
}

const report = [];

// Cache miss: every run is a new source, so every parse is real work.
clearMarkdownCache();
let n = 0;
report.push(
  time(
    'miss, chat message',
    () => {
      markdown(`${messages[n++ % messages.length]}\n<!-- ${n} -->`);
    },
    20000,
  ),
);

clearMarkdownCache();
n = 0;
report.push(
  time(
    'miss, long message',
    () => {
      markdown(`${long}\n<!-- ${n++} -->`);
    },
    2000,
  ),
);

// Cache hit: the same sources again, as a scroll back over the transcript.
const sources = messages.map((message, i) => `${message}\n<!-- hit ${i} -->`);
for (const source of sources) markdown(source);
report.push(time('hit', () => markdown(sources[n++ % sources.length]), 200000));

console.log(`cache entries: ${markdownCacheSize()}`);
for (const row of report) {
  console.log(
    `${row.label.padEnd(20)} ${row.per.toFixed(2).padStart(8)} µs/parse  (${row.runs} runs, ${row.ms.toFixed(0)} ms)`,
  );
}
