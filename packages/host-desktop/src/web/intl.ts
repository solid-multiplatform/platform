// `Intl` over the native ICU4X formatters (`__solid.intl`). Hermes on Linux
// has none. Each class parses its locales and options once, keeps the native
// formatter handle, and caches instances by their serialized key: two
// identical formatters are the same object. Nothing here runs until an app
// constructs a formatter.
//
// The spec surface the platform and apps use is present: format,
// formatToParts (number, date, relative time and list), select, compare and
// resolvedOptions. Options that ICU4X has no equivalent for are recorded as
// taken but not applied (numbering systems other than the locale's default,
// compact notation, significant digits, hour cycles); `style: "unit"`
// appends the unit's short symbol from a small table. `Intl.DisplayNames`
// is absent here, as it is on the other hosts; `sdk/i18n.ts` already treats
// it as optional.

type Locales = string | readonly string[] | undefined;
type Options = object | undefined;

const cache = new Map<string, unknown>();
const TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

function intl(): SolidIntl {
  const host = (globalThis as { __solid?: { intl?: SolidIntl } }).__solid;
  if (host?.intl === undefined) {
    throw new Error('The desktop host did not install its Intl runtime');
  }
  return host.intl;
}

/** Lowercase the language, title-case a script, uppercase a region. */
function canonicalTag(tag: string): string {
  const parts = tag.split('-');
  parts[0] = parts[0]!.toLowerCase();
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.length === 4 && /^[A-Za-z]+$/.test(part)) {
      parts[index] = part[0]!.toUpperCase() + part.slice(1).toLowerCase();
    } else if (part.length === 2 && /^[A-Za-z]+$/.test(part)) {
      parts[index] = part.toUpperCase();
    } else {
      parts[index] = part.toLowerCase();
    }
  }
  return parts.join('-');
}

function canonicalize(tag: string): string {
  if (!TAG.test(tag)) {
    throw new RangeError(`Incorrect locale information provided: ${tag}`);
  }
  return canonicalTag(tag);
}

function localeList(locales: Locales): string[] {
  if (locales === undefined) return [];
  const list =
    typeof locales === 'string'
      ? [locales]
      : Array.isArray(locales)
        ? (locales as readonly unknown[]).map((value) => {
            if (typeof value !== 'string') {
              throw new TypeError('Language tags must be strings');
            }
            return value;
          })
        : (() => {
            throw new TypeError('locales must be a string or an array');
          })();
  return list.map(canonicalize);
}

function systemLocale(): string {
  const locales = (
    globalThis as { __solid?: { system?: { locales?: () => string[] } } }
  ).__solid?.system?.locales?.();
  return locales?.[0] !== undefined ? canonicalize(locales[0]) : 'en';
}

function resolveLocale(locales: Locales): string {
  return localeList(locales)[0] ?? systemLocale();
}

function systemTimeZone(): string {
  return intl().systemTimeZone();
}

/** The instance key: two formatters with the same key are one object. */
function optionKey(options: Options): string {
  if (options === undefined) return '';
  return Object.keys(options)
    .sort()
    .map(
      (key) =>
        `${key}:${JSON.stringify((options as Record<string, unknown>)[key])}`,
    )
    .join(',');
}

function supported(locales: Locales): string[] {
  return localeList(locales);
}

