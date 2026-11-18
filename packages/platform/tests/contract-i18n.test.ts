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
import {
  bindColorScheme,
  highContrastDarkTheme,
  setColorScheme,
  themeFor,
  useColorScheme,
  useTheme,
} from '../src/sdk/theme.js';
import {
  expectIdleWebProviders,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

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
  useWebServices();
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
  useWebServices();
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

v.describe('locale service', () => {
  useWebServices();
  v.afterEach(() => {
    setupI18n({ locale: 'en', fallbackLocale: 'en', messages });
    setTextScale(1);
    setHighContrast(false);
  });

  v.it(
    'takes the default locale from the host and tells it what the app chose',
    () => {
      const calls: unknown[] = [];
      provide({
        locale: {
          current: () => 'ar-EG',
          apply: (locale, direction) =>
            calls.push(['locale', locale, direction]),
          applyTextScale: (scale) => calls.push(['scale', scale]),
          applyHighContrast: (enabled) => calls.push(['contrast', enabled]),
        },
      });
      const i18n = createI18n();
      v.expect(i18n.locale()).toBe('ar-EG');
      v.expect(i18n.dir()).toBe('rtl');
      i18n.setLocale('fr');
      setTextScale(1.5);
      setHighContrast(true);
      v.expect(calls).toEqual([
        ['locale', 'ar-EG', 'rtl'],
        ['locale', 'fr', 'ltr'],
        ['scale', 1.5],
        ['contrast', true],
      ]);
      // An explicit locale wins over the host's.
      v.expect(createI18n({ locale: 'de' }).locale()).toBe('de');
    },
  );

  v.it('a host may report the locale and have nothing to update', () => {
    provide({ locale: { current: () => 'ja' } });
    const i18n = createI18n();
    v.expect(i18n.locale()).toBe('ja');
    i18n.setLocale('en');
    setTextScale(2);
    setHighContrast(true);
    v.expect(useTextScale()).toBe(2);
    v.expect(useHighContrast()).toBe(true);
  });

  v.it(
    'the web provider reads navigator.language and mirrors the choices on the page root',
    () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'language');
      const root = document.documentElement;
      try {
        Object.defineProperty(navigator, 'language', {
          configurable: true,
          value: 'he-IL',
        });
        const i18n = createI18n();
        v.expect(i18n.locale()).toBe('he-IL');
        v.expect([root.lang, root.dir]).toEqual(['he-IL', 'rtl']);
        i18n.setLocale('en-GB');
        v.expect([root.lang, root.dir]).toEqual(['en-GB', 'ltr']);
        setTextScale(1.25);
        v.expect(root.style.getPropertyValue('--text-scale')).toBe('1.25');
        setHighContrast(true);
        v.expect(root.classList.contains('high-contrast')).toBe(true);
        setHighContrast(false);
        v.expect(root.classList.contains('high-contrast')).toBe(false);
        // A browser that reports no language: English.
        Object.defineProperty(navigator, 'language', {
          configurable: true,
          value: '',
        });
        v.expect(createI18n().locale()).toBe('en');
      } finally {
        if (original) Object.defineProperty(navigator, 'language', original);
        else delete (navigator as { language?: unknown }).language;
      }
    },
  );

  v.it(
    'without a locale service: English, and the page is not touched',
    async () => {
      const restores = [
        forbid(navigator, 'language'),
        forbid(document, 'documentElement'),
      ];
      try {
        await withoutServices(() => {
          const i18n = createI18n();
          v.expect(i18n.locale()).toBe('en');
          v.expect(i18n.dir()).toBe('ltr');
          i18n.setLocale('ar');
          v.expect(i18n.dir()).toBe('rtl');
          setTextScale(1.5);
          setHighContrast(true);
          v.expect(useTextScale()).toBe(1.5);
          v.expect(useHighContrast()).toBe(true);
          // The module-level helpers create their instance on first use.
          setupI18n({ messages });
          v.expect(locale()).toBe('en');
          v.expect(t('save')).toBe('Save');
        });
      } finally {
        for (const restore of restores) restore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['locale'] });
    },
  );
});

v.describe('colour scheme service', () => {
  useWebServices();
  v.afterEach(() => {
    setColorScheme('light');
    v.vi.unstubAllGlobals();
  });

  const fakeQuery = (matches: boolean) => {
    const listeners = new Set<() => void>();
    return {
      matches,
      listeners,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
      change(next: boolean) {
        this.matches = next;
        for (const listener of listeners) listener();
      },
    };
  };

  v.it('follows the host service until disposed', () => {
    let listener: ((scheme: 'light' | 'dark') => void) | undefined;
    provide({
      colorScheme: {
        current: () => 'dark',
        subscribe(next) {
          listener = next;
          return () => (listener = undefined);
        },
      },
    });
    const stop = bindColorScheme();
    v.expect(useColorScheme()).toBe('dark');
    listener?.('light');
    v.expect(useColorScheme()).toBe('light');
    stop();
    v.expect(listener).toBeUndefined();
  });

  v.it(
    'the web provider wraps prefers-color-scheme and listens only while bound',
    () => {
      const query = fakeQuery(true);
      const queries: string[] = [];
      v.vi.stubGlobal('matchMedia', (text: string) => {
        queries.push(text);
        return query;
      });
      const stop = bindColorScheme();
      v.expect(queries.at(-1)).toBe('(prefers-color-scheme: dark)');
      v.expect(useColorScheme()).toBe('dark');
      v.expect(query.listeners.size).toBe(1);
      query.change(false);
      v.expect(useColorScheme()).toBe('light');
      stop();
      v.expect(query.listeners.size).toBe(0);
      query.change(true);
      v.expect(useColorScheme()).toBe('light');

      // A browser without matchMedia: light, and nothing to listen to.
      v.vi.stubGlobal('matchMedia', undefined);
      setColorScheme('dark');
      bindColorScheme()();
      v.expect(useColorScheme()).toBe('light');
    },
  );

  v.it('still accepts a media query list', () => {
    const query = fakeQuery(true);
    const stop = bindColorScheme(query as unknown as MediaQueryList);
    v.expect(useColorScheme()).toBe('dark');
    query.change(false);
    v.expect(useColorScheme()).toBe('light');
    stop();
    v.expect(query.listeners.size).toBe(0);
  });

  v.it(
    'without the service nothing is bound and matchMedia is not asked',
    async () => {
      const restore = forbid(globalThis, 'matchMedia');
      try {
        await withoutServices(() => {
          setColorScheme('dark');
          bindColorScheme()();
          v.expect(useColorScheme()).toBe('dark');
        });
      } finally {
        restore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['colorScheme'] });
    },
  );
});
