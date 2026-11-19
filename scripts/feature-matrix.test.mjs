import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  count,
  evidencePath,
  expand,
  load,
  render,
  statuses,
  validate,
} from './feature-matrix.mjs';

const script = fileURLToPath(new URL('./feature-matrix.mjs', import.meta.url));
const matrix = (cell, extra = {}) => ({
  targets: ['web', 'roku'],
  groups: [
    {
      title: 'Group',
      rows: [
        {
          id: 'row',
          feature: 'Feature',
          default: { status: 'unavailable' },
          cells: { web: cell },
          ...extra,
        },
      ],
    },
  ],
});
const present = () => true;

test('a tested cell without evidence is rejected', () => {
  assert.match(
    validate(matrix({ status: 'tested' }), present).join('\n'),
    /row \/ web: tested without evidence/,
  );
});

test('a tested cell whose evidence path is missing is rejected', () => {
  const data = matrix({
    status: 'tested',
    evidence: 'packages/nowhere/missing.test.ts (test.yml: unit)',
  });
  assert.match(
    validate(data).join('\n'),
    /evidence path does not exist: packages\/nowhere\/missing\.test\.ts/,
  );
  assert.deepEqual(validate(data, present), []);
});

test('evidence outside the repository is rejected', () => {
  for (const evidence of ['/etc/hostname', '../outside.test.ts'])
    assert.equal(validate(matrix({ status: 'tested', evidence })).length, 1);
});

test('an unknown status is rejected', () => {
  assert.match(
    validate(matrix({ status: 'shipped' }), present).join('\n'),
    /unknown status "shipped"/,
  );
});

test('evidence on a cell that is not tested or a device run is rejected', () => {
  assert.match(
    validate(matrix({ status: 'preview', evidence: 'README.md' })).join('\n'),
    /only a tested or device cell has evidence/,
  );
});

test('a device cell without evidence is rejected', () => {
  assert.match(
    validate(matrix({ status: 'device' }), present).join('\n'),
    /row \/ web: device without evidence/,
  );
});

test('device evidence outside handoff/ is rejected', () => {
  for (const evidence of [
    'packages/platform/tests/a.test.ts (job)',
    '/handoff/a.txt',
    'handoff/../outside.txt',
  ])
    assert.match(
      validate(matrix({ status: 'device', evidence }), present).join('\n'),
      /device evidence must be under handoff\//,
    );
});

test('device evidence is accepted when handoff/ is absent and checked when present', () => {
  const data = matrix({
    status: 'device',
    evidence: 'handoff/run/result.txt (device run)',
  });
  assert.deepEqual(validate(data, present, () => true), []);
  assert.match(
    validate(data, present, () => false).join('\n'),
    /device evidence file does not exist: handoff\/run\/result\.txt/,
  );
});

test('a row must cover every target', () => {
  assert.match(
    validate(matrix({ status: 'preview' }, { default: undefined })).join('\n'),
    /row \/ roku: no cell and the row has no default/,
  );
  assert.match(
    validate(matrix({ status: 'preview' }, { cells: { tv: {} } })).join('\n'),
    /unknown target "tv"/,
  );
});

test('a key lists several targets and the default fills the rest', () => {
  const data = matrix(undefined, {
    cells: { 'web,roku': { status: 'preview', note: 'Both.' } },
  });
  const { groups, errors } = expand(data);
  assert.deepEqual(errors, []);
  assert.equal(groups[0].rows[0].cells.roku.note, 'Both.');
  assert.equal(evidencePath(' a/b.test.ts (job)'), 'a/b.test.ts');
});

test('the render states the counts per status and lists the evidence', () => {
  const data = matrix({
    status: 'tested',
    evidence: 'tests/a.test.ts (test.yml: unit)',
  });
  const markdown = render(data, present);
  assert.match(markdown, /2 cells: 1 features on 2 targets\./);
  assert.match(markdown, /\| tested \| 1 \|/);
  assert.match(markdown, /\| device \| 0 \|/);
  assert.match(markdown, /\| no \| 1 \|/);
  assert.match(markdown, /\| `roku` \| 0 \| 0 \| 0 \| 0 \| 1 \|/);
  assert.match(markdown, /### Tested\n\n- Feature, web: tests\/a\.test\.ts/);
});

test('a device cell is counted and listed as a device run', () => {
  const data = matrix({
    status: 'device',
    evidence: 'handoff/run/result.txt (device run)',
  });
  const { total } = count(expand(data, present, () => true));
  assert.equal(total.device, 1);
  const markdown = render(data, present, () => true);
  assert.match(markdown, /\| device \| 1 \|/);
  assert.match(markdown, /\| `web` \| 0 \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(
    markdown,
    /### Device runs\n\n- Feature, web: handoff\/run\/result\.txt/,
  );
});

test('docs/features.json is valid and every cell is counted', () => {
  const data = load();
  assert.deepEqual(validate(data), []);
  const expanded = expand(data);
  const { total } = count(expanded);
  const rows = expanded.groups.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(
    statuses.reduce((sum, s) => sum + total[s], 0),
    rows * expanded.targets.length,
  );
  assert.equal(expanded.targets.length, 13);
});

test('docs/features.md is up to date', () => {
  const run = spawnSync(process.execPath, [script, '--check'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});
