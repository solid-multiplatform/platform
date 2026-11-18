import { createSignal } from 'solid-js';
import {
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
Config.fontSettings = {
  fontFamily: canvas ? 'sans-serif' : 'Lato',
  fontSize: 22,
};
const { renderer, render } = createRenderer(settings as never, 'app');
const [moved, move] = createSignal(false);
const [width, setWidth] = createSignal(320);
async function run() {
  if (canvas)
    await renderer.stage.loadFont('canvas', { fontFamily: 'sans-serif' });
  else
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
      <text
        x={16}
        y={94}
        fontFamily={canvas ? 'sans-serif' : 'Lato'}
        fontSize={22}
        color={0xffffffff}
      >
        {moved() ? 'I' : 'Wide label'}
      </text>
      <view x={width() - 16} y={170} width={8} height={12} color={0x90a8f0ff} />
    </view>
  ));
  Object.assign(window, {
    visual: {
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
