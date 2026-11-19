# Getting started

This page takes you from an empty directory to a running web build. The `init`, install, `check`, `plugin new` and `build` steps are the ones the CLI smoke test runs in CI: `packages/platform/tests/cli/projects-smoke.sh`.

## Prerequisites

- Node 24. CI runs every job on Node 24.
- pnpm through Corepack. The version is pinned in `packageManager` (`pnpm@10.33.4`); `corepack pnpm` picks it up.
- Per target, the device toolchain: see the [target pages](/targets/README.md). The web target needs nothing else.

## Get the CLI

The CLI is `solid-platform`. It is the `bin` of `@solid-multiplatform/platform` and lives in `packages/platform/cli`.

Releases are published as package archives on GitHub Releases, and on npm when the repository has a token. Until you install from one of those, run the CLI from a checkout:

```sh
git clone https://github.com/solid-multiplatform/platform.git
cd platform
corepack pnpm install
corepack pnpm build
```

`init` refuses to run from a checkout that has not been built.

## Create an app

```sh
node packages/platform/cli/main.mjs init ../living-room --targets web,tizen,roku
cd ../living-room
corepack pnpm install
```

- The directory must not exist. Its name becomes the app name: lowercase letters, digits and hyphens, starting with a letter, at most 50 characters.
- `--targets` is a comma-separated list of `web`, `tizen`, `webos`, `vizio`, `roku`, `android-tv`, `android`, `apple-tv`, `ios`, `desktop`. The default is `web`.
- `init` packs the platform and renderer packages into the app's `vendor/` directory and depends on them by file path. The app builds without a registry.

Inside the app, the CLI is the `platform` script. `build`, `dev` and `check` have their own scripts:

```sh
corepack pnpm platform --help
corepack pnpm check
corepack pnpm build web
corepack pnpm dev web
```

## The app

The whole starter is `src/app.tsx`: one component, default-exported.

```tsx
import {
  Button,
  List,
  Screen,
  Text,
  createSignal,
  usePlugins,
} from '@solid-multiplatform/platform/app';

export default function App() {
  const plugins = usePlugins<{ run(): Promise<string> }>();
  const [message, setMessage] = createSignal('living-room');
  const [count, setCount] = createSignal(0);
  const run = (name: string) =>
    void plugins[name]!.run().then(setMessage, (error) =>
      setMessage(String(error)),
    );
  return (
    <Screen>
      <Text size="title">{message()}</Text>
      <Button onPress={() => setCount(count() + 1)}>
        {`Pressed ${count()} times`}
      </Button>
      <List each={Object.keys(plugins)} onSelect={run}>
        {(name) => <Button>{name}</Button>}
      </List>
    </Screen>
  );
}
```

- `Screen` fills the viewport, keeps its children inside the safe area and stacks them. No coordinates and no viewport arithmetic: the same file runs on a TV, in a browser window and on a phone.
- `Button` is as wide as its label. A remote's OK key, Enter, a mouse click and a tap all call `onPress`, and a screen reader sees a button with that label.
- `List` moves focus through its items with the arrow keys and reports the one that was activated.
- `usePlugins` gives the plugins of the target being built. Nothing is passed into `App`.

There is no `mount` function. The CLI generates each target's entry in `targets/<target>/work`, and that entry starts the component on the target's host with the fonts, design size and theme from `solid-platform.config.json`. [The app API](/app-api.md) lists every component, hook and setting.

## Project layout

```text
living-room/
  solid-platform.config.json  name, targets, and the app's fonts, design size and theme
  package.json                scripts: platform, check, build, dev
  tsconfig.json               jsxImportSource: @solid-multiplatform/platform
  src/
    app.tsx                   the app: a default-exported component
  assets/fonts/               the Lato MSDF font; every atlas here is loaded
  plugins/                    created by "plugin new"
  vendor/                     the packed platform and renderer archives
  targets/
    web/                      package.json, index.html, vite.config.mjs, public/
    <target>/work/            generated on every build; do not edit
```

You write code in `src/` and `plugins/`. Each `targets/<target>` directory is a small project of its own with its own install. The CLI regenerates `targets/<target>/work` on every build and refuses to delete a `work` directory it did not create.

### Target variants

One adaptive screen is the default. When a target needs its own layout, add a file with a suffix next to the shared one, such as `app.tv.tsx` beside `app.tsx`, or `screens/Home.mobile.tsx` beside `screens/Home.tsx`, and import the module as usual (`./screens/Home`). Before a build, the CLI copies `src/` into the target's `work/src` and picks one file per module by suffix:

- the exact target first (`Home.roku.tsx`),
- then its family: `tv` for `roku`, `apple-tv`, `android-tv`, `tizen`, `webos` and `vizio`; `mobile` for `android` and `ios`; `desktop` for a desktop build,
- then the file without a suffix.

`web` has no family: it takes `Home.web.tsx` or the file without a suffix. Ask the CLI which file a target gets:

```sh
corepack pnpm platform explain roku app
```

`corepack pnpm check` type-checks the selected sources of every configured target. `corepack pnpm check roku` checks one.

## Build a target

Run `corepack pnpm build <target>` from the app directory. The target must be listed in `solid-platform.config.json`.

- `web` runs `vite build` in `targets/web`. Output: `targets/web/dist`.
- `tizen`, `webos`, `vizio` run the same Vite build, then package it. Tizen gets a `config.xml`; when `TIZEN_SECURITY_PROFILE` names a signing profile, the Tizen CLI produces a signed WGT. webOS gets an `appinfo.json` and `ares-package` writes an IPK to `dist-package`. Vizio output is the web assets in `dist`.
- `build <tizen|webos|vizio> --legacy` builds the Canvas 2D variant for old browser engines into `dist-legacy`. `--legacy` is rejected for every other target.
- `roku` runs the Roku SDK build and zips it. Output: `targets/roku/dist-roku/solid-multiplatform.zip`. It needs `python3`.
- `android` and `android-tv` run `ns build android`. They need JDK 21 and the Android SDK.
- `ios` and `apple-tv` run `ns build ios` or `ns build tvos` for the simulator. They need macOS and Xcode.
- `desktop` builds into `targets/desktop/work`. The desktop host on `main` is being replaced; see [Desktop](/targets/desktop.md).

`corepack pnpm dev <target>` works for `web` and `desktop` only. For device targets, build the package and launch it with the device's own SDK.

Only one build per target runs at a time. If a build was interrupted, the CLI tells you which `targets/<target>/.solid-build.lock` directory to remove.

## Run the web target

```sh
corepack pnpm dev web
```

This runs the Vite dev server in `targets/web`. For a production build, run `corepack pnpm build web` and serve `targets/web/dist` with any static file server. The page draws into the element with id `app`.

## Add a plugin

A plugin is app-owned native code behind a named command, one implementation per target.

```sh
corepack pnpm platform plugin new greeting
```

This creates `plugins/greeting` with an implementation for each configured target. Use `--targets` to limit the list, and `--android-kind kotlin|sidecar|service|jni` to choose the Android flavour. The app reads the plugins of the target being built with `usePlugins()`, or one of them with `usePlugin('greeting')`; the starter shows a button for each.

## Next

- [The app API](/app-api.md): components, hooks, services and settings on one page.
- [Architecture](/architecture.md): how the pieces fit.
- [Layout](/flow/layout.md) and [Styling](/essentials/styling.md): writing UI.
- [Services](/services.md): calling device features.
- [Feature matrix](/features.md): what is tested on which target.
