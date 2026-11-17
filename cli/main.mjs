#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { init } from './init.mjs';
import { build } from './build.mjs';
import { newPlugin } from './plugins.mjs';
import { project, targets } from './files.mjs';

const help = `solid-platform init <directory> [--targets web,roku,android-tv,apple-tv,ios,desktop]
solid-platform plugin new <name> [--targets list] [--android-kind kotlin|sidecar|service|jni]
solid-platform build <target>
solid-platform dev <web|desktop>

Run plugin, build and dev from the app directory. Init defaults to web.
New plugins default to the configured app targets. Desktop builds a native command runner.`;
try {
  const { values, positionals: args } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      targets: { type: 'string' },
      'android-kind': { type: 'string' },
    },
  });
  const root = process.cwd();
  if (values.help || !args.length) console.log(help);
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
    if (values['android-kind'] && !selected.includes('android-tv'))
      throw new Error('--android-kind requires an Android target');
    newPlugin(root, args[2], selected, values['android-kind'] ?? 'kotlin');
    console.log('Created plugins/' + args[2]);
  } else if (
    ['build', 'dev'].includes(args[0]) &&
    args.length === 2 &&
    !values.targets &&
    !values['android-kind']
  )
    build(root, args[1], args[0] === 'dev');
  else throw new Error(help);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
