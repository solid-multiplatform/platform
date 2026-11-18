// Release helper. The three packages are versioned together.
//
//   node scripts/release.mjs set <version>     write <version> to every package
//   node scripts/release.mjs check <tag>       fail unless every package is at <tag> (vX.Y.Z)
//   node scripts/release.mjs pack <directory>  pack every package and write SHA256SUMS
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = ['renderer', 'platform', 'video'].map((name) =>
  path.join(root, 'packages', name),
);
const manifest = (dir) => path.join(dir, 'package.json');
const read = (dir) => JSON.parse(readFileSync(manifest(dir), 'utf8'));
const [command, argument] = process.argv.slice(2);

if (command === 'set') {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(argument ?? ''))
    throw new Error(
      'Usage: release.mjs set <version>, for example 0.3.0-beta.1',
    );
  for (const dir of packages) {
    const pkg = read(dir);
    pkg.version = argument;
    // The platform names the exact renderer it was built and tested with.
    if (pkg.peerDependencies?.['@solid-multiplatform/renderer'])
      pkg.peerDependencies['@solid-multiplatform/renderer'] = argument;
    writeFileSync(manifest(dir), JSON.stringify(pkg, null, 2) + '\n');
    console.log(`${pkg.name} ${argument}`);
  }
} else if (command === 'check') {
  const version = (argument ?? '').replace(/^v/, '');
  const wrong = packages
    .map(read)
    .filter((pkg) => pkg.version !== version)
    .map((pkg) => `${pkg.name} is ${pkg.version}`);
  if (wrong.length)
    throw new Error(
      `Tag ${argument} does not match: ${wrong.join(', ')}. Run "node scripts/release.mjs set ${version}" and commit before tagging.`,
    );
  console.log(`Every package is at ${version}`);
} else if (command === 'pack') {
  const out = path.resolve(argument ?? 'release');
  mkdirSync(out, { recursive: true });
  for (const dir of packages)
    // pnpm rewrites workspace: dependencies to real versions and runs prepack.
    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: dir,
      stdio: 'inherit',
    });
  const sums = readdirSync(out)
    .filter((file) => file.endsWith('.tgz'))
    .sort()
    .map(
      (file) =>
        createHash('sha256')
          .update(readFileSync(path.join(out, file)))
          .digest('hex') +
        '  ' +
        file,
    );
  writeFileSync(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(sums.join('\n'));
} else {
  throw new Error(
    'Usage: release.mjs set <version> | check <tag> | pack <directory>',
  );
}
