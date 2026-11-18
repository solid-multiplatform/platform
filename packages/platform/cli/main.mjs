#!/usr/bin/env node
import { packageDesktop } from './desktop-package.mjs';
import { explain, checkTargets } from './variants.mjs';
import { addVideo } from './add-video.mjs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { init } from './init.mjs';
import { build } from './build.mjs';
import { newPlugin } from './plugins.mjs';
import { project, targets } from './files.mjs';
import { certifyRoku } from './certification.mjs';

const help = `solid-platform init <directory> [--targets web,tizen,webos,vizio,roku,android-tv,android,apple-tv,ios,desktop]
solid-platform plugin new <name> [--targets list] [--android-kind kotlin|sidecar|service|jni]
solid-platform build <target> [--legacy]
solid-platform package desktop
solid-platform dev <web|desktop>
solid-platform explain <target> <module>
solid-platform add video <release.tgz>
solid-platform plugins run desktop
solid-platform check [target]
solid-platform certify roku <metrics.json>

Run plugin, build and dev from the app directory. Init defaults to web.
New plugins default to the configured app targets. Desktop uses a native SDL3 window.`;
try {
  const { values, positionals: args } = parseArgs({
    allowPositionals: true,
    options: {
      legacy: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      targets: { type: 'string' },
      'android-kind': { type: 'string' },
    },
  });
  const root = process.cwd();
  if (args[0] === 'add' && args[1] === 'video' && args.length === 3)
    addVideo(root, path.resolve(args[2]));
  else if (args.join(' ') === 'package desktop') packageDesktop(root);
  else if (values.help || !args.length) console.log(help);
  else if (args.join(' ') === 'plugins run desktop')
    build(root, 'desktop', 'plugins');
  else if (args[0] === 'explain' && args.length === 3)
    console.log(JSON.stringify(explain(root, args[1], args[2]), null, 2));
  else if (args[0] === 'check' && args.length <= 2) checkTargets(root, args[1]);
  else if (args[0] === 'certify' && args[1] === 'roku' && args.length === 3)
    certifyRoku(path.resolve(args[2]));
  else if (args[0] === 'init' && args.length === 2 && !values['android-kind']) {
    const dest = path.resolve(args[1]);
    init(dest, targets(values.targets ?? 'web'));
    console.log('Created ' + dest);
  } else if (args[0] === 'plugin' && args[1] === 'new' && args.length === 3) {
    const config = project(root);
    const selected = targets(
      values.targets ?? config.targets.join(','),
      config.targets,
    );
    if (
      values['android-kind'] &&
      !selected.some((t) => t === 'android' || t === 'android-tv')
    )
      throw new Error('--android-kind requires an Android target');
    newPlugin(root, args[2], selected, values['android-kind'] ?? 'kotlin');
    console.log('Created plugins/' + args[2]);
  } else if (
    ['build', 'dev'].includes(args[0]) &&
    args.length === 2 &&
    !values.targets &&
    !values['android-kind']
  )
    build(root, args[1], args[0] === 'dev', values.legacy === true);
  else throw new Error(help);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