// ---------------------------------------------------------------------------
// PluralRules

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export class DesktopPluralRules {
  readonly locale!: string;
  readonly type!: 'cardinal' | 'ordinal';
  private readonly handle!: number;

  constructor(locales?: Locales, options?: Intl.PluralRulesOptions) {
    const locale = resolveLocale(locales);
    const type = options?.type === 'ordinal' ? 'ordinal' : 'cardinal';
    const key = `plural|${locale}|${type}`;
    const cachedRules = cache.get(key);
    if (cachedRules !== undefined) return cachedRules as DesktopPluralRules;
    this.locale = locale;
    this.type = type;
    this.handle = intl().plural(locale, type, key);
    cache.set(key, this);
  }

  select(value: number): PluralCategory {
    return intl().format(this.handle, 0, Number(value)) as PluralCategory;
  }

  resolvedOptions(): Intl.ResolvedPluralRulesOptions {
    return {
      locale: this.locale,
      type: this.type,
      pluralCategories: pluralCategories(this.locale, this.type),
      minimumIntegerDigits: 1,
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    };
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

function pluralCategories(
  locale: string,
  type: 'cardinal' | 'ordinal',
): PluralCategory[] {
  const rules = new DesktopPluralRules(locale, { type });
  const found = new Set<PluralCategory>();
  const samples = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 100, 101, 1.5,
  ];
  for (const sample of samples) found.add(rules.select(sample));
  found.delete('other');
  return [...found, 'other'];
}

// ---------------------------------------------------------------------------
// NumberFormat

const UNIT_SYMBOLS: Record<string, string> = {
  meter: 'm',
  kilometer: 'km',
  centimeter: 'cm',
  millimeter: 'mm',
  second: 's',
  minute: 'min',
  hour: 'h',
  day: 'd',
  week: 'wk',
  month: 'mo',
  year: 'yr',
  liter: 'L',
  milliliter: 'mL',
  gram: 'g',
  kilogram: 'kg',
  byte: 'byte',
  kilobyte: 'kB',
  megabyte: 'MB',
  gigabyte: 'GB',
  percent: '%',
};

/** Rounds a decimal string half-up to `max` fraction digits, keeping `min`. */
function roundText(text: string, min: number, max: number): string {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  let integer = dot === -1 ? body : body.slice(0, dot);
  let fraction = dot === -1 ? '' : body.slice(dot + 1);
  if (fraction.length <= max) {
    fraction = fraction
      .padEnd(min, '0')
      .slice(0, Math.max(min, fraction.length));
    return `${negative ? '-' : ''}${fraction === '' ? integer : `${integer}.${fraction}`}`;
  }
  const keep = fraction.slice(0, max);
  let digits = integer + keep;
  if (fraction.charCodeAt(max) >= 53) {
    const chars = digits.split('');
    let at = chars.length - 1;
    while (at >= 0) {
      if (chars[at] === '9') {
        chars[at] = '0';
        at--;
      } else {
        chars[at] = String.fromCharCode(chars[at]!.charCodeAt(0) + 1);
        break;
      }
    }
    if (at < 0) chars.unshift('1');
    digits = chars.join('');
  }
  if (max === 0) return `${negative ? '-' : ''}${digits}`;
  integer = digits.slice(0, digits.length - max) || '0';
  fraction = digits.slice(digits.length - max);
  while (fraction.length > min && fraction.endsWith('0'))
    fraction = fraction.slice(0, -1);
  return `${negative ? '-' : ''}${fraction === '' ? integer : `${integer}.${fraction}`}`;
}

/** `value` with between `min` and `max` fraction digits, as text. */
function decimalText(value: number, min: number, max: number): string {
  const limit = Math.max(0, Math.min(100, Math.trunc(max)));
  let text = String(value);
  if (/e/i.test(text)) {
    text = Number.isInteger(value)
      ? BigInt(value).toString()
      : value.toFixed(limit);
  }
  return roundText(text, min, limit);
}

interface ParsedNumber {
  style: 'decimal' | 'currency' | 'percent' | 'unit';
  currency?: string;
  unit?: string;
  unitDisplay: 'symbol' | 'narrow' | 'short' | 'long';
  grouping: string;
  minimumFractionDigits: number;
  maximumFractionDigits: number;
  explicitFraction: boolean;
  signDisplay: string;
}

function parseNumber(options?: Intl.NumberFormatOptions): ParsedNumber {
  const style = options?.style ?? 'decimal';
  if (!['decimal', 'currency', 'percent', 'unit'].includes(style)) {
    throw new RangeError(`Invalid number format style: ${String(style)}`);
  }
  const currency =
    style === 'currency' ? String(options?.currency ?? '') : undefined;
  if (style === 'currency' && !/^[A-Za-z]{3}$/.test(currency!)) {
    throw new RangeError('A three-letter currency code is required');
  }
  const unit =
    style === 'unit'
      ? String((options as { unit?: string })?.unit ?? '')
      : undefined;
  if (style === 'unit' && unit === '') {
    throw new RangeError('A unit is required');
  }
  const explicitFraction =
    options?.minimumFractionDigits !== undefined ||
    options?.maximumFractionDigits !== undefined;
  const minimum = options?.minimumFractionDigits ?? 0;
  const maximum =
    options?.maximumFractionDigits ??
    (style === 'percent' ? 0 : explicitFraction ? minimum : 3);
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 0 ||
    maximum < 0 ||
    maximum > 100 ||
    minimum > maximum
  ) {
    throw new RangeError('Invalid fraction digits');
  }
  const groupingOption = options?.useGrouping as boolean | string | undefined;
  const grouping =
    groupingOption === false
      ? 'never'
      : groupingOption === 'min2'
        ? 'min2'
        : 'auto';
  return {
    style,
    currency,
    unit,
    unitDisplay:
      ((options as { unitDisplay?: string })
        ?.unitDisplay as ParsedNumber['unitDisplay']) ?? 'short',
    grouping,
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
    explicitFraction,
    signDisplay: 'auto',
  };
}

