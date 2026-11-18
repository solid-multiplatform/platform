import {
  Config,
  createRenderer,
  loadFonts,
  For,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { createSignal } from 'solid-js';
import scenes from './scenes.json';
import { File, knownFolders } from '@nativescript/core';

export function mount(_plugins, fontRoot) {
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 30 };
  const ready = loadFonts([
    {
      type: 'msdf',
      fontFamily: 'Lato',
      atlasUrl: fontRoot + '/Lato-Regular.msdf.png',
      atlasDataUrl: fontRoot + '/Lato-Regular.msdf.json',
    },
  ]);
  const { render } = createRenderer();
  const [dense, setDense] = createSignal(0);
  let rail: ElementNode, root: ElementNode;
  const color = (s: string) => parseInt(s.slice(1).padEnd(8, 'f'), 16);
  const item = (n) =>
    n.caption ? (
      <text
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        fontSize={n.font}
        color={color(n.color)}
      >
        {n.caption}
      </text>
    ) : (
      <view
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        src={n.src}
        color={color(n.color)}
        alpha={n.opacity}
      />
    );
  const dispose = render(() => (
    <view ref={root} width={1920} height={1080}>
      <For
        each={scenes[dense()].nodes.filter(
          (n) =>
            n.backgroundSlot !== undefined ||
            n.src?.endsWith('/mask-black.png'),
        )}
      >
        {item}
      </For>
      <view ref={rail}>
        <For
          each={scenes[dense()].nodes.filter(
            (n) => n.kind !== 2 && n.kind !== 3,
          )}
        >
          {item}
        </For>
      </view>
      <For
        each={scenes[dense()].nodes.filter(
          (n) =>
            (n.kind === 2 || n.kind === 3) &&
            n.backgroundSlot === undefined &&
            !n.src?.endsWith('/mask-black.png'),
        )}
      >
        {item}
      </For>
    </view>
  ));
  // Advance only on navigation ticks. The renderer interpolates the rail between ticks.
  let count = 0;
  const timer = setInterval(() => {
    if (count && count % 32 === 0) setDense((d) => 1 - d);
    const y = -scenes[dense()].offsets[count % 32];
    rail.lng.animateProp('y', y, { duration: 300, easing: 'ease-in-out' });
    count++;
  }, 500);
  void ready.then(() =>
    File.fromPath(knownFolders.documents().path + '/workload-ready').writeText(
      'gallery',
    ),
  );
  return () => {
    clearInterval(timer);
    dispose();
    root.destroy();
  };
}
