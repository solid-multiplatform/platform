import { createSignal, onCleanup } from 'solid-js';
import {
  Config,
  createRenderer,
  activeElement,
  loadFonts,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { Home } from './screens/Home';
export interface Plugin {
  run(): Promise<string>;
}
export function mount(
  plugins: Record<string, Plugin>,
  fontRoot?: string,
  pointer?: import('@solid-multiplatform/platform/input').InputScope,
  host?: import('./screen').ScreenHost,
) {
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
  if (fonts) void fonts.catch((e) => console.error(e));
  const names = Object.keys(plugins);
  let root!: ElementNode;
  const dispose = render(() => {
    useFocusManager();
    const [message, setMessage] = createSignal('__APP_NAME__');
    const rows = new Map<string, ElementNode>();
    let active = true,
      generation = 0;
    onCleanup(() => {
      active = false;
    });
    function activate(name: string): true {
      const n = ++generation;
      void Promise.resolve()
        .then(() => plugins[name]!.run())
        .then(
          (v) => {
            if (active && n === generation) setMessage(v);
          },
          (e) => {
            if (active && n === generation) setMessage(String(e));
          },
        );
      return true;
    }
    function register(name: string, node: ElementNode) {
      rows.set(name, node);
      const semantics = host?.semantics?.register({
        bounds: () => ({
          x: node.lng?.absX ?? 0,
          y: node.lng?.absY ?? 0,
          width: node.width ?? 0,
          height: node.height ?? 0,
        }),
        role: 'button',
        label: name,
        focus: () => node.setFocus(),
        activate: () => activate(name),
      });

      if (semantics?.focus) node.onFocus = () => semantics.focus?.();
      const remove = pointer?.register({
        bounds: () => ({
          x: node.lng.absX ?? 0,
          y: node.lng.absY ?? 0,
          width: node.width,
          height: node.height,
        }),
        activate: () => activate(name),
        focus: () => node.setFocus(),
        hover: (v) =>
          v ? node.states.add('$hover') : node.states.remove('$hover'),
        pressed: (v) =>
          v ? node.states.add('$pressed') : node.states.remove('$pressed'),
      });
      onCleanup(() => {
        remove?.();
        semantics?.dispose();
        if (rows.get(name) === node) rows.delete(name);
      });
    }
    function next(offset: number): true {
      const i = names.findIndex((name) => rows.get(name) === activeElement());
      rows
        .get(
          names[
            (Math.max(0, i) + (offset % names.length) + names.length) %
              names.length
          ]!,
        )
        ?.setFocus();
      return true;
    }
    return (
      <view ref={root} width={viewport().width} height={viewport().height}>
        <Home
          host={host}
          names={names}
          message={message}
          viewport={viewport}
          register={register}
          activate={activate}
          next={next}
        />
      </view>
    );
  });
  return () => {
    dispose();
    if (root.parent) {
      root.parent.removeChild(root);
      root.destroy();
    }
  };
}
