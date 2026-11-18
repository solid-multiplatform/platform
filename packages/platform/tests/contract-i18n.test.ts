import * as v from 'vitest';
import {
  createI18n,
  dir,
  formatDate,
  formatDisplayName,
  formatList,
  formatNumber,
  formatRelativeTime,
  isRTL,
  locale,
  scaled,
  setHighContrast,
  setTextScale,
  setupI18n,
  t,
  textDirection,
  useHighContrast,
  useI18n,
  useTextScale,
} from '../src/sdk/i18n.js';
import { highContrastDarkTheme, themeFor, useTheme } from '../src/sdk/theme.js';

const messages = {
  en: {
    save: 'Save',
    greeting: 'Hello {name}',
    items_one: '{count} item',
    items_other: '{count} items',
    cancel: 'Cancel',
  },
  fr: {
    save: 'Enregistrer',
    greeting: 'Bonjour {name}',
  },
  ar: {
    save: 'حفظ',
  },
};

v.describe('i18n', () => {
  v.beforeEach(() => {
    setupI18n({ locale: 'en', fallbackLocale: 'en', messages });
    setTextScale(1);
    setHighContrast(false);
  });

  v.it('translates, interpolates and falls back', () => {
    v.expect(t('save')).toBe('Save');
    v.expect(t('greeting', { name: 'Ada' })).toBe('Hello Ada');
    v.expect(t('missing')).toBe('missing');
    useI18n().setLocale('fr');
    v.expect(t('save')).toBe('Enregistrer');
    v.expect(t('greeting', { name: 'Ada' })).toBe('Bonjour Ada');
    // `cancel` is only in the fallback locale.
    v.expect(t('cancel')).toBe('Cancel');
  });

  v.it('selects plural categories', () => {
    v.expect(t('items', { count: 1 })).toBe('1 item');
    v.expect(t('items', { count: 3 })).toBe('3 items');
    v.expect(t('items', { count: 0 })).toBe('0 items');
  });

  v.it('reports direction and updates document locale', () => {
    v.expect(isRTL('ar-EG')).toBe(true);
    v.expect(isRTL('he')).toBe(true);
    v.expect(isRTL('en-US')).toBe(false);
    v.expect(textDirection('fa')).toBe('rtl');
    useI18n().setLocale('ar');
    v.expect(dir()).toBe('rtl');
    v.expect(document.documentElement.dir).toBe('rtl');
    v.expect(document.documentElement.lang).toBe('ar');
    useI18n().setLocale('en');
    v.expect(document.documentElement.dir).toBe('ltr');
  });

  v.it('formats numbers, dates, lists and display names per locale', () => {
    v.expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe(
      '1,234.50',
    );
    useI18n().setLocale('de-DE');
    v.expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe(
      '1.234,50',
    );
    v.expect(
      formatDate(new Date(Date.UTC(2020, 0, 2)), {
        timeZone: 'UTC',
        year: 'numeric',
      }),
    ).toContain('2020');
    useI18n().setLocale('en');
    v.expect(formatRelativeTime(-2, 'day', { numeric: 'always' })).toBe(
      '2 days ago',
    );
    v.expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
    v.expect(formatDisplayName('FR')).toBe('France');
  });

  v.it('keeps independent instances for tests and embedded apps', () => {
    const first = createI18n({
      locale: 'en',
      messages: { en: { hello: 'Hello' } },
    });
    const second = createI18n({
      locale: 'fr',
      messages: { fr: { hello: 'Bonjour' } },
    });
    first.setLocale('en');
    second.setLocale('fr');
    v.expect(first.t('hello')).toBe('Hello');
    v.expect(second.t('hello')).toBe('Bonjour');
    v.expect(first.locale()).toBe('en');
    v.expect(second.locale()).toBe('fr');
  });

  v.it('exposes the active locale through the module helper', () => {
    useI18n().setLocale('fr-CA');
    v.expect(locale()).toBe('fr-CA');
  });
});

v.describe('accessibility scale and contrast', () => {
  v.beforeEach(() => {
    setTextScale(1);
    setHighContrast(false);
    setupI18n({ locale: 'en', messages });
  });

  v.it('clamps the host font scale and scales tokens', () => {
    setTextScale(1.5);
    v.expect(useTextScale()).toBe(1.5);
    v.expect(scaled(20)).toBe(30);
    v.expect(themeFor('light', false).typography.body).toBe(36);
    v.expect(useTheme().typography.body).toBe(36);
    setTextScale(9);
    v.expect(useTextScale()).toBe(3);
    setTextScale(0.1);
    v.expect(useTextScale()).toBe(0.5);
    setTextScale(Number.NaN);
    v.expect(useTextScale()).toBe(0.5);
  });

  v.it('switches to the high-contrast palette and host hooks', () => {
    setHighContrast(true);
    v.expect(useHighContrast()).toBe(true);
    v.expect(document.documentElement.classList.contains('high-contrast')).toBe(
      true,
    );
    const theme = themeFor('dark', true);
    v.expect(theme).toBe(highContrastDarkTheme);
    v.expect(theme.colors.text).toBe(0xffffffff);
    setHighContrast(false);
    v.expect(themeFor('dark').colors.text).toBe(0xf2f6faff);
  });
});
