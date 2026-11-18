// A is the last pre-beta release. C is the current checkout.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const arms = join(here, '.arms');
export const PINS = {
  solidA: '6140e99b4ae7f0b990f11a53d5c1237439dc085e',
  rendererA: '39a7dccb4d9087d11af083affd16d85c33bc6b6d',
};
const installed = realpathSync(
  join(root, 'node_modules/@solid-multiplatform/renderer'),
);
export const ARMS = {
  A: {
    solid: join(arms, 'solid-a'),
    renderer: join(arms, 'renderer-a'),
    rendererMajor: 2,
    rendererVersion: '0.1.0',
  },
  C: {
    solid: root,
    renderer: installed,
    rendererMajor: 2,
    rendererVersion: JSON.parse(readFileSync(join(installed, 'package.json')))
      .version,
  },
};

export function prepareArms() {
  const marker = join(arms, '.baseline');
  if (
    existsSync(marker) &&
    readFileSync(marker, 'utf8') === PINS.solidA &&
    existsSync(join(ARMS.A.renderer, 'package.json'))
  )
    return ARMS;
  for (const dir of [ARMS.A.solid, ARMS.A.renderer]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  const archive = execFileSync('git', ['archive', PINS.solidA], {
    cwd: root,
    maxBuffer: 128 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', ARMS.A.solid], { input: archive });
  execFileSync('tar', [
    '-xzf',
    join(ARMS.A.solid, 'vendor/solid-multiplatform-renderer-0.1.0.tgz'),
    '--strip-components=1',
    '-C',
    ARMS.A.renderer,
  ]);
  writeFileSync(marker, PINS.solidA);
  return ARMS;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) prepareArms();
