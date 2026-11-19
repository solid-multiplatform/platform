// The generated entry: how src/app is recognised as a component or as an
// older `mount` app, and the settings each target's entry starts it with.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appModule,
  appSettings,
  mountComponent,
} from '../../../cli/app-entry.mjs';
import { scratch } from './helpers.mjs';

const config = (app) =>
  JSON.stringify({ name: 'demo', targets: ['web', 'roku', 'android-tv'], app });
const atlas = { 'assets/fonts/Lato-Regular.msdf.json': '{}' };

test('a default export makes src/app a component; `options` is noticed', (t) => {
  const kinds = {
    'export default function App() {}': { component: true, options: false },
    'const App = () => null;\nexport default App;\nexport const options = {};':
      { component: true, options: true },
    'function App() {}\nconst options = {};\nexport { App as default, options };':
      { component: true, options: true },
    // An app from before the component entry, and a mention in a comment.
    '// export default was not used\nexport function mount(plugins) {}\nexport function appOptions() {}':
      { component: false, options: false },
  };
  for (const [source, expected] of Object.entries(kinds)) {
    const work = scratch(t, { 'src/app.tsx': source });
    assert.deepEqual(appModule(work), expected, source);
  }
  assert.deepEqual(appModule(scratch(t)), { component: false, options: false });
});

test('fonts default to the atlases in assets/fonts, addressed where the target serves them', (t) => {
  const root = scratch(t, {
    'solid-platform.config.json': config({ theme: 'dark' }),
    ...atlas,
    'assets/fonts/Lato-Regular.msdf.png': '',
  });
  assert.deepEqual(appSettings(root, 'web', "'./fonts'"), {
    imports: '',
    settings:
      `{ fonts: [{ type: 'msdf', fontFamily: "Lato", atlasUrl: './fonts' + "/Lato-Regular.msdf.png", ` +
      `atlasDataUrl: './fonts' + "/Lato-Regular.msdf.json" }], theme: "dark" }`,
  });
  // Canvas 2D has no font root: no atlas is loaded.
  assert.equal(
    appSettings(root, 'tizen', undefined).settings,
    '{ fonts: [], theme: "dark" }',
  );
});

test('the design size reaches TV targets only', (t) => {
  const root = scratch(t, {
    'solid-platform.config.json': config({
      designSize: { width: 1920, height: 1080 },
    }),
  });
  const size = 'designSize: {"width":1920,"height":1080}';
  for (const target of ['tizen', 'webos', 'vizio', 'roku', 'android-tv', 'apple-tv'])
    assert.ok(appSettings(root, target, "'r'").settings.includes(size), target);
  for (const target of ['web', 'android', 'ios', 'desktop'])
    assert.equal(appSettings(root, target, "'r'").settings, '{ fonts: [] }', target);
});

test('Roku imports font files; `app.fonts` replaces the convention', (t) => {
  const root = scratch(t, {
    'solid-platform.config.json': config({
      fonts: [
        { family: 'Brand', atlas: 'Brand.msdf', file: 'Brand.ttf' },
        { family: 'Gone', file: 'Missing.ttf' },
      ],
    }),
    ...atlas,
    'targets/roku/fonts/Brand.ttf': '',
    'targets/roku/fonts/Lato-Regular.ttf': '',
  });
  assert.deepEqual(appSettings(root, 'roku', "'pkg:/fonts'"), {
    imports: 'import font0 from "../fonts/Brand.ttf";',
    settings: '{ fonts: [{ fontFamily: "Brand", fontUrl: font0 }] }',
  });
  assert.match(
    appSettings(root, 'android-tv', "'file:///app/fonts'").settings,
    /^\{ fonts: \[\{ type: 'msdf', fontFamily: "Brand", atlasUrl: 'file:\/\/\/app\/fonts' \+ "\/Brand\.msdf\.png"/,
  );
  // Without `app.fonts`, Roku loads what is in targets/roku/fonts.
  const plain = scratch(t, {
    'solid-platform.config.json': config(undefined),
    'targets/roku/fonts/Lato-Regular.ttf': '',
    'targets/roku/fonts/Lato-OFL.txt': '',
  });
  assert.deepEqual(appSettings(plain, 'roku', "'pkg:/fonts'"), {
    imports: 'import font0 from "../fonts/Lato-Regular.ttf";',
    settings: '{ fonts: [{ fontFamily: "Lato", fontUrl: font0 }] }',
  });
});

test('every self-rendering host mounts a component with the same statement', () => {
  const body = mountComponent('{ fonts: [] }', true);
  assert.match(body, /appEntry\(App, plugins, \{ fonts: \[\] \}, options\)/);
  assert.match(
    body,
    /mountApp\(\s*entry\.root,\s*\{ pointer: host\.input, semantics: host\.semantics, target: host\.target, native: host\.root \},\s*entry\.options,\s*\)/,
  );
  // The desktop scene owns its input scope.
  assert.match(mountComponent('{}', false, 'input'), /pointer: input,/);
  assert.doesNotMatch(mountComponent('{}', false), /options\)/);
});
