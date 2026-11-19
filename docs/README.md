# Documentation

This site is the whole documentation of Solid Multiplatform: one SolidJS scene on Roku, browser TVs (Tizen, webOS, Vizio), PlayStation 4, Android and Android TV, iOS and tvOS, desktop and the web. The full page list is the sidebar ([\_sidebar.md](_sidebar.md)); this page says what each group holds, so you know where to look.

## Start

- [Getting started](/getting-started.md): the CLI, the layout of an app it creates, and how each target is built and run.
- [The app API](/app-api.md): every component, hook and setting an application uses, on one page.
- [Architecture](/architecture.md): the packages, the scene, host and CLI contracts, and the frame loop.
- [Feature matrix](/features.md): what is tested on which target (see below).
- [Migrating](/migrate.md): coming from `@lightningtv/solid` or `@solidtv/solid`.

## Writing UI

How a scene is composed: starting an app, components, `ElementNode`, layout, styling, states, theming, effects, text, images, events, focus and keys, transitions, screen resolution and the task scheduler. Read layout and styling before the rest; every page assumes them.

## Primitives

One page per layout and list primitive — `Row` and `Column`, `Grid`, the virtual and lazy lists, the router, `KeepAlive`, `Portal`, `Visible`, `Image`, and the rest — plus the input helpers: `useFocusManager`, the focus stack, `useHold`, `useMouse` and the `Announcer`.

## Services

The [SDK](/services.md): device features (battery, connectivity, notifications, secure storage, …) behind one registry, with a provider per target, and how to add a provider.

## Extending

- [Add a host](/add-a-host.md): bring up a new platform.
- [Add a renderer backend](/add-a-backend.md): bring up a new graphics model.

## Targets

One page per target — what it is built from, how it is tested, and what is still in progress — starting from the [overview](/targets/README.md), which also lists the CI jobs: web, browser TVs, PlayStation 4, Roku, Android and Android TV, iOS and tvOS, desktop.

## Performance

[The rule and how to measure it](/performance.md): zero missed frames, nothing scheduled while a scene is idle. The [bench methodology](/perf/README.md) and the recorded Android TV measurements follow it.

## Tooling and project

The [JSX locator](/tools/jsx_locator.md), [contributing](/contributing.md) and [releasing](/releasing.md).

## The feature matrix

The [feature matrix](/features.md) is generated from [features.json](features.json) by `scripts/feature-matrix.mjs`. A cell says `tested` only when it names an automated test that runs that feature on that target; without that evidence a feature is `preview` or `unavailable`. Change the JSON and run `node scripts/feature-matrix.mjs`; never edit the Markdown by hand.
