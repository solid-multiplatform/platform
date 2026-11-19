// What the generated entry of a target needs to know about the app: whether
// src/app is a component (a default export) or an older app that exports
// `mount`, and the project's `app` settings as source text for that target.
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { project } from './files.mjs';
import { variantOrder } from './variants.mjs';

/**
 * How the staged `src/app` starts. `component`: it default-exports the app's
 * component and the entry does the wiring. `options`: it also exports
 * `options`, which override the project's `app` settings.
 */
export function appModule(work) {
  const file = ['tsx', 'ts', 'jsx', 'js']
    .map((ext) => path.join(work, 'src/app.' + ext))
    .find((candidate) => existsSync(candidate));
  const source = file ? readFileSync(file, 'utf8') : '';
  const exports = (name) =>
    new RegExp(
      `^\\s*export\\s+(?:const|let|var|function)\\s+${name}\\b`,
      'm',
    ).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source);
  return {
    component:
      /^\s*export\s+default\b/m.test(source) ||
      /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source),
    options: exports('options'),
  };
}

// Without `app.fonts`, every font of the project is loaded: an MSDF atlas in
// assets/fonts, or on Roku a font file in targets/roku/fonts. The family is
// the file name up to its first hyphen or dot (Lato-Regular.msdf.json: Lato).
function projectFonts(root, target) {
  const configured = project(root).app.fonts;
  if (configured) return configured;
  const dir = path.join(
    root,
    target === 'roku' ? 'targets/roku/fonts' : 'assets/fonts',
  );
  const suffix = target === 'roku' ? /\.(ttf|otf)$/ : /\.json$/;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => suffix.test(name))
    .sort()
    .map((name) => ({
      family: name.split(/[-.]/)[0],
      ...(target === 'roku'
        ? { file: name }
        : { atlas: name.replace(suffix, '') }),
    }));
}

/**
 * The `settings` argument of `appEntry` for `target`, as source text, with
 * the imports it needs. `fontRoot` is a JavaScript expression for where the
 * target serves assets/fonts; without it (Canvas 2D) no atlas is loaded.
 */
export function appSettings(root, target, fontRoot) {
  const { designSize, theme } = project(root).app;
  const imports = [];
  const fonts = [];
  for (const [i, font] of projectFonts(root, target).entries()) {
    const family = JSON.stringify(font.family);
    if (target === 'roku') {
      // Roku draws text from font files, which the bundle imports.
      if (
        !font.file ||
        !existsSync(path.join(root, 'targets/roku/fonts', font.file))
      )
        continue;
      imports.push(
        `import font${i} from ${JSON.stringify('../fonts/' + font.file)};`,
      );
      fonts.push(`{ fontFamily: ${family}, fontUrl: font${i} }`);
    } else if (font.atlas && fontRoot) {
      const url = (ext) => `${fontRoot} + ${JSON.stringify('/' + font.atlas + ext)}`;
      fonts.push(
        `{ type: 'msdf', fontFamily: ${family}, atlasUrl: ${url('.png')}, atlasDataUrl: ${url('.json')} }`,
      );
    }
  }
  const settings = [`fonts: [${fonts.join(', ')}]`];
  // A design size describes a TV screen; phones and windows keep their units.
  if (designSize && variantOrder(target).includes('tv'))
    settings.push(`designSize: ${JSON.stringify(designSize)}`);
  if (theme) settings.push(`theme: ${JSON.stringify(theme)}`);
  return { imports: imports.join('\n'), settings: `{ ${settings.join(', ')} }` };
}

/**
 * The Roku entry of a component app. Roku is the one target whose host is
 * reached directly rather than through the generated `mount` wrapper:
 * `startApp` declares the target, builds the scene renderer, loads fonts and
 * wires the remote, and the app is just its default export.
 */
export function rokuComponentEntry(settings, hasOptions, namespace) {
  return `import { onCleanup } from 'solid-js';
import App${hasOptions ? ', { options }' : ''} from './src/app';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { startApp } from '@solid-multiplatform/platform/host';
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { plugins } from './plugins.mjs';
import { rokuHost, rokuKeyMap } from '@solid-multiplatform/platform/roku';
const entry = appEntry(App, plugins, ${settings}${hasOptions ? ', options' : ''});
startApp(
  rokuHost({ namespace: ${JSON.stringify(namespace)} }),
  (context) => {
    onCleanup(
      attachPlugins(plugins, { target: 'roku', root: context.native as object }),
    );
    return entry.root();
  },
  { ...entry.options, keyMap: rokuKeyMap },
);
`;
}

/**
 * The body of a generated `mount(host)` for a component app on a target
 * whose host installs its renderer itself (Android, iOS, tvOS, desktop):
 * the same statement on each of them.
 */
export function mountComponent(settings, hasOptions, pointer = 'host.input') {
  return `const entry = appEntry(App, plugins, ${settings}${hasOptions ? ', options' : ''});
    const dispose = mountApp(
      entry.root,
      { keys: host.keys, pointer: ${pointer}, semantics: host.semantics, target: host.target, native: host.root },
      entry.options,
    );`;
}

/** The NativeScript form each native target starts its host with. */
export const NATIVE_FORMS = {
  android: 'phone',
  'android-tv': 'tv',
  ios: 'ios',
  'apple-tv': 'tvOS',
};

/**
 * The body of a generated `mount(host)` for a component app on a
 * NativeScript target: one `HostDefinition` per form, started through
 * `startApp` like every other host. `host` is the surface the target's
 * bootstrap already made (Canvas, key bridge, touch scope, editor host);
 * the host adopts it, so the app and the host both keep working.
 */
export function nativeComponent(settings, hasOptions, form) {
  return `const entry = appEntry(App, plugins, ${settings}${hasOptions ? ', options' : ''});
    const stop = startApp(
      nativeHost({ form: ${JSON.stringify(form)}, host }),
      () => entry.root(),
      entry.options,
    );`;
}
