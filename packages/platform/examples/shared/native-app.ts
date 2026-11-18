import { Config, loadFonts } from '@solid-multiplatform/platform';
import { mount as mountFixture } from './app';

/** Native WebGL fixtures bundle the same SDF atlas used by the Chromium tests. */
export function mount() {
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  const ready = loadFonts([
    {
      type: 'msdf',
      fontFamily: 'Lato',
      atlasDataUrl: 'file:///app/fonts/Lato-Regular.msdf.json',
      atlasUrl: 'file:///app/fonts/Lato-Regular.msdf.png',
    },
  ]);
  const dispose = mountFixture();
  void ready.catch((error) =>
    console.error('Fixture font failed to load', error),
  );
  return dispose;
}
