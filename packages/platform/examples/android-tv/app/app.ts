import { Application } from '@nativescript/core';
import { runAndroidTV } from '@solid-multiplatform/platform/android-tv';
import { renderNativePreview } from './preview.android';

runAndroidTV(async () => {
  const app = await import('../../shared/native-app');
  return {
    mount() {
      const dispose = app.mount();
      const preview = renderNativePreview();
      Application.on('suspend', preview.cancel);
      void preview.pixels
        .then((pixels) => {
          android.util.Log.i(
            'SolidPreview',
            'Native preview RGBA (8x8): ' + pixels,
          );
        })
        .catch((error) => android.util.Log.e('SolidPreview', String(error)))
        .finally(() => Application.off('suspend', preview.cancel));
      return () => {
        preview.cancel();
        dispose();
      };
    },
  };
});