export class DesktopNumberFormat {
  readonly locale!: string;
  private readonly handle!: number;
  private readonly options!: ParsedNumber;
  private bound?: (value: number | bigint) => string;

  constructor(locales?: Locales, options?: Intl.NumberFormatOptions) {
    const locale = resolveLocale(locales);
    const parsed = parseNumber(options);
    const key = `number|${locale}|${optionKey(options)}`;
    const cachedFormat = cache.get(key);
    if (cachedFormat !== undefined) return cachedFormat as DesktopNumberFormat;
    const nativeKey = `number|${locale}|${parsed.style}|${parsed.currency ?? ''}|${parsed.grouping}`;
    this.locale = locale;
    this.options = parsed;
    this.handle = intl().number(
      locale,
      parsed.style,
      parsed.currency ?? '',
      parsed.grouping,
      nativeKey,
    );
    cache.set(key, this);
  }

  private text(value: number | bigint): string {
    const number = Number(value);
    if (Number.isNaN(number)) return 'NaN';
    if (number === Infinity) return '∞';
    if (number === -Infinity) return '-∞';
    const {
      style,
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    } = this.options;
    if (style === 'percent') {
      return decimalText(number * 100, min, max);
    }
    if (style === 'currency' && !this.options.explicitFraction) {
      // ICU4X applies the currency's own fraction digits.
      return String(number);
    }
    return decimalText(number, min, max);
  }

  private withUnit(formatted: string): string {
    const unit = this.options.unit;
    if (unit === undefined) return formatted;
    const symbol = UNIT_SYMBOLS[unit] ?? unit;
    return `${formatted} ${symbol}`;
  }

