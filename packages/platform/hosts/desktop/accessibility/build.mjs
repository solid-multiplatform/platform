import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';

const dir = process.argv[2],
  require = createRequire(path.join(dir, 'package.json'));
const out = path.join(dir, 'work', 'accessibility'),
  cache = path.join(dir, 'node_modules/.cache/solid-accesskit');
mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
const file =
  process.env.SOLID_ACCESSKIT_ARCHIVE ??
  path.join(cache, 'accesskit-c-0.23.2.zip');
let zip;
if (existsSync(file)) zip = readFileSync(file);
else {
  const response = await fetch(
    'https://github.com/AccessKit/accesskit-c/releases/download/0.23.2/accesskit-c-0.23.2.zip',
  );
  if (!response.ok)
    throw new Error('AccessKit download failed: ' + response.status);
  zip = Buffer.from(await response.arrayBuffer());
}
if (
  createHash('sha256').update(zip).digest('hex') !==
  'c7fa84f8f34fca909f662375737a54f98b17cf9eae51fffd94ab3d9f662e3681'
)
  throw new Error('Unexpected AccessKit archive integrity');
if (!existsSync(file)) {
  writeFileSync(file + '.part', zip);
  renameSync(file + '.part', file);
}
const os = process.platform,
  arch = { x64: 'x86_64', arm64: 'arm64', ia32: 'x86' }[process.arch];
const target = {
  linux: 'linux/' + arch,
  win32: 'windows/' + arch + '/msvc',
  darwin: 'macos/' + arch,
}[os];
const prefix = 'accesskit-c-0.23.2/';
const files = [
  'include/accesskit.h',
  'LICENSE-MIT',
  'LICENSE-APACHE',
  'LICENSE.chromium',
];
for (const name of os === 'win32'
  ? ['accesskit.lib', 'accesskit.dll']
  : [os === 'darwin' ? 'libaccesskit.dylib' : 'libaccesskit.so'])
  files.push('lib/' + target + '/shared/' + name);
const contents = require('fflate').unzipSync(zip, {
  filter: (e) => files.includes(e.name.slice(prefix.length)),
});
for (const name of files) {
  const bytes = contents[prefix + name];
  if (!bytes) throw new Error('AccessKit runtime unavailable for ' + target);
  writeFileSync(path.join(out, path.basename(name)), bytes);
}
const cpp = fileURLToPath(new URL('./bridge.cpp', import.meta.url));
const command = os === 'win32' ? 'cl' : process.env.CXX || 'c++';
const args =
  os === 'win32'
    ? [
        '/nologo',
        '/EHsc',
        '/std:c++17',
        '/O2',
        '/LD',
        '/I.',
        cpp,
        'accesskit.lib',
        '/link',
        '/OUT:solid-access.dll',
      ]
    : [
        '-std=c++17',
        '-O2',
        '-fPIC',
        os === 'darwin' ? '-dynamiclib' : '-shared',
        cpp,
        '-I.',
        '-L.',
        '-laccesskit',
        os === 'darwin' ? '-Wl,-rpath,@loader_path' : '-Wl,-rpath,$ORIGIN',
        '-o',
        os === 'darwin' ? 'solid-access.dylib' : 'solid-access.so',
      ];
const result = spawnSync(command, args, { cwd: out, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

for (const file of [
  'accesskit.h',
  'accesskit.lib',
  'solid-access.lib',
  'solid-access.exp',
  'bridge.obj',
])
  rmSync(path.join(out, file), { force: true });
