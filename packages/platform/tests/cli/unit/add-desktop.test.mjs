import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  LATEST_RELEASE,
  addHostPackage,
  installRuntime,
  latestRuntimeAsset,
  platformTag,
  runtimeAsset,
  runtimeAssetName,
  runtimeDestination,
} from '../../../cli/add-desktop.mjs';

const release = {
  tag_name: 'v0.2.0',
  assets: [
    {
      name: 'solid-multiplatform-platform-0.2.0.tgz',
      browser_download_url: 'u1',
    },
    { name: 'solid-desktop-linux-x64.tar.gz', browser_download_url: 'u2' },
    { name: 'solid-desktop-darwin-arm64.tar.gz', browser_download_url: 'u3' },
  ],
};

/** A filesystem in memory, so nothing here writes to this machine. */
function memory() {
  const files = new Map();
  const modes = new Map();
  return {
    files,
    modes,
    fs: {
      existsSync: (file) => files.has(file),
      mkdirSync() {},
      writeFileSync: (file, data) => files.set(file, String(data)),
      chmodSync: (file, mode) => modes.set(file, mode),
    },
  };
}

test('the platform tag and runtime asset name match the release workflow', () => {
  assert.equal(platformTag('linux', 'x64'), 'linux-x64');
  assert.equal(platformTag('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(runtimeAssetName('linux-x64'), 'solid-desktop-linux-x64.tar.gz');
  assert.equal(
    runtimeDestination(
      '/app/node_modules/@solid-multiplatform/host-desktop',
      'linux-x64',
    ),
    path.join(
      '/app/node_modules/@solid-multiplatform/host-desktop',
      'prebuilt/linux-x64/solid-desktop',
    ),
  );
});

test('the asset for a platform is chosen by its exact name', () => {
  assert.equal(runtimeAsset(release, 'linux-x64').browser_download_url, 'u2');
  assert.equal(
    runtimeAsset(release, 'darwin-arm64').browser_download_url,
    'u3',
  );
  assert.throws(
    () => runtimeAsset(release, 'win32-x64'),
    /has no solid-desktop-win32-x64\.tar\.gz\. Assets: /,
  );
});

test('the latest release is read through a fake fetch', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: true,
      arrayBuffer: async () => Buffer.from(JSON.stringify(release)),
    };
  };
  const asset = await latestRuntimeAsset({ tag: 'linux-x64', fetchImpl });
  assert.deepEqual(seen, [LATEST_RELEASE]);
  assert.equal(asset.name, 'solid-desktop-linux-x64.tar.gz');
});

test('SOLID_DESKTOP_RUNTIME wins and nothing is downloaded', async () => {
  const { fs, files } = memory();
  files.set('/opt/solid-desktop', 'runtime');
  let fetched = 0;
  const result = await installRuntime({
    packageRoot: '/pkg',
    env: { SOLID_DESKTOP_RUNTIME: '/opt/solid-desktop' },
    fetchImpl: async () => {
      fetched++;
      throw new Error('must not download');
    },
    fs,
  });
  assert.deepEqual(result, {
    path: '/opt/solid-desktop',
    source: 'environment',
  });
  assert.equal(fetched, 0);
});

test('a missing SOLID_DESKTOP_RUNTIME path is one clear line', async () => {
  await assert.rejects(
    installRuntime({
      packageRoot: '/pkg',
      env: { SOLID_DESKTOP_RUNTIME: '/missing/solid-desktop' },
      fs: memory().fs,
    }),
    /SOLID_DESKTOP_RUNTIME names \/missing\/solid-desktop, which does not exist/,
  );
});

test('the runtime is fetched and placed where runtime.mjs looks', async () => {
  const { fs, files, modes } = memory();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      arrayBuffer: async () =>
        url === LATEST_RELEASE
          ? Buffer.from(JSON.stringify(release))
          : Buffer.from('fake-tar'),
    };
  };
  const extract = (bytes, directory) => {
    assert.equal(String(bytes), 'fake-tar');
    fs.writeFileSync(path.join(directory, 'solid-desktop'), bytes);
  };
  const result = await installRuntime({
    packageRoot: '/pkg',
    tag: 'linux-x64',
    env: {},
    fetchImpl,
    fs,
    extract,
  });
  assert.deepEqual(calls, [LATEST_RELEASE, 'u2']);
  assert.equal(result.path, path.join('/pkg/prebuilt/linux-x64/solid-desktop'));
  assert.equal(result.source, 'release');
  assert.equal(result.asset, 'solid-desktop-linux-x64.tar.gz');
  assert.equal(files.get(result.path), 'fake-tar');
  assert.equal(modes.get(result.path), 0o755);
});

test('an archive without the runtime fails instead of leaving an empty path', async () => {
  const { fs } = memory();
  await assert.rejects(
    installRuntime({
      packageRoot: '/pkg',
      tag: 'linux-x64',
      env: {},
      asset: release.assets[1],
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from('fake-tar'),
      }),
      fs,
      extract() {},
    }),
    /did not contain solid-desktop/,
  );
});

test('no package installed says how to get one', async () => {
  await assert.rejects(
    installRuntime({ packageRoot: undefined, env: {}, fs: memory().fs }),
    /No @solid-multiplatform\/host-desktop is installed in this app/,
  );
});

test('a release archive goes into vendor and a file: dependency', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'solid-add-desktop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: {} }),
  );
  const archive = path.join(root, 'solid-multiplatform-host-desktop-0.2.0.tgz');
  writeFileSync(archive, 'package bytes');
  const name = addHostPackage(root, archive);
  assert.match(name, /^solid-host-desktop-[0-9a-f]{16}\.tgz$/);
  assert.equal(
    readFileSync(path.join(root, 'vendor', name), 'utf8'),
    'package bytes',
  );
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    pkg.dependencies['@solid-multiplatform/host-desktop'],
    'file:vendor/' + name,
  );
});