  /** Non-finite values are symbols, not decimals, so they skip ICU4X. */
  private render(
    value: number | bigint,
    parts: boolean,
  ): string | Intl.NumberFormatPart[] {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      const text = Number.isNaN(number) ? 'NaN' : number > 0 ? '∞' : '-∞';
      const type = Number.isNaN(number) ? 'nan' : 'infinity';
      return parts ? [{ type, value: text }] : text;
    }
    const text = this.text(number);
    const formatted = intl().format(this.handle, parts ? 1 : 0, text);
    if (!parts) {
      return this.options.style === 'unit'
        ? this.withUnit(formatted as string)
        : (formatted as string);
    }
    return formatted as Intl.NumberFormatPart[];
  }

  get format(): (value: number | bigint) => string {
    if (this.bound === undefined) {
      this.bound = (value) => this.render(value, false) as string;
    }
    return this.bound;
  }

  formatToParts(value: number | bigint): Intl.NumberFormatPart[] {
    return this.render(value, true) as Intl.NumberFormatPart[];
  }

  resolvedOptions(): Intl.ResolvedNumberFormatOptions {
    return {
      locale: this.locale,
      numberingSystem: 'latn',
      style: this.options.style,
      ...(this.options.currency !== undefined
        ? { currency: this.options.currency }
        : {}),
      ...(this.options.unit !== undefined ? { unit: this.options.unit } : {}),
      minimumIntegerDigits: 1,
      minimumFractionDigits: this.options.minimumFractionDigits,
      maximumFractionDigits: this.options.maximumFractionDigits,
      useGrouping:
        this.options.grouping === 'never'
          ? false
          : this.options.grouping === 'min2'
            ? 'min2'
            : 'auto',
    } as Intl.ResolvedNumberFormatOptions;
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

// ---------------------------------------------------------------------------
// DateTimeFormat

function dateSelection(options?: Intl.DateTimeFormatOptions): {
  date: string;
  time: string;
  zoneLong: boolean;
} {
  const dateStyle = options?.dateStyle;
  const timeStyle = options?.timeStyle;
  let date = '';
  if (dateStyle !== undefined) {
    date = dateStyle;
  } else {
    const has = (key: keyof Intl.DateTimeFormatOptions) =>
      options?.[key] !== undefined;
    const weekday = has('weekday');
    if (has('year') && has('month') && has('day'))
      date = weekday ? 'ymde' : 'ymd';
    else if (has('month') && has('day')) date = weekday ? 'mde' : 'md';
    else if (has('year') && has('month')) date = 'ym';
    else if (has('year')) date = 'y';
    else if (has('month')) date = 'm';
    else if (has('day')) date = 'd';
    else if (weekday) date = 'e';
  }
  let time = '';
  if (timeStyle !== undefined) {
    time = timeStyle === 'short' ? 'minute' : 'second';
  } else if (options?.second !== undefined) time = 'second';
  else if (options?.minute !== undefined) time = 'minute';
  else if (options?.hour !== undefined) time = 'hour';
  if (date === '' && time === '') date = 'ymd';
  return {
    date,
    time,
    zoneLong: options?.timeZoneName === 'long' || timeStyle === 'full',
  };
}

export class DesktopDateTimeFormat {
  readonly locale!: string;
  readonly timeZone!: string;
  private readonly handle!: number;
  private bound?: (date?: Date | number) => string;

  constructor(locales?: Locales, options?: Intl.DateTimeFormatOptions) {
    const locale = resolveLocale(locales);
    const zone = options?.timeZone;
    if (zone !== undefined && !ZONE.test(zone)) {
      throw new RangeError(`Invalid time zone: ${zone}`);
    }
    const key = `date|${locale}|${optionKey(options as Options)}`;
    const cachedFormat = cache.get(key);
    if (cachedFormat !== undefined)
      return cachedFormat as DesktopDateTimeFormat;
    const selection = dateSelection(options);
    const resolvedZone = zone === undefined ? systemTimeZone() : zone;
    const showZone =
      selection.time !== '' &&
      (options?.timeZoneName !== undefined ||
        options?.timeStyle === 'full' ||
        options?.timeStyle === 'long');
    const displayZone = showZone ? resolvedZone : '';
    this.locale = locale;
    this.timeZone = resolvedZone;
    this.handle = intl().date(
      locale,
      selection.date,
      selection.time,
      displayZone,
      selection.zoneLong ? 1 : 0,
      `date|${locale}|${selection.date}|${selection.time}|${displayZone}|${selection.zoneLong}`,
    );
    cache.set(key, this);
  }

  private components(date?: Date | number): number[] {
    const value = date === undefined ? new Date() : new Date(date as number);
    if (Number.isNaN(value.getTime()))
      throw new RangeError('Invalid time value');
    const zone = this.timeZone;
    if (zone === systemTimeZone()) {
      return [
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        -value.getTimezoneOffset() * 60,
      ];
    }
    const offset = intl().zoneOffset(zone, Math.floor(value.getTime() / 1000));
    const shifted = new Date(value.getTime() + offset * 1000);
    return [
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds(),
      offset,
    ];
  }

  get format(): (date?: Date | number) => string {
    if (this.bound === undefined) {
      this.bound = (date) =>
        intl().format(this.handle, 0, ...this.components(date)) as string;
    }
    return this.bound;
  }

  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
    return intl().format(
      this.handle,
      1,
      ...this.components(date),
    ) as Intl.DateTimeFormatPart[];
  }

  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions {
    return {
      locale: this.locale,
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: this.timeZone,
    };
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

// ---------------------------------------------------------------------------
// RelativeTimeFormat

const RELATIVE_UNITS = new Set([
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]);

export class DesktopRelativeTimeFormat {
  readonly locale!: string;
  readonly style!: string;
  readonly numeric!: string;
  private readonly handles = new Map<string, number>();
  private bound?: (value: number, unit: string) => string;

  constructor(locales?: Locales, options?: Intl.RelativeTimeFormatOptions) {
    const locale = resolveLocale(locales);
    const style = options?.style ?? 'long';
    const numeric = options?.numeric ?? 'always';
    const key = `relative|${locale}|${style}|${numeric}`;
    const cachedFormat = cache.get(key);
    if (cachedFormat !== undefined)
      return cachedFormat as DesktopRelativeTimeFormat;
    this.locale = locale;
    this.style = style;
    this.numeric = numeric;
    cache.set(key, this);
  }

  private handle(unit: string): number {
    if (!RELATIVE_UNITS.has(unit)) {
      throw new RangeError(`Invalid unit: ${unit}`);
    }
    let handle = this.handles.get(unit);
    if (handle === undefined) {
      handle = intl().relative(
        this.locale,
        unit,
        this.style,
        this.numeric,
        `relative|${this.locale}|${this.style}|${this.numeric}|${unit}`,
      );
      this.handles.set(unit, handle);
    }
    return handle;
  }

  private parts(value: number, unit: string, parts: number): unknown {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new RangeError('Invalid relative time value');
    return intl().format(this.handle(unit), parts, String(number));
  }

  get format(): (value: number, unit: string) => string {
    if (this.bound === undefined) {
      this.bound = (value, unit) => this.parts(value, unit, 0) as string;
    }
    return this.bound;
  }

  formatToParts(value: number, unit: string): Intl.RelativeTimeFormatPart[] {
    return this.parts(value, unit, 1) as Intl.RelativeTimeFormatPart[];
  }

  resolvedOptions(): Intl.ResolvedRelativeTimeFormatOptions {
    return {
      locale: this.locale,
      style: this.style as Intl.ResolvedRelativeTimeFormatOptions['style'],
      numeric: this
        .numeric as Intl.ResolvedRelativeTimeFormatOptions['numeric'],
      numberingSystem: 'latn',
    };
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

// ---------------------------------------------------------------------------
// ListFormat

export class DesktopListFormat {
  readonly locale!: string;
  readonly type!: string;
  readonly style!: string;
  private readonly handle!: number;
  private bound?: (list: Iterable<unknown>) => string;

  constructor(locales?: Locales, options?: Intl.ListFormatOptions) {
    const locale = resolveLocale(locales);
    const type = options?.type ?? 'conjunction';
    const style = options?.style ?? 'long';
    if (!['conjunction', 'disjunction', 'unit'].includes(type)) {
      throw new RangeError(`Invalid list type: ${String(type)}`);
    }
    const key = `list|${locale}|${type}|${style}`;
    const cachedFormat = cache.get(key);
    if (cachedFormat !== undefined) return cachedFormat as DesktopListFormat;
    this.locale = locale;
    this.type = type;
    this.style = style;
    this.handle = intl().list(locale, type, style, key);
    cache.set(key, this);
  }

  private items(list: Iterable<unknown>): string[] {
    return Array.from(list, (item) => String(item));
  }

  get format(): (list: Iterable<unknown>) => string {
    if (this.bound === undefined) {
      this.bound = (list) => {
        const items = this.items(list);
        return items.length === 0
          ? ''
          : (intl().format(this.handle, 0, items) as string);
      };
    }
    return this.bound;
  }

  formatToParts(list: Iterable<unknown>): { type: string; value: string }[] {
    const items = this.items(list);
    if (items.length === 0) return [];
    return intl().format(this.handle, 1, items) as {
      type: string;
      value: string;
    }[];
  }

  resolvedOptions(): Intl.ResolvedListFormatOptions {
    return {
      locale: this.locale,
      type: this.type as Intl.ResolvedListFormatOptions['type'],
      style: this.style as Intl.ResolvedListFormatOptions['style'],
    };
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

// ---------------------------------------------------------------------------
// Collator (sorting only)

export class DesktopCollator {
  readonly locale!: string;
  private readonly handle!: number;
  private bound?: (left: string, right: string) => number;

  constructor(locales?: Locales, _options?: Intl.CollatorOptions) {
    const locale = resolveLocale(locales);
    const key = `collator|${locale}`;
    const cachedCollator = cache.get(key);
    if (cachedCollator !== undefined) return cachedCollator as DesktopCollator;
    this.locale = locale;
    this.handle = intl().collator(locale, key);
    cache.set(key, this);
  }

  get compare(): (left: string, right: string) => number {
    if (this.bound === undefined) {
      this.bound = (left, right) =>
        intl().compare(this.handle, String(left), String(right));
    }
    return this.bound;
  }

  resolvedOptions(): Intl.ResolvedCollatorOptions {
    return {
      locale: this.locale,
      usage: 'sort',
      sensitivity: 'variant',
      ignorePunctuation: false,
      collation: 'default',
      numeric: false,
      caseFirst: 'false',
    };
  }

  static supportedLocalesOf(locales?: Locales): string[] {
    return supported(locales);
  }
}

// ---------------------------------------------------------------------------
// Installation

function getCanonicalLocales(locales?: Locales): string[] {
  return localeList(locales);
}

/**
 * Defines `Intl` when the engine has none, writable and configurable, as the
 * engine would. Nothing is built here.
 */
export function installIntl(): void {
  const scope = globalThis as { Intl?: unknown };
  if (scope.Intl !== undefined) return;
  const value = {
    Collator: DesktopCollator,
    DateTimeFormat: DesktopDateTimeFormat,
    ListFormat: DesktopListFormat,
    NumberFormat: DesktopNumberFormat,
    PluralRules: DesktopPluralRules,
    RelativeTimeFormat: DesktopRelativeTimeFormat,
    getCanonicalLocales,
  };
  Object.defineProperty(scope, 'Intl', {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
