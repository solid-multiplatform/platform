import type { LinksPort } from '../../../../src/sdk/services.js';
import type { AndroidApp, AndroidAppEvents } from './runtime.js';

/**
 * The link the app was opened with, and the ones that arrive while it runs
 * (`onNewIntent`). The app declares the intent filter for its own scheme or
 * verified domain in its manifest.
 */
export function links(app: AndroidApp): LinksPort {
  const link = (intent: android.content.Intent | null | undefined) =>
    intent?.getDataString() ?? null;
  return {
    initial: () =>
      link((app.foregroundActivity ?? app.startActivity)?.getIntent()),
    subscribe(listener) {
      const receive = (data: AndroidAppEvents['activityNewIntent']): void => {
        const value = link(data.intent);
        if (value) listener(String(value));
      };
      app.on('activityNewIntent', receive);
      return () => app.off('activityNewIntent', receive);
    },
  };
}
