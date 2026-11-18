// Build a private device fixture from the frozen reference assets at the supplied checkout.
import path from 'node:path';
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { init } from '../../cli/init.mjs';
const [destination, reference] = process.argv.slice(2);
if (!destination || !reference)
  throw new Error('Usage: node make-tv-app.mjs DEST REFERENCE_CHECKOUT');
const root = path.resolve(destination);
init(root, ['android-tv']);
const { default: data } = await import(
  pathToFileURL(path.resolve(reference, 'web/reference-data.mjs'))
);
const { makeScene } = await import(
  pathToFileURL(path.resolve(reference, 'web/scene.mjs'))
);
const scenes = [makeScene(false), makeScene(true)];
const images = [
  ...new Set(
    scenes.flatMap((scene) =>
      scene.nodes.map((n) => n.image).filter((i) => i >= 0),
    ),
  ),
];
const assets = path.join(root, 'targets/android-tv/gallery');
mkdirSync(assets, { recursive: true });
for (const i of images)
  cpSync(
    path.join(reference, 'public', data.images[i]),
    path.join(assets, path.basename(data.images[i])),
  );
writeFileSync(
  path.join(root, 'src/scenes.json'),
  JSON.stringify(
    scenes.map((scene) => ({
      offsets: scene.steps.map((s) => s.to),
      nodes: scene.nodes.map((n) => ({
        ...n,
        src:
          n.image >= 0
            ? 'file:///app/gallery/' + path.basename(data.images[n.image])
            : null,
      })),
    })),
  ),
);
const config = path.join(root, 'targets/android-tv/webpack.config.js');
writeFileSync(
  config,
  readFileSync(config, 'utf8').replace(
    'chainSolidTV(config);',
    `chainSolidTV(config);
config.plugin('CopyWebpackPlugin').tap(args => { args[0].patterns.push({from:path.resolve(__dirname,'gallery'),to:'gallery'}); return args; });`,
  ),
);
cpSync(
  new URL('./tv-workload.tsx', import.meta.url),
  path.join(root, 'src/app.tsx'),
);
