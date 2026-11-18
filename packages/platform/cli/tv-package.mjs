import path from 'node:path';
import { createHash } from 'node:crypto';
import { write, writeJson, command } from './files.mjs';

// `config` is the project's solid-platform.config; its id, version and Tizen
// signing profile come first, and the values used before it existed remain
// the fallback.
export function packageTV(dir, target, name, legacy, config = {}) {
  const dist = path.join(dir, legacy ? 'dist-legacy' : 'dist');
  // Both stores take three numbers; a prerelease suffix is dropped.
  const version = (config.version ?? '0.2.0').split('-')[0];
  const profile =
    config.signing?.tizen?.profile ?? process.env.TIZEN_SECURITY_PROFILE;
  if (target === 'webos') {
    writeJson(path.join(dist, 'appinfo.json'), {
      id: config.id ?? 'dev.solidapp.' + name,
      version,
      vendor: 'Application developer',
      requiredACG: [],
      type: 'web',
      main: 'index.html',
      title: name,
      icon: 'icon.png',
    });
    command(
      'corepack',
      ['pnpm', 'exec', 'ares-package', dist, '--outdir', dist + '-package'],
      dir,
    );
  } else if (target === 'tizen') {
    const packageId =
      'S' + createHash('sha256').update(name).digest('hex').slice(0, 9);
    write(
      path.join(dist, 'config.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://solid.app/${name}" version="${version}" viewmodes="maximized">
  <tizen:application id="${packageId}.${name}" package="${packageId}" required_version="2.3"/>
  <content src="index.html"/><name>${name}</name><icon src="icon.png"/>
  <tizen:profile name="tv-samsung"/><tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
</widget>\n`,
    );
    if (profile)
      command(
        'tizen',
        ['package', '-t', 'wgt', '-s', profile, '--', dist],
        dir,
      );
  }
}
