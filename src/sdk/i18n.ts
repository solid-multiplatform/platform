import { createSignal, type Accessor } from 'solid-js';

export type TextDirection = 'ltr' | 'rtl';
export type Messages = Record<string, string>;
export type MessageTable = Record<string, Messages>;

/**
 * Languages written right-to-left. The base language subtag is checked, so
 * `ar-EG`, `he-IL` and `fa-IR` all resolve correctly.
 */
const RTL_LANGUAGES = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'ks',
  'ku',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
]);

export function isRTL(locale: string): boolean {
  return RTL_LANGUAGES.has(locale.toLowerCase().split(/[-_]/)[0]!);
}

/** Text direction for a locale. */
export function textDirection(locale: string): TextDirection {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

const [textScale, setTextScaleSignal] = createSignal(1);
const [highContrast, setHighContrastSignal] = createSignal(false);

/** Host-reported accessibility font scale. Set it from Dynamic Type / fontScale. */
export const useTextScale: Accessor<number> = textScale;
/** Whether the host requests a high-contrast palette. */
export const useHighContrast: Accessor<boolean> = highContrast;

const documentRoot = (): HTMLElement | undefined =>
  typeof document === 'undefined' ? undefined : document.documentElement;

/**
 * Scale every design-token font size. Clamped to 0.5–3 so a corrupt host value
 * cannot make the UI unusable. Mirrors iOS Dynamic Type and Android
 * `fontScale`.
 */
export function setTextScale(scale: number): void {
  if (!Number.isFinite(scale)) return;
  const next = Math.min(3, Math.max(0.5, scale));
  setTextScaleSignal(next);
  const root = documentRoot();
  if (root) root.style.setProperty('--text-scale', String(next));
}

/** Toggle the high-contrast palette and the matching host hooks. */
export function setHighContrast(enabled: boolean): void {
  setHighContrastSignal(enabled);
  const root = documentRoot();
  if (root) root.classList.toggle('high-contrast', enabled);
}

export interface I18nOptions {
  locale?: string;
  fallbackLocale?: string;
  /** Locale-keyed messages: `{ en: { save: 'Save' }, ar: { save: 'حفظ' } }`. */
  messages?: MessageTable;
}

export interface I18n {
  locale: Accessor<string>;
  fallbackLocale: Accessor<string>;
  setLocale(locale: string): void;
  setMessages(locale: string, messages: Messages): void;
  /** Look up a message with locale fallback, without interpolation. */
  message(key: string): string;
  /**
   * Translate `key`. `{name}` placeholders are interpolated. A numeric
   * `params.count` selects the `Intl.PluralRules` category: `key.one`,
   * `key.other`, and so on, falling back to `key`.
   */
  t(key: string, params?: Record<string, string | number>): string;
  dir: Accessor<TextDirection>;
  textScale: Accessor<number>;
  setTextScale(scale: number): void;
  highContrast: Accessor<boolean>;
  setHighContrast(enabled: boolean): void;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatDate(
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ): string;
  formatRelativeTime(
    value: number,
    unit?: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  formatList(
    items: readonly string[],
    options?: Intl.ListFormatOptions,
  ): string;
  formatDisplayName(
    code: string,
    options?: Intl.DisplayNamesOptions,
  ): string | undefined;
}

const defaultLocale = () =>
  typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en';

const syncDocumentLocale = (locale: string) => {
  const root = documentRoot();
  if (!root) return;
  root.lang = locale;
  root.dir = textDirection(locale);
};

const interpolate = (
  template: string,
  params?: Record<string, string | number>,
): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        params[name] === undefined ? match : String(params[name]),
      )
    : template;

const pluralCategory = (locale: string, count: number): string => {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    return new Intl.PluralRules('en').select(count);
  }
};

/**
 * Small i18n core in the shape of i18next / Flutter intl: locale fallback,
 * interpolation, plural categories, RTL detection and locale-aware formatting.
 * It is intentionally dependency-free; hosts report the locale and
 * accessibility scale.
 */
