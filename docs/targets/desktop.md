# Desktop

Target name: `desktop`. The feature matrix splits it into `desktop-linux`, `desktop-windows` and `desktop-macos`.

## Status: tested on Linux; preview on Windows and macOS

The desktop target runs a Solid Multiplatform component app in a native runtime written in Rust that embeds Hermes and draws the scene with WebGL through SDL3. **No Node.js runs the app.** Node is a build tool: it bundles the entry and, by calling the runtime, compiles Hermes bytecode. The executable that opens the window contains the JavaScript engine and the scene renderer; the app's code is the bytecode. The generated entry is `startApp(desktopHost(), App, options)`, and the host supplies router history.

Linux is the only system verified end to end. The `desktop-runtime` workflow ("Desktop runtime", `linux` job) builds the runtime and runs the host suite on a virtual display. Windows and macOS builds exist in the runtime's source but are not covered by a CI job that opens a window.

## Add it to an app

```sh
solid-platform init my-app --targets desktop
cd my-app
solid-platform add desktop <solid-multiplatform-host-desktop-<version>.tgz>
corepack pnpm install
corepack pnpm build desktop
corepack pnpm platform run desktop
```

`add desktop` installs `@solid-multiplatform/host-desktop` from a release archive (a local `.tgz` or an `https://` URL) and writes a `file:` dependency into `package.json`, as `add video` does.

With no archive it fetches only the runtime: `solid-platform add desktop none` downloads `solid-desktop-<platform>-<arch>.tar.gz` from the latest GitHub release and puts `solid-desktop` at `node_modules/@solid-multiplatform/host-desktop/prebuilt/<platform>-<arch>/solid-desktop`, where the host's CLI looks for it. `SOLID_DESKTOP_RUNTIME` takes precedence over everything and is used as given.

The build tool for the target is the desktop host's own CLI (`@solid-multiplatform/host-desktop/cli`). It bundles `src/app.tsx` through the Solid universal renderer and the WebGL backend, then compiles the result to `targets/desktop/work/bundle/app.hbc`.

## Commands

- `solid-platform build desktop` writes `targets/desktop/work/bundle/app.hbc` and copies the app's fonts beside it.
- `solid-platform run desktop` builds, then starts the app in the runtime.
- `solid-platform dev desktop` builds and opens the app.
- `solid-platform package desktop` makes a relocatable Linux directory and `.tar.gz`: the runtime as `bin/<name>`, the bytecode and assets under `resources/`, and a `.desktop` launcher entry.
- `solid-platform plugins run desktop` bundles the plugin fixture and runs it **headless** in the runtime; it opens no window.
- `solid-platform add desktop …` installs the host and its runtime (above).

The runtime binary resolves as: `SOLID_DESKTOP_RUNTIME`, then the host package's `prebuilt/<platform>-<arch>/solid-desktop`, then a source build when `HERMES_SRC`, `HERMES_BUILD` and `cargo` are available.

Screen variants ending in `.linux`, `.windows`, `.macos` or `.desktop` are selected by the OS the build runs on.

## Internationalization

Hermes on Linux has no `Intl`. The runtime supplies it from ICU4X (`packages/host-desktop/native/src/intl.rs`), with the data compiled into the executable, and a thin spec-shaped layer (`packages/host-desktop/src/web/intl.ts`) installs it beside the other web globals. It is defined only when the engine has none, builds no formatter until an app asks for one, and caches instances by their serialized locale and options.

- `Intl.PluralRules`: `select`, `resolvedOptions`.
- `Intl.NumberFormat`: decimal, currency, percent and unit styles, grouping, fraction digits, `formatToParts`.
- `Intl.DateTimeFormat`: date and time styles or individual fields, `formatToParts`, and time zones from the system's IANA database (`TZ` is applied for the call and restored).
- `Intl.RelativeTimeFormat`, `Intl.ListFormat`: `format`, `formatToParts`, `resolvedOptions`.
- `Intl.Collator`: sorting only (`compare`), no options.
- `Intl.getCanonicalLocales`; invalid language tags throw `RangeError`.

`encodings` and `numberingSystem` are the locale's defaults; compact notation, significant digits, non-default hour cycles and `Intl.DisplayNames` are not implemented (the SDK already treats display names as optional). `style: "unit"` appends a short unit symbol from a small table. Every CLDR locale is compiled in, so no data file ships and adding a locale is not a build step. The formatters cost about 2 MB of the executable.

## How it is tested

- `packages/platform/tests/cli/desktop-smoke.sh` packs the platform and the host, generates an app, installs the host, builds bytecode, and runs it under `xvfb-run` with the runtime's `--first-frame-exit`: the runtime prints `first frame presented` and ends, so no window is left open. It skips with one line when `xvfb-run` or a built runtime is absent.
- `packages/platform/tests/cli/projects-smoke.sh` builds the desktop target of the generated app when a runtime is available (build only, no window).
- `packages/host-desktop/tests/run.sh` runs the runtime's Rust tests, the host adapter, the web-standard globals, the real scene against Chromium, an app through the host (input, text fields, services, idle, closing), a packaged app moved and run from its archive, accessibility over AT-SPI and the session services.
- `.github/workflows/desktop-runtime.yml` builds Hermes, SDL3, the runtime and the static-SDL release archive, then runs those tests on a virtual display.
- `packages/platform/tests/cli/unit/{add-desktop,desktop-target}.test.mjs` test runtime/asset resolution with a faked fetch and filesystem, and the desktop command dispatch.

On Linux the host suite covers the generated entry through `startApp(desktopHost())`: keys and focus (including real X events through xdotool), pointers and the wheel, text fields, the services (`settings`, `lifecycle`, `links`, `request`, `clipboard`, `share`/`haptics` only as absent, `deviceInfo`, `battery`, `memory`, `keepAwake`, `openExternal`, `locale`, `colorScheme`, `keyEvents`, `download`, `filePicker`, `fileSystem`), notifications and connectivity on a test bus, the idle rule, packaging, and the AccessKit tree over AT-SPI. `connectivity` and `notifications` need a stand-in on the test bus; `secureStorage` is not tested because the app must pass a keyring module.

What this does not cover:

- Windows and macOS merely build; no CI job opens a window there, and their packaging is not implemented.
- The GitHub release download path in `add desktop none` is unit-tested through a fake fetch, not against the live GitHub API.
- No AppImage is produced.

The feature matrix marks the Linux cells `tested`; the Windows and macOS cells remain `preview`.
