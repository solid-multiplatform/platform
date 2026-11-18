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
  const { render, renderer } = createRenderer();
  const [dense, setDense] = createSignal(0);
  let rail: ElementNode, root: ElementNode, header: ElementNode;
  const loaded = new WeakSet<ElementNode>(),
    inventory: object[] = [];
  const output = (name: string, value: unknown) =>
    File.fromPath(knownFolders.documents().path + '/' + name).writeText(
      JSON.stringify(value),
    );
  const attached = (node: ElementNode) => {
    if (node.src) node.lng.on('loaded', () => loaded.add(node));
  };
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
        onRender={attached}
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
      <view ref={rail} width={1920} height={scenes[dense()].contentHeight}>
        <For
          each={scenes[dense()].nodes.filter(
            (n) => n.kind !== 2 && n.kind !== 3,
          )}
        >
          {item}
        </For>
      </view>
      <view ref={header} width={1920} height={500}>
        <For each={scenes[dense()].nodes.filter((n) => n.kind === 2)}>
          {item}
        </For>
      </view>
      <For
        each={scenes[dense()].nodes.filter(
          (n) =>
            n.kind === 3 &&
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
    header.lng.animateProp(
      'alpha',
      scenes[dense()].selected[count % 32] === 0 ? 1 : 0,
      { duration: 250 },
    );
    const step = count % 32,
      mode = dense();
    if (count < 64)
      setTimeout(() => {
        const backend = root.lng.children;
        const back = root.children.find((n) => n.src?.includes('w1280-'));
        const cards = rail.children.filter(
          (n) => n.src && n.lng.renderState === 8,
        );
        const sample = {
          mode,
          step,
          position: rail.lng.y,
          contentHeight: rail.height,
          foreground: backend.indexOf(rail.lng) > backend.indexOf(back?.lng),
          visible: cards.length,
          loaded: cards.filter((n) => loaded.has(n)).length,
        };
        inventory.push(sample);
        if (inventory.length === 64) {
          void output('inventory.json', inventory);
          if (
            inventory.every(
              (s) => s.foreground && s.visible > 0 && s.loaded > 0,
            )
          ) {
            void ready.then(() =>
              File.fromPath(
                knownFolders.documents().path + '/workload-ready',
              ).writeText('gallery'),
            );
          }
        }
      }, 410);
    count++;
  }, 500);
  const gl = renderer.canvas.getContext('webgl2');
  void output('geometry.json', {
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    samples: gl.getParameter(gl.SAMPLES),
    view: [
      renderer.canvas.android.getWidth(),
      renderer.canvas.android.getHeight(),
    ],
  });
  return () => {
    clearInterval(timer);
    dispose();
    root.destroy();
  };
}
