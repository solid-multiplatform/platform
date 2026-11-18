# Desktop

Target name: `desktop`. The feature matrix splits it into `desktop-linux`, `desktop-windows` and `desktop-macos`.

## Status: being replaced

There are two desktop hosts, and neither is one to build a product on today.

- **On `main`**: a host that runs on Node with an SDL3 window and native bindings loaded through FFI (`packages/platform/hosts/desktop`). It is being replaced. Do not write new code against it.
- **In progress**: a desktop runtime written in Rust that embeds Hermes and uses no Node. It is in an open pull request. It renders the real scene; input and services are still being worked on. It is not on `main` and you cannot use it yet.

This page documents the first only as far as you need to recognise it.

## What is on `main`

- `init --targets desktop` generates `targets/desktop`. `build desktop` compiles the scene into `targets/desktop/work`; `dev desktop` opens a window; `package desktop` produces an archive for the current OS and architecture.
- `plugins run desktop` runs the plugin command fixture without a window.
- Screen variants ending in `.linux`, `.windows`, `.macos` or `.desktop` are selected by the OS the build runs on.

## How it is tested

- `projects` job: `tests/cli/projects-smoke.sh` runs `plugins run desktop` on Linux and checks the plugin's output. This runs no window and draws nothing.
- `unit` job: `tests/native/desktop-editor.test.mjs`, `tests/desktop-updater.test.mjs` and the `contract-desktop-menu`, `contract-single-instance` and `contract-pwa-desktop` tests, in Node or jsdom with fakes.

What this does not cover:

- No CI job opens a desktop window or checks drawn pixels on any OS.
- `desktop-artifacts.yml` packages the app on Windows and macOS and captures a frame, but only when started by hand. Windows and macOS are not verified by this project.

Treat every desktop feature as `preview` or `in-progress`; the [feature matrix](/features.md) has the detail.
