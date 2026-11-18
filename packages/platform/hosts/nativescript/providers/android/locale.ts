import type { LocalePort } from '../../../../src/sdk/i18n.js';
import { sdk, type AndroidApp } from './runtime.js';

/** The user's first preferred locale, from the app's `Configuration`. */
export function locale(app: AndroidApp): LocalePort {
  return {
    current() {
      const configuration = app.context.getResources().getConfiguration();
      return (
        sdk() >= 24 ? configuration.getLocales().get(0) : configuration.locale
      ).toLanguageTag();
    },
  };
}
