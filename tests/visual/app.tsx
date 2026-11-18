import { createSignal } from 'solid-js';
import {
  For,
  Config,
  createRenderer,
  loadFonts,
} from '@solid-multiplatform/platform';
import { useCanvas } from '@solid-multiplatform/platform/browser-tv/canvas';
import atlas from '../webgl/fonts/Lato-Regular.msdf.png?url';
import description from '../webgl/fonts/Lato-Regular.msdf.json?url';

const canvas = new URLSearchParams(location.search).has('canvas');
const settings = {
  appWidth: 320,
  appHeight: 200,
  devicePhysicalPixelRatio: window.devicePixelRatio,
  resizable: true,
  numImageWorkers: 0,
};
if (canvas) useCanvas(settings);
else Config.fontSettings = { fontFamily: 'Lato', fontSize: 22 };
const { renderer, render } = createRenderer(settings as never, 'app');
const [moved, move] = createSignal(false);
const [width, setWidth] = createSignal(320);
const [barrier, setBarrier] = createSignal(false);
async function run() {
  if (!canvas)
    await loadFonts([
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasDataUrl: description,
        atlasUrl: atlas,
      },
    ]);
  const source = document.createElement('canvas');
  source.width = source.height = 32;
  const brush = source.getContext('2d')!;
  brush.fillStyle = 'rgb(239,193,75)';
  brush.fillRect(0, 0, 16, 32);
  brush.fillStyle = 'rgba(255,255,255,.5)';
  brush.fillRect(16, 0, 16, 32);
  const src = source.toDataURL();
  render(() => (
    <view width={width()} height={200} color={0x142235ff}>
      <view x={16} y={16} width={64} height={48} color={0x31577aff} clipping>
        <view x={-8} y={12} width={96} height={18} color={0x20b889ff} />
      </view>
      <view
        x={moved() ? 142 : 98}
        y={18}
        width={32}
        height={32}
        color={0xf8654dff}
      />
      <view x={200} y={20} width={32} height={32} src={src} />
      <view x={180} y={90} width={128} height={45}>
        <text x={2} y={4} fontSize={24} color={0xffffffff}>
          Behind
        </text>
      </view>
      <view
        x={180}
        y={90}
        width={128}
        height={45}
        color={moved() ? 0x28394a80 : 0x28394aff}
      />
      <text x={16} y={94} fontSize={22} color={0xffffffff}>
        {moved() ? 'I' : 'Wide label'}
      </text>
      <For each={moved() ? [2] : [1]}>
        {() => (
          <view x={16} y={154} width={66} height={24} color={0x334466ff} />
        )}
      </For>
      <view x={28} y={160} width={30} height={12} color={0x55ddaaff} />
      <view x={width() - 16} y={170} width={8} height={12} color={0x90a8f0ff} />
      <text x={8} y={176} fontSize={17}>
        A
      </text>
      <view
        x={barrier() ? 6 : 205}
        y={176}
        width={19}
        height={20}
        color={0x2b4466ff}
      />
      <text x={65} y={176} fontSize={17}>
        B
      </text>
    </view>
  ));
  Object.assign(window, {
    visual: {
      setBarrier,
      drawOps: () => renderer.ops.length,
      move() {
        move(true);
      },
      resize(w: number, dpr: number) {
        renderer.resize(w, 200, dpr);
        setWidth(w);
      },
    },
  });
}
void run();
