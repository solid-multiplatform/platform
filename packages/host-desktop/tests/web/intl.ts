// `Intl` over the native ICU4X formatters, in the runtime without a window.
// Values are checked against the ECMA-402 reference (ICU's output for the
// same locales): grouping, currency, percent, date/time in UTC and a named
// zone, relative time, lists, plural categories, collation and parts. Also:
// invalid input throws the spec's error, two identical formatters are one
// instance, and nothing is built until a formatter is used.
import { installIntl } from '../../src/web/index';

installIntl();

const failures: string[] = [];
let checks = 0;
function equal(name: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) failures.push(`${name}: ${a} is not ${b}`);
}
function throws(name: string, kind: string, action: () => unknown): void {
  checks++;
  try {
    action();
    failures.push(`${name}: did not throw`);
  } catch (error) {
    if ((error as Error).name !== kind) {
      failures.push(`${name}: threw ${(error as Error).name}, not ${kind}`);
    }
  }
}

// Nothing is built at installation, only when an app first asks.
equal('nothing built before first use', __solid.intl.stats().formatters, 0);

// NumberFormat.
const en = new Intl.NumberFormat('en-US');
equal('en grouping', en.format(1234.5), '1,234.5');
equal('de grouping', new Intl.NumberFormat('de-DE').format(1234.5), '1.234,5');
equal(
  'currency',
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    1234.5,
  ),
  '$1,234.50',
);
equal(
  'percent',
  new Intl.NumberFormat('en-US', { style: 'percent' }).format(0.5),
  '50%',
);
equal(
  'fraction digits',
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1.005),
  '1.01',
);
equal('nan', en.format(NaN), 'NaN');
equal('infinity', en.format(Infinity), '∞');
equal('resolved locale', en.resolvedOptions().locale, 'en-US');
equal('resolved style', en.resolvedOptions().style, 'decimal');
equal(
  'two identical formatters are one',
  new Intl.NumberFormat('en-US') === en,
  true,
);
equal(
  'different options are not one',
  new Intl.NumberFormat('en-US', { useGrouping: false }) === en,
  false,
);

// formatToParts.
const numberParts = new Intl.NumberFormat('en-US').formatToParts(1234.5);
equal(
  'number parts',
  numberParts.map((part) => part.type),
  ['integer', 'group', 'integer', 'decimal', 'fraction'],
);

// DateTimeFormat, UTC and a named IANA zone.
const date = new Date(Date.UTC(2020, 0, 2, 15, 4, 5));
equal(
  'date and time in UTC',
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date),
  'Jan 2, 2020, 3:04 PM',
);
equal(
  'date only',
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    dateStyle: 'short',
  }).format(date),
  '1/2/20',
);
equal(
  'named zone shifts the clock',
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date),
  '10:04 AM',
);
equal(
  'resolved time zone',
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
  }).resolvedOptions().timeZone,
  'America/New_York',
);
const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
}).formatToParts(date);
equal(
  'date parts',
  dateParts.map((part) => part.type),
  ['month', 'literal', 'day', 'literal', 'year'],
);

// RelativeTimeFormat.
equal(
  'relative past',
  new Intl.RelativeTimeFormat('en').format(-1, 'day'),
  '1 day ago',
);
equal(
  'relative future',
  new Intl.RelativeTimeFormat('en').format(2, 'hour'),
  'in 2 hours',
);
equal(
  'relative auto',
  new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-1, 'day'),
  'yesterday',
);
throws('relative unit required', 'RangeError', () =>
  new Intl.RelativeTimeFormat('en').format(1, undefined as never),
);

// ListFormat.
equal(
  'list conjunction',
  new Intl.ListFormat('en', { type: 'conjunction' }).format(['a', 'b', 'c']),
  'a, b, and c',
);
equal(
  'list disjunction',
  new Intl.ListFormat('en', { type: 'disjunction' }).format(['a', 'b']),
  'a or b',
);
equal('empty list', new Intl.ListFormat('en').format([]), '');

// PluralRules.
equal('plural one', new Intl.PluralRules('en').select(1), 'one');
equal('plural other', new Intl.PluralRules('en').select(1.5), 'other');
equal('plural de one', new Intl.PluralRules('de-DE').select(1), 'one');
equal(
  'ordinal two',
  new Intl.PluralRules('en', { type: 'ordinal' }).select(2),
  'two',
);

// Collator.
const collator = new Intl.Collator('en');
equal('collator less', collator.compare('a', 'b'), -1);
equal('collator equal', collator.compare('a', 'a'), 0);
equal('collator greater', collator.compare('b', 'a'), 1);

// Errors.
throws('invalid locale', 'RangeError', () => new Intl.NumberFormat('en_US'));
throws(
  'invalid time zone',
  'RangeError',
  () => new Intl.DateTimeFormat('en-US', { timeZone: 'not a time zone' }),
);
throws(
  'missing currency',
  'RangeError',
  () => new Intl.NumberFormat('en-US', { style: 'currency' }),
);

// Formatters were built, and reused.
equal('formatters built', __solid.intl.stats().formatters > 0, true);
const before = __solid.intl.stats().formatters;
new Intl.NumberFormat('en-US');
new Intl.RelativeTimeFormat('en');
equal('cache reuse builds nothing', __solid.intl.stats().formatters, before);

if (failures.length > 0) {
  console.error(`intl: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  ${failure}`);
  __solid.exit(1);
}
console.log(`intl: ${checks} checks passed`);
__solid.exit(0);
