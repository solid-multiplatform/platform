#!/usr/bin/env node
// Renders docs/features.md from docs/features.json.
//
//   node scripts/feature-matrix.mjs           write docs/features.md
//   node scripts/feature-matrix.mjs --check   fail if it is out of date or the
//                                             data breaks the evidence rule
//
// The evidence rule: a `tested` cell must name an automated test file that
// exists in this repository. Everything else is `preview` (implemented, no
// test on that target), `in-progress` (in an open pull request) or
// `unavailable`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataFile = path.join(root, 'docs/features.json');
export const outputFile = path.join(root, 'docs/features.md');

export const statuses = ['tested', 'preview', 'in-progress', 'unavailable'];
const cellText = {
  tested: 'tested',
  preview: 'preview',
  'in-progress': 'in progress',
  unavailable: 'no',
};

export function load(file = dataFile) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The repository path an evidence string starts with. */
export function evidencePath(evidence) {
  return evidence.trim().split(/\s+/)[0] ?? '';
}

const inRepository = (file) =>
  file !== '' &&
  !path.isAbsolute(file) &&
  !file.split('/').includes('..') &&
  existsSync(path.join(root, file));

/**
 * Expands every row to one cell per target and collects what is wrong with
 * the data. `exists` answers whether an evidence path is in the repository.
 */
export function expand(data, exists = inRepository) {
  const errors = [];
  const targets = Array.isArray(data.targets) ? data.targets : [];
  if (!targets.length) errors.push('No targets');
  const ids = new Set();
  const groups = [];
  for (const group of data.groups ?? []) {
    const rows = [];
    for (const row of group.rows ?? []) {
      const where = `${group.title} / ${row.id}`;
      if (!row.id || !row.feature)
        errors.push(`${where}: needs id and feature`);
      if (ids.has(row.id)) errors.push(`${where}: duplicate row id`);
      ids.add(row.id);
      const cells = {};
      for (const [key, cell] of Object.entries(row.cells ?? {})) {
        for (const target of key.split(',')) {
          if (!targets.includes(target))
            errors.push(`${where}: unknown target "${target}"`);
          else if (cells[target])
            errors.push(`${where}: target "${target}" listed twice`);
          else cells[target] = cell;
        }
      }
      for (const target of targets) {
        const cell = (cells[target] ??= row.default);
        const at = `${where} / ${target}`;
        if (!cell) {
          errors.push(`${at}: no cell and the row has no default`);
          cells[target] = { status: 'unavailable' };
          continue;
        }
        if (!statuses.includes(cell.status)) {
          errors.push(`${at}: unknown status "${cell.status}"`);
          continue;
        }
        if (cell.status !== 'tested') {
          if (cell.evidence !== undefined)
            errors.push(`${at}: only a tested cell has evidence; use note`);
          continue;
        }
        if (typeof cell.evidence !== 'string' || !cell.evidence.trim())
          errors.push(`${at}: tested without evidence`);
        else if (!exists(evidencePath(cell.evidence)))
          errors.push(
            `${at}: evidence path does not exist: ${evidencePath(cell.evidence)}`,
          );
      }
      rows.push({ id: row.id, feature: row.feature, cells });
    }
    groups.push({ title: group.title, note: group.note, rows });
  }
  return { targets, groups, errors };
}

/** The problems with the data; empty when it is valid. */
export function validate(data, exists = inRepository) {
  return expand(data, exists).errors;
}

export function count(matrix) {
  const zero = () => Object.fromEntries(statuses.map((s) => [s, 0]));
  const total = zero();
  const perTarget = Object.fromEntries(matrix.targets.map((t) => [t, zero()]));
  for (const group of matrix.groups)
    for (const row of group.rows)
      for (const target of matrix.targets) {
        const status = row.cells[target].status;
        if (!(status in total)) continue;
        total[status]++;
        perTarget[target][status]++;
      }
  return { total, perTarget };
}

const tableCell = (text) => String(text).replaceAll('|', '\\|');
const table = (head, rows) =>
  [head, head.map(() => '---'), ...rows]
    .map((cells) => '| ' + cells.map(tableCell).join(' | ') + ' |')
    .join('\n');

