// Build a private device fixture from the frozen reference assets at the supplied checkout.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { init } from '../../cli/init.mjs';
import { addVideo } from '../../cli/add-video.mjs';
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mixed: { type: 'string' },
    'surface-view': { type: 'boolean' },
    'texture-view': { type: 'boolean' },
  },
});
const [destination, reference] = positionals;
if (positionals.length !== 2) {
  throw new Error(
    'Usage: node make-tv-app.mjs DEST REFERENCE_CHECKOUT [--mixed VIDEO_ARCHIVE] [--surface-view | --texture-view]',
  );
}
if (values['surface-view'] && values['texture-view']) {
  throw new Error('Choose one canvas surface');
}
const videoArchive = values.mixed;
const root = path.resolve(destination);
init(root, ['android-tv']);
if (videoArchive) addVideo(root, path.resolve(videoArchive));
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
      selected: scene.steps.map((s) => s.row),
      contentHeight: Math.ceil(
        Math.max(
          ...scene.nodes.filter((n) => n.row >= 0).map((n) => n.y + n.h),
        ),
      ),
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
    "chainSolidTV(config, { target: 'android-tv' });",
    `chainSolidTV(config, { target: 'android-tv' });
config.plugin('CopyWebpackPlugin').tap(args => { args[0].patterns.push({from:path.resolve(__dirname,'gallery'),to:'gallery'}); return args; });`,
  ),
);
cpSync(
  new URL('./tv-workload.tsx', import.meta.url),
  path.join(root, videoArchive ? 'src/gallery.tsx' : 'src/app.tsx'),
);
if (videoArchive) {
  cpSync(
    new URL('./mixed-workload.tsx', import.meta.url),
    path.join(root, 'src/app.tsx'),
  );
  cpSync(
    new URL('../cli/media/clip.mp4', import.meta.url),
    path.join(assets, 'clip.mp4'),
  );
}

const surface = values['texture-view']
  ? 'texture-view'
  : values['surface-view']
    ? 'surface-view'
    : undefined;
if (surface) {
  writeFileSync(
    path.join(root, 'targets/android-tv/app/app.ts'),
    `import { runAndroidTV } from '@solid-multiplatform/platform/android-tv';
runAndroidTV(async host => {
  const app = await import('../work/main');
  return { mount: () => app.mount(host) };
}, { surface: '${surface}' });
`,
  );
}
