# JSX locator

The JSX locator is a Babel plugin in `@solid-multiplatform/platform`. At build
time it adds two props to every component element in your JSX:

- `componentName`: the tag name, for example `"MyButton"`.
- `componentLocation`: `relativePath:line:column`, for example
  `"src/components/MyButton.tsx:12:4"`.

Only capitalized tags are changed. `<view>` and `<text>` are left alone. A prop
you set yourself is not overwritten.

`ElementNode` stores both props. Development tools use them:

- Focus history (see [useFocusManager](/primitives/useFocusManager.md)) labels
  an element by its `id`, or else its `componentName`.
- The Alt+click inspector in development builds prints the name and location
  of the node you click.

## Setup

Add the plugin to the Babel options of `vite-plugin-solid`. Use it in
development only.

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig(({ mode }) => ({
  plugins: [
    solid({
      babel: {
        plugins:
          mode === 'development'
            ? ['@solid-multiplatform/platform/devtools/jsx-locator']
            : [],
      },
      solid: {
        moduleName: '@solid-multiplatform/platform',
        generate: 'universal',
      },
    }),
  ],
}));
```

Keep the other options that your target's `vite.config.mjs` already has. An
app created by `solid-platform init` has one in `targets/web`.

## What the transform does

```tsx
// Source
<MyButton label="Play" />;

// What the component receives
MyButton({
  label: 'Play',
  componentName: 'MyButton',
  componentLocation: 'src/components/App.tsx:8:4',
});
```

The plugin runs in `Program.enter`, before Solid's JSX transform removes the
JSX nodes.
