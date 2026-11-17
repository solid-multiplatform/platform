import { createSignal, onCleanup } from 'solid-js';
import {
  Config,
  createRenderer,
  For,
  loadFonts,
  type ElementNode,
} from '@solid-multiplatform/platform';

import { useFocusManager } from '@solid-multiplatform/platform/focusManager';

export interface Plugin {
  run(): Promise<string>;
}
export type Plugins = Record<string, Plugin>;

// Commands stay behind the target-specific binding. Shared components consume this API.
export function mount(plugins: Plugins, fontRoot?: string) {
  const fonts =
    fontRoot &&
    loadFonts([
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasUrl: fontRoot + '/Lato-Regular.msdf.png',
        atlasDataUrl: fontRoot + '/Lato-Regular.msdf.json',
      },
    ]);
  if (fontRoot) Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  const { render } = createRenderer();
  if (fonts) void fonts.catch((error) => console.error(error));
  let view!: ElementNode;
  const dispose = render(() => {
    useFocusManager();
    const rows: ElementNode[] = [];
    const [message, setMessage] = createSignal('__APP_NAME__');
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const run = async (name: string) => {
      try {
        const value = await plugins[name]!.run();
        if (active) setMessage(value);
      } catch (error) {
        if (active) setMessage(String(error));
      }
    };
    return (
      <view ref={view}>
        <text x={48} y={48}>
          {message()}
        </text>
        <For each={Object.keys(plugins)}>
          {(name, index) => (
            <text
              ref={(node) => {
                rows[index()] = node;
              }}
              x={48}
              y={120 + index() * 56}
              autofocus={index() === 0}
              focus={{ color: 0x4fb3ffff }}
              onDown={() => {
                rows[(index() + 1) % rows.length]?.setFocus();
                return true;
              }}
              onUp={() => {
                rows[(index() + rows.length - 1) % rows.length]?.setFocus();
                return true;
              }}
              onEnter={() => {
                void run(name);
                return true;
              }}
              onClick={() => {
                void run(name);
              }}
            >
              {name}
            </text>
          )}
        </For>
      </view>
    );
  });
  return () => {
    dispose();
    if (view.parent) {
      view.parent.removeChild(view);
      view.destroy();
    }
  };
}
