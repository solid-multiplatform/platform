import path from 'node:path';
import { createHash } from 'node:crypto';
import { write, writeJson, command } from './files.mjs';

export function packageTV(dir, target, name, legacy) {
  const dist = path.join(dir, legacy ? 'dist-legacy' : 'dist');
  if (target === 'webos') {
    writeJson(path.join(dist, 'appinfo.json'), {
      id: 'dev.solidapp.' + name,
      version: '0.2.0',
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
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://solid.app/${name}" version="0.2.0" viewmodes="maximized">
  <tizen:application id="${packageId}.${name}" package="${packageId}" required_version="2.3"/>
  <content src="index.html"/><name>${name}</name><icon src="icon.png"/>
  <tizen:profile name="tv-samsung"/><tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
</widget>\n`,
    );
    if (process.env.TIZEN_SECURITY_PROFILE)
      command(
        'tizen',
        [
          'package',
          '-t',
          'wgt',
          '-s',
          process.env.TIZEN_SECURITY_PROFILE,
          '--',
          dist,
        ],
        dir,
      );
  }
}
