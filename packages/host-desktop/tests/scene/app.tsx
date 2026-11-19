// The shared fixture (packages/platform/examples/shared/app.tsx) mounted with
// its font, as an app's `mount` would: nothing here knows which host runs it.
import { Config, loadFonts } from '@solid-multiplatform/platform';
import { mount } from '../../../platform/examples/shared/app';

/** Resolves once the font is in: the text has not been laid out before. */
export let fontsReady: Promise<void>;

export function mountFixture(fonts: string): () => void {
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  // Before the renderer exists, as apps do: the download overlaps its boot.
  fontsReady = loadFonts([
    {
      type: 'msdf',
      fontFamily: 'Lato',
      atlasDataUrl: `${fonts}/Lato-Regular.msdf.json`,
      atlasUrl: `${fonts}/Lato-Regular.msdf.png`,
    },
  ]);
  return mount();
}
