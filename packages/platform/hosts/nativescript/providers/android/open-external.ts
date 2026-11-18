import type { OpenExternalPort } from '../../../../src/sdk/device.js';
import { CapabilityError } from '@solid-multiplatform/platform/services';
import { activityOf, type AndroidApp } from './runtime.js';

/**
 * `ACTION_VIEW`. A web address carries the Custom Tabs session extra, so a
 * browser that has them opens it as a tab over the app; any other browser
 * and any other scheme open as usual.
 */
export function openExternal(app: AndroidApp): OpenExternalPort {
  return {
    async open(url) {
      const intent = new android.content.Intent(
        android.content.Intent.ACTION_VIEW,
        android.net.Uri.parse(url),
      );
      if (/^https?:/i.test(url)) {
        const extras = new android.os.Bundle();
        extras.putBinder('android.support.customtabs.extra.SESSION', null);
        intent.putExtras(extras);
      }
      try {
        activityOf(app).startActivity(intent);
      } catch (error) {
        if (
          (error as { nativeException?: unknown }).nativeException instanceof
          android.content.ActivityNotFoundException
        )
          throw new CapabilityError('openExternal');
        throw error;
      }
    },
  };
}