export function createI18n(options: I18nOptions = {}): I18n {
  const [locale, setLocaleSignal] = createSignal(
    options.locale ?? defaultLocale(),
  );
  const [fallbackLocale, setFallbackSignal] = createSignal(
    options.fallbackLocale ?? 'en',
  );
  const [messages, setMessagesSignal] = createSignal<MessageTable>({
    ...(options.messages ?? {}),
  });

  const lookup = (key: string, count?: number): string | undefined => {
    const candidates = [locale(), fallbackLocale()];
    for (const candidate of candidates) {
      const table = messages()[candidate];
      if (!table) continue;
      if (count !== undefined) {
        const category = pluralCategory(candidate, count);
        const plural =
          table[`${key}.${category}`] ??
          table[`${key}_${category}`] ??
          table[`${key}.other`] ??
          table[`${key}_other`];
        if (plural !== undefined) return plural;
      }
      if (table[key] !== undefined) return table[key];
    }
    return undefined;
  };

  const i18n: I18n = {
    locale,
    fallbackLocale,
    setLocale(next) {
      if (!next) return;
      setLocaleSignal(next);
      syncDocumentLocale(next);
    },
    setMessages(nextLocale, next) {
      setMessagesSignal((current) => ({
        ...current,
        [nextLocale]: { ...next },
      }));
    },
    message(key) {
      return lookup(key) ?? key;
    },
    t(key, params) {
      const count =
        typeof params?.count === 'number' ? params.count : undefined;
      return interpolate(lookup(key, count) ?? key, params);
    },
    dir: () => textDirection(locale()),
    textScale,
    setTextScale,
    highContrast,
    setHighContrast,
    formatNumber(value, formatOptions) {
      try {
        return new Intl.NumberFormat(locale(), formatOptions).format(value);
      } catch {
        return new Intl.NumberFormat('en', formatOptions).format(value);
      }
    },
    formatDate(value, formatOptions) {
      const date = value instanceof Date ? value : new Date(value);
      try {
        return new Intl.DateTimeFormat(locale(), formatOptions).format(date);
      } catch {
        return new Intl.DateTimeFormat('en', formatOptions).format(date);
      }
    },
    formatRelativeTime(value, unit = 'day', formatOptions) {
      try {
        return new Intl.RelativeTimeFormat(locale(), formatOptions).format(
          value,
          unit,
        );
      } catch {
        return new Intl.RelativeTimeFormat('en', formatOptions).format(
          value,
          unit,
        );
      }
    },
    formatList(items, formatOptions) {
      try {
        return new Intl.ListFormat(locale(), formatOptions).format(items);
      } catch {
        return new Intl.ListFormat('en', formatOptions).format(items);
      }
    },
    formatDisplayName(code, formatOptions) {
      try {
        return new Intl.DisplayNames(
          locale(),
          formatOptions ?? { type: 'region' },
        ).of(code);
      } catch {
        return undefined;
      }
    },
  };

  syncDocumentLocale(i18n.locale());
  return i18n;
}

let active: I18n | undefined;

/** Install the application's locale and message tables. */
export function setupI18n(options: I18nOptions): I18n {
  active = createI18n(options);
  return active;
}

// Created on first use so that importing the SDK never touches the host
// (locale lookup, document attributes) before the app asks for a translation.
const current = (): I18n => (active ??= createI18n());

/** The active i18n instance. */
export function useI18n(): I18n {
  return current();
}

// Module-level conveniences so screens can call `t('save')` without threading
// an instance through props. They read the active instance's signals, so a
// `setupI18n` call re-renders translated screens.
export const locale = (): string => current().locale();
export const dir = (): TextDirection => current().dir();
export const t = (
  key: string,
  params?: Record<string, string | number>,
): string => current().t(key, params);
export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions,
): string => current().formatNumber(value, options);
export const formatDate = (
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string => current().formatDate(value, options);
export const formatRelativeTime = (
  value: number,
  unit?: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string => current().formatRelativeTime(value, unit, options);
export const formatList = (
  items: readonly string[],
  options?: Intl.ListFormatOptions,
): string => current().formatList(items, options);
export const formatDisplayName = (
  code: string,
  options?: Intl.DisplayNamesOptions,
): string | undefined => current().formatDisplayName(code, options);

/** Scale a design-token font size by the host accessibility scale. */
export const scaled = (value: number): number => value * current().textScale();