/** Groups a row's targets by the text `pick` returns for their cell. */
function byText(matrix, row, pick) {
  const found = new Map();
  for (const target of matrix.targets) {
    const text = pick(row.cells[target]);
    if (text) found.set(text, [...(found.get(text) ?? []), target]);
  }
  return found;
}

/** The markdown, before formatting. */
export function render(data, exists = inRepository) {
  const matrix = expand(data, exists);
  const { total, perTarget } = count(matrix);
  const cells = statuses.reduce((sum, s) => sum + total[s], 0);
  const out = [
    '# Feature matrix',
    '<!-- Generated by scripts/feature-matrix.mjs from docs/features.json. Do not edit; change the JSON and run `node scripts/feature-matrix.mjs`. -->',
    'A cell says `tested` only when an automated test in this repository runs that feature on that target; the test and the CI job that runs it are listed under [Evidence](#evidence). A simulator, an emulator or a build loaded in desktop Chromium is named as such there: no cell claims a physical TV, phone or Apple device.',
    '- **tested**: an automated test runs it on that target.\n- **preview**: implemented on main, with no automated test on that target.\n- **in progress**: in an open pull request, not on main.\n- **no**: not implemented on that target.',
    '## Counts',
    `${cells} cells: ${matrix.groups.reduce((n, g) => n + g.rows.length, 0)} features on ${matrix.targets.length} targets.`,
    table(
      ['Status', 'Cells'],
      statuses.map((s) => [cellText[s], total[s]]),
    ),
    table(
      ['Target', ...statuses.map((s) => cellText[s])],
      matrix.targets.map((t) => [
        '`' + t + '`',
        ...statuses.map((s) => perTarget[t][s]),
      ]),
    ),
  ];
  const evidence = [];
  for (const group of matrix.groups) {
    out.push('## ' + group.title);
    if (group.note) out.push(group.note);
    out.push(
      table(
        ['Feature', ...matrix.targets],
        group.rows.map((row) => [
          row.feature,
          ...matrix.targets.map((t) => cellText[row.cells[t].status] ?? '?'),
        ]),
      ),
    );
    const notes = [];
    for (const row of group.rows) {
      for (const [note, targets] of byText(matrix, row, (c) => c.note))
        notes.push(`- ${row.feature}, ${targets.join(', ')}: ${note}`);
      for (const [text, targets] of byText(matrix, row, (c) =>
        c.status === 'tested' ? c.evidence : undefined,
      ))
        evidence.push(`- ${row.feature}, ${targets.join(', ')}: ${text}`);
    }
    if (notes.length) out.push('Notes:', notes.join('\n'));
  }
  out.push(
    '## Evidence',
    'Each tested cell, with the test file that covers it, the workflow and job that run it, and what it checks.',
    evidence.length ? evidence.join('\n') : 'No cell is tested.',
  );
  return out.join('\n\n') + '\n';
}

/** Formats the markdown with the repository's Prettier configuration. */
export async function format(markdown) {
  let prettier;
  try {
    prettier = await import('prettier');
  } catch {
    throw new Error(
      'Cannot import prettier. Run `corepack pnpm install` at the repository root.',
    );
  }
  const config = (await prettier.resolveConfig(outputFile)) ?? {};
  return prettier.format(markdown, { ...config, parser: 'markdown' });
}

async function main(args) {
  const data = load();
  const errors = validate(data);
  if (errors.length) {
    console.error('docs/features.json is invalid:\n  ' + errors.join('\n  '));
    return 1;
  }
  const rendered = await format(render(data));
  if (!args.includes('--check')) {
    writeFileSync(outputFile, rendered);
    console.log('Wrote docs/features.md');
    return 0;
  }
  const current = existsSync(outputFile)
    ? readFileSync(outputFile, 'utf8')
    : undefined;
  if (current !== rendered) {
    console.error(
      'docs/features.md is out of date. Run `node scripts/feature-matrix.mjs`.',
    );
    return 1;
  }
  console.log('docs/features.md is up to date');
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
