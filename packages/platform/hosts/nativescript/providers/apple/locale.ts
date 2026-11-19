import type { LocalePort } from '@solid-multiplatform/platform/i18n';

/** The first of the user's preferred languages, as a BCP 47 tag. */
export function locale(): LocalePort {
  return {
    current: () => NSLocale.preferredLanguages.firstObject ?? 'en',
  };
}
