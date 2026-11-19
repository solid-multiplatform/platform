//! `__solid.intl`: ICU4X formatters behind `Intl` (see ../../src/web/intl.ts).
//!
//! Hermes on Linux has no `Intl`. Each builder here turns the JavaScript
//! layer's already-parsed options into one ICU4X formatter and keeps it: the
//! formatter is built on first use and then reused. Nothing is built at
//! startup, and nothing runs until JavaScript calls one of these functions.
//!
//! Data is compiled in (`icu_*::compiled_data`), so an app needs no data file
//! beside it and every locale in CLDR is available at run time.

use crate::napi::*;
use fixed_decimal::Decimal;
use icu_calendar::Date;
use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed};
use icu_datetime::fieldsets::builder::{DateFields, FieldSetBuilder, ZoneStyle};
use icu_datetime::fieldsets::enums::CompositeFieldSet;
use icu_datetime::options::{Length, TimePrecision};
use icu_datetime::DateTimeFormatter;
use icu_decimal::options::{DecimalFormatterOptions, GroupingStrategy};
use icu_decimal::DecimalFormatter;
use icu_experimental::dimension::currency::formatter::CurrencyFormatter;
use icu_experimental::dimension::currency::options::CurrencyFormatterOptions;
use icu_experimental::dimension::currency::CurrencyType;
use icu_experimental::dimension::percent::formatter::PercentFormatter;
use icu_experimental::relativetime::options::{Numeric, RelativeTimeFormatterOptions};
use icu_experimental::relativetime::RelativeTimeFormatter;
use icu_list::options::{ListFormatterOptions, ListLength};
use icu_list::ListFormatter;
use icu_locale::Locale;
use icu_plurals::{PluralCategory, PluralOperands, PluralRules};
use icu_time::zone::UtcOffset;
use icu_time::{Time, TimeZone, ZonedDateTime};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::ptr;
use std::str::FromStr;
use writeable::{Part, PartsWrite, Writeable};

enum NumberFormatter {
    Decimal(DecimalFormatter),
    Percent(PercentFormatter<DecimalFormatter>),
    Currency(CurrencyFormatter<DecimalFormatter>),
}

enum Formatter {
    Plural(PluralRules),
    Number(NumberFormatter),
    Date {
        formatter: DateTimeFormatter<CompositeFieldSet>,
        /// The IANA zone whose name is shown; `None` shows an offset only.
        zone: Option<TimeZone>,
    },
    Relative(RelativeTimeFormatter),
    List(ListFormatter),
    Collator(CollatorBorrowed<'static>),
}

struct Store {
    formatters: Vec<Formatter>,
    by_key: HashMap<String, u32>,
    /// How many formatters were built, including ones whose key was reused.
    built: u64,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store {
        formatters: Vec::new(),
        by_key: HashMap::new(),
        built: 0,
    });
}

fn locale(text: &str) -> Result<Locale, String> {
    text.parse::<Locale>()
        .map_err(|_| format!("Invalid language tag: {text}"))
}

/// Returns the handle for `key`, building the formatter with `build` only if
/// that key has none yet.
fn insert(
    key: String,
    store: &mut Store,
    build: impl FnOnce() -> Result<Formatter, String>,
) -> Result<u32, String> {
    if let Some(handle) = store.by_key.get(&key) {
        return Ok(*handle);
    }
    let formatter = build()?;
    let handle = store.formatters.len() as u32;
    store.formatters.push(formatter);
    store.by_key.insert(key, handle);
    store.built += 1;
    Ok(handle)
}

fn grouping(name: &str) -> GroupingStrategy {
    match name {
        "never" | "false" => GroupingStrategy::Never,
        "min2" => GroupingStrategy::Min2,
        _ => GroupingStrategy::Auto,
    }
}

fn relative(
    locale: &Locale,
    unit: &str,
    style: &str,
    numeric: &str,
) -> Result<RelativeTimeFormatter, String> {
    let prefs = locale.into();
    let options = if numeric == "auto" {
        RelativeTimeFormatterOptions::default().with_numeric(Numeric::Auto)
    } else {
        RelativeTimeFormatterOptions::default()
    };
    macro_rules! pick {
        ($long:ident, $short:ident, $narrow:ident) => {
            match style {
                "short" => RelativeTimeFormatter::$short(prefs, options),
                "narrow" => RelativeTimeFormatter::$narrow(prefs, options),
                _ => RelativeTimeFormatter::$long(prefs, options),
            }
        };
    }
    let result = match unit {
        "second" => pick!(
            try_new_long_second,
            try_new_short_second,
            try_new_narrow_second
        ),
        "minute" => pick!(
            try_new_long_minute,
            try_new_short_minute,
            try_new_narrow_minute
        ),
        "hour" => pick!(try_new_long_hour, try_new_short_hour, try_new_narrow_hour),
        "day" => pick!(try_new_long_day, try_new_short_day, try_new_narrow_day),
        "week" => pick!(try_new_long_week, try_new_short_week, try_new_narrow_week),
        "month" => pick!(try_new_long_month, try_new_short_month, try_new_narrow_month),
        "quarter" => pick!(
            try_new_long_quarter,
            try_new_short_quarter,
            try_new_narrow_quarter
        ),
        "year" => pick!(try_new_long_year, try_new_short_year, try_new_narrow_year),
        other => return Err(format!("Unknown unit: {other}")),
    };
    result.map_err(|error| format!("Relative time formatter: {error}"))
}

/// A field set from the components JavaScript asked for.
fn date_field_set(
    date: &str,
    time: &str,
    zone: bool,
    zone_long: bool,
) -> Result<CompositeFieldSet, String> {
    let mut builder = FieldSetBuilder::new();
    let mut has_date = false;
    let mut has_time = false;
    match date {
        "full" => {
            builder.length = Some(Length::Long);
            builder.date_fields = Some(DateFields::YMDE);
            has_date = true;
        }
        "long" => {
            builder.length = Some(Length::Long);
            builder.date_fields = Some(DateFields::YMD);
            has_date = true;
        }
        "medium" => {
            builder.length = Some(Length::Medium);
            builder.date_fields = Some(DateFields::YMD);
            has_date = true;
        }
        "short" => {
            builder.length = Some(Length::Short);
            builder.date_fields = Some(DateFields::YMD);
            has_date = true;
        }
        "ymd" => {
            builder.date_fields = Some(DateFields::YMD);
            has_date = true;
        }
        "ymde" => {
            builder.date_fields = Some(DateFields::YMDE);
            has_date = true;
        }
        "mde" => {
            builder.date_fields = Some(DateFields::MDE);
            has_date = true;
        }
        "de" => {
            builder.date_fields = Some(DateFields::DE);
            has_date = true;
        }
        "md" => {
            builder.date_fields = Some(DateFields::MD);
            has_date = true;
        }
        "ym" => {
            builder.date_fields = Some(DateFields::YM);
            has_date = true;
        }
        "y" => {
            builder.date_fields = Some(DateFields::Y);
            has_date = true;
        }
        "m" => {
            builder.date_fields = Some(DateFields::M);
            has_date = true;
        }
        "d" => {
            builder.date_fields = Some(DateFields::D);
            has_date = true;
        }
        "e" => {
            builder.date_fields = Some(DateFields::E);
            has_date = true;
        }
        _ => {}
    }
    match time {
        "full" | "long" | "second" => {
            builder.time_precision = Some(TimePrecision::Second);
            has_time = true;
        }
        "medium" | "minute" => {
            builder.time_precision = Some(TimePrecision::Minute);
            has_time = true;
        }
        "short" | "hour" => {
            builder.time_precision = Some(TimePrecision::Hour);
            has_time = true;
        }
        _ => {}
    }
    if zone {
        builder.zone_style = Some(if zone_long {
            ZoneStyle::SpecificLong
        } else {
            ZoneStyle::SpecificShort
        });
    }
    if !has_date && !has_time {
        builder.date_fields = Some(DateFields::YMD);
        builder.time_precision = Some(TimePrecision::Minute);
    }
    builder
        .build_composite()
        .map_err(|error| format!("Unsupported date/time fields: {error}"))
}

// ---------------------------------------------------------------------------
// Constructors.

unsafe extern "C" fn plural(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, kind, key] = arguments::<3>(env, info);
    let (Some(loc), Some(kind), Some(key)) = (
        string_argument(env, loc),
        string_argument(env, kind),
        string_argument(env, key),
    ) else {
        return throw(env, "plural(locale, type, key)");
    };
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || {
                let rules = if kind == "ordinal" {
                    PluralRules::try_new_ordinal(locale.into())
                } else {
                    PluralRules::try_new_cardinal(locale.into())
                };
                rules
                    .map(Formatter::Plural)
                    .map_err(|error| format!("Plural rules: {error}"))
            })
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

unsafe extern "C" fn number_formatter(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, style, currency, group, key] = arguments::<5>(env, info);
    let (Some(loc), Some(style), Some(key)) = (
        string_argument(env, loc),
        string_argument(env, style),
        string_argument(env, key),
    ) else {
        return throw(env, "number(locale, style, currency, grouping, key)");
    };
    let currency = string_argument(env, currency).unwrap_or_default();
    let group = string_argument(env, group).unwrap_or_else(|| String::from("auto"));
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        let mut decimal_options = DecimalFormatterOptions::default();
        decimal_options.grouping_strategy = Some(grouping(&group));
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || {
                let formatter = match style.as_str() {
                    "currency" => {
                        let code = CurrencyType::try_from_str(&currency)
                            .map_err(|_| format!("Invalid currency code: {currency}"))?;
                        CurrencyFormatter::try_new_symbol(
                            locale.into(),
                            code,
                            CurrencyFormatterOptions::default(),
                        )
                        .map(NumberFormatter::Currency)
                    }
                    "percent" => PercentFormatter::try_new(locale.into(), Default::default())
                        .map(NumberFormatter::Percent),
                    _ => DecimalFormatter::try_new(locale.into(), decimal_options)
                        .map(NumberFormatter::Decimal),
                };
                formatter
                    .map(Formatter::Number)
                    .map_err(|error| format!("Number formatter: {error}"))
            })
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

unsafe extern "C" fn date_formatter(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, date, time, zone, zone_long, key] = arguments::<6>(env, info);
    let (Some(loc), Some(date), Some(time), Some(key)) = (
        string_argument(env, loc),
        string_argument(env, date),
        string_argument(env, time),
        string_argument(env, key),
    ) else {
        return throw(env, "date(locale, date, time, timeZone, long, key)");
    };
    // An empty zone means "shift the clock but show no zone name".
    let zone = string_argument(env, zone).filter(|zone| !zone.is_empty());
    let zone_long = number_or(env, zone_long, 0.0) != 0.0;
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        let fields = date_field_set(&date, &time, zone.is_some(), zone_long)?;
        let time_zone = zone.map(|name| TimeZone::from_iana_id(&name));
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || {
                DateTimeFormatter::try_new(locale.into(), fields)
                    .map(|formatter| Formatter::Date {
                        formatter,
                        zone: time_zone,
                    })
                    .map_err(|error| format!("Date formatter: {error}"))
            })
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

unsafe extern "C" fn relative_formatter(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, unit, style, numeric, key] = arguments::<5>(env, info);
    let (Some(loc), Some(unit), Some(style), Some(key)) = (
        string_argument(env, loc),
        string_argument(env, unit),
        string_argument(env, style),
        string_argument(env, key),
    ) else {
        return throw(env, "relative(locale, unit, style, numeric, key)");
    };
    let numeric = string_argument(env, numeric).unwrap_or_else(|| String::from("always"));
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        let formatter = relative(&locale, &unit, &style, &numeric)?;
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || Ok(Formatter::Relative(formatter)))
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

unsafe extern "C" fn list_formatter(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, kind, style, key] = arguments::<4>(env, info);
    let (Some(loc), Some(kind), Some(style), Some(key)) = (
        string_argument(env, loc),
        string_argument(env, kind),
        string_argument(env, style),
        string_argument(env, key),
    ) else {
        return throw(env, "list(locale, type, style, key)");
    };
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        let length = match style.as_str() {
            "short" => ListLength::Short,
            "narrow" => ListLength::Narrow,
            _ => ListLength::Wide,
        };
        let options = ListFormatterOptions::default().with_length(length);
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || {
                let formatter = match kind.as_str() {
                    "disjunction" => ListFormatter::try_new_or(locale.into(), options),
                    "unit" => ListFormatter::try_new_unit(locale.into(), options),
                    _ => ListFormatter::try_new_and(locale.into(), options),
                };
                formatter
                    .map(Formatter::List)
                    .map_err(|error| format!("List formatter: {error}"))
            })
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

unsafe extern "C" fn collator(env: napi_env, info: napi_callback_info) -> napi_value {
    let [loc, key] = arguments::<2>(env, info);
    let (Some(loc), Some(key)) = (string_argument(env, loc), string_argument(env, key)) else {
        return throw(env, "collator(locale, key)");
    };
    let result = (|| -> Result<u32, String> {
        let locale = locale(&loc)?;
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            insert(key, &mut store, || {
                Collator::try_new(locale.into(), CollatorOptions::default())
                    .map(Formatter::Collator)
                    .map_err(|error| format!("Collator: {error}"))
            })
        })
    })();
    match result {
        Ok(handle) => number(env, handle as f64),
        Err(message) => throw(env, &message),
    }
}

// ---------------------------------------------------------------------------
// Formatting.

unsafe fn decimal_argument(env: napi_env, value: napi_value) -> Result<Decimal, String> {
    let mut kind = 0;
    napi_typeof(env, value, &mut kind);
    if kind == NAPI_UNDEFINED {
        return Err(String::from("Expected a number"));
    }
    let text = string_argument(env, value).unwrap_or_else(|| to_string(env, value));
    Decimal::from_str(&text).map_err(|_| format!("Invalid decimal: {text}"))
}

/// Collects text and the part spans ICU4X writes.
#[derive(Default)]
struct Collector {
    text: String,
    spans: Vec<(usize, usize, &'static str)>,
    /// The parts open around the text being written, outermost first.
    stack: Vec<&'static str>,
}

impl Collector {
    /// The part name for text written now. The spec's names are the
    /// semantic ones: `month` around a numeric month, not the inner
    /// `integer`; but a grouping separator is its own `group`.
    fn kind(&self) -> &'static str {
        if self.stack.is_empty() {
            return "literal";
        }
        if self.stack.iter().any(|kind| *kind == "group") {
            return "group";
        }
        for kind in &self.stack {
            if !matches!(*kind, "integer" | "fraction" | "decimal") {
                return kind;
            }
        }
        self.stack.last().copied().unwrap_or("literal")
    }
}

impl fmt::Write for Collector {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let start = self.text.len();
        self.text.push_str(text);
        let end = self.text.len();
        if end > start {
            let kind = self.kind();
            self.spans.push((start, end, kind));
        }
        Ok(())
    }
}

impl PartsWrite for Collector {
    type SubPartsWrite = Self;

    fn with_part(
        &mut self,
        part: Part,
        mut f: impl FnMut(&mut Self::SubPartsWrite) -> fmt::Result,
    ) -> fmt::Result {
        self.stack.push(part.value);
        let result = f(self);
        self.stack.pop();
        result
    }
}

/// Adjacent spans of one kind are one part, as the spec's output has them.
fn merge(spans: Vec<(usize, usize, &'static str)>) -> Vec<(usize, usize, &'static str)> {
    let mut merged: Vec<(usize, usize, &'static str)> = Vec::with_capacity(spans.len());
    for (start, end, kind) in spans {
        if let Some(last) = merged.last_mut() {
            if last.1 == start && last.2 == kind {
                last.1 = end;
                continue;
            }
        }
        merged.push((start, end, kind));
    }
    merged
}

fn write(value: &impl Writeable, parts: bool) -> (String, Vec<(usize, usize, &'static str)>) {
    if !parts {
        return (value.write_to_string().into_owned(), Vec::new());
    }
    let mut collector = Collector::default();
    let _ = value.write_to_parts(&mut collector);
    (collector.text, merge(collector.spans))
}

unsafe fn parts_value(
    env: napi_env,
    text: &str,
    spans: &[(usize, usize, &'static str)],
) -> napi_value {
    let mut array = ptr::null_mut();
    napi_create_array(env, &mut array);
    if spans.is_empty() {
        let mut item = ptr::null_mut();
        napi_create_object(env, &mut item);
        napi_set_named_property(env, item, c"type".as_ptr(), string(env, "literal"));
        napi_set_named_property(env, item, c"value".as_ptr(), string(env, text));
        napi_set_element(env, array, 0, item);
        return array;
    }
    for (index, (start, end, kind)) in spans.iter().enumerate() {
        let mut item = ptr::null_mut();
        napi_create_object(env, &mut item);
        napi_set_named_property(env, item, c"type".as_ptr(), string(env, kind));
        napi_set_named_property(env, item, c"value".as_ptr(), string(env, &text[*start..*end]));
        napi_set_element(env, array, index as u32, item);
    }
    array
}

/// `format(handle, parts, ...)`: the category for a plural, the text for
/// every other formatter, and the parts array when `parts` is set.
///
/// - Number, relative: the value is argument 2.
/// - List: the array is argument 2.
/// - Date: arguments 2..8 are year, month, day, hour, minute, second and the
///   UTC offset in seconds.
unsafe extern "C" fn format(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argv, given) = arguments_given::<9>(env, info);
    let handle = number_or(env, argv[0], -1.0);
    let want_parts = number_or(env, argv[1], 0.0) != 0.0;
    if handle < 0.0 || STORE.with(|store| store.borrow().formatters.get(handle as usize).is_none()) {
        return throw(env, &format!("No formatter {handle}"));
    }
    let value = argv[2];
    let result = STORE.with(|store| -> Result<napi_value, String> {
        let store = store.borrow();
        let formatter = &store.formatters[handle as usize];
        match formatter {
            Formatter::Plural(rules) => {
                let decimal = decimal_argument(env, value)?;
                let operands = PluralOperands::from(&decimal);
                let category = match rules.category_for(operands) {
                    PluralCategory::Zero => "zero",
                    PluralCategory::One => "one",
                    PluralCategory::Two => "two",
                    PluralCategory::Few => "few",
                    PluralCategory::Many => "many",
                    PluralCategory::Other => "other",
                };
                Ok(string(env, category))
            }
            Formatter::Number(number) => {
                let decimal = decimal_argument(env, value)?;
                let (text, spans) = match number {
                    NumberFormatter::Decimal(f) => write(&f.format(&decimal), want_parts),
                    NumberFormatter::Percent(f) => write(&f.format(&decimal), want_parts),
                    NumberFormatter::Currency(f) => {
                        write(&f.format_fixed_decimal(&decimal), want_parts)
                    }
                };
                Ok(if want_parts {
                    parts_value(env, &text, &spans)
                } else {
                    string(env, &text)
                })
            }
            Formatter::Date { formatter, zone } => {
                if given < 9 {
                    return Err(String::from("date format needs its components"));
                }
                let year = number_or(env, argv[2], 1970.0) as i32;
                let month = number_or(env, argv[3], 1.0) as u8;
                let day = number_or(env, argv[4], 1.0) as u8;
                let hour = number_or(env, argv[5], 0.0) as u8;
                let minute = number_or(env, argv[6], 0.0) as u8;
                let second = number_or(env, argv[7], 0.0) as u8;
                let offset = number_or(env, argv[8], 0.0) as i32;
                let date =
                    Date::try_new_iso(year, month, day).map_err(|_| String::from("Invalid date"))?;
                let time = Time::try_new(hour, minute, second, 0)
                    .map_err(|_| String::from("Invalid time"))?;
                let offset = UtcOffset::try_from_seconds(offset)
                    .map_err(|_| String::from("Invalid UTC offset"))?;
                let id = zone.unwrap_or(TimeZone::UNKNOWN);
                let info = id
                    .with_offset(Some(offset))
                    .at_date_time(icu_time::DateTime { date, time });
                let value = ZonedDateTime {
                    date,
                    time,
                    zone: info,
                };
                let (text, spans) = write(&formatter.format(&value), want_parts);
                Ok(if want_parts {
                    parts_value(env, &text, &spans)
                } else {
                    string(env, &text)
                })
            }
            Formatter::Relative(f) => {
                let decimal = decimal_argument(env, value)?;
                let (text, spans) = write(&f.format(decimal), want_parts);
                Ok(if want_parts {
                    parts_value(env, &text, &spans)
                } else {
                    string(env, &text)
                })
            }
            Formatter::List(f) => {
                let items = list_argument(env, value)?;
                let rendered = f.format(items.iter().map(|item| item.as_str()));
                let (text, spans) = write(&rendered, want_parts);
                Ok(if want_parts {
                    parts_value(env, &text, &spans)
                } else {
                    string(env, &text)
                })
            }
            Formatter::Collator(_) => Err(String::from("A collator compares; it does not format")),
        }
    });
    match result {
        Ok(value) => value,
        Err(message) => throw(env, &message),
    }
}

/// The strings of a JavaScript array.
unsafe fn list_argument(env: napi_env, value: napi_value) -> Result<Vec<String>, String> {
    let mut length = 0u32;
    if napi_get_array_length(env, value, &mut length) != NAPI_OK {
        return Err(String::from("Expected an array"));
    }
    let mut items = Vec::with_capacity(length as usize);
    for index in 0..length {
        let mut item = ptr::null_mut();
        napi_get_element(env, value, index, &mut item);
        items.push(to_string(env, item));
    }
    Ok(items)
}

unsafe extern "C" fn compare(env: napi_env, info: napi_callback_info) -> napi_value {
    let [handle, left, right] = arguments::<3>(env, info);
    let handle = number_or(env, handle, -1.0);
    let result = STORE.with(|store| -> Result<f64, String> {
        let store = store.borrow();
        let collator = store
            .formatters
            .get(handle as usize)
            .and_then(|formatter| match formatter {
                Formatter::Collator(collator) => Some(collator),
                _ => None,
            })
            .ok_or_else(|| format!("No collator {handle}"))?;
        let left = to_string(env, left);
        let right = to_string(env, right);
        Ok(match collator.compare(left.as_str(), right.as_str()) {
            std::cmp::Ordering::Less => -1.0,
            std::cmp::Ordering::Equal => 0.0,
            std::cmp::Ordering::Greater => 1.0,
        })
    });
    match result {
        Ok(value) => number(env, value),
        Err(message) => throw(env, &message),
    }
}

/// `stats()`: what has been built, for the "nothing until first use" test.
unsafe extern "C" fn stats(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (formatters, built) = STORE.with(|store| {
        let store = store.borrow();
        (store.formatters.len() as f64, store.built as f64)
    });
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"formatters".as_ptr(), number(env, formatters));
    napi_set_named_property(env, object, c"built".as_ptr(), number(env, built));
    object
}

/// `zoneOffset(zone, epochSeconds)`: the zone's UTC offset at that instant,
/// from the platform's IANA database. The system's `TZ` is set for the
/// duration of the call (one JavaScript thread, one call at a time) and put
/// back afterwards.
#[cfg(unix)]
unsafe extern "C" {
    fn tzset();
}

#[cfg(unix)]
unsafe extern "C" fn zone_offset(env: napi_env, info: napi_callback_info) -> napi_value {
    use std::sync::Mutex;
    static LOCK: Mutex<()> = Mutex::new(());
    let [zone, seconds] = arguments::<2>(env, info);
    let Some(zone) = string_argument(env, zone) else {
        return throw(env, "zoneOffset(zone, epochSeconds)");
    };
    if zone == "UTC" || zone == "Etc/UTC" || zone == "GMT" {
        return number(env, 0.0);
    }
    let seconds = number_or(env, seconds, 0.0) as i64;
    let _guard = LOCK.lock().ok();
    let previous = std::env::var("TZ").ok();
    let Some(name) = std::ffi::CString::new(zone.clone()).ok() else {
        return throw(env, "Invalid time zone");
    };
    let offset = unsafe {
        libc::setenv(c"TZ".as_ptr(), name.as_ptr(), 1);
        tzset();
        let mut tm: libc::tm = std::mem::zeroed();
        let time = seconds as libc::time_t;
        let ok = libc::localtime_r(&time, &mut tm).is_null() == false;
        match previous {
            Some(previous) => {
                if let Ok(previous) = std::ffi::CString::new(previous) {
                    libc::setenv(c"TZ".as_ptr(), previous.as_ptr(), 1);
                }
            }
            None => {
                libc::unsetenv(c"TZ".as_ptr());
            }
        }
        tzset();
        ok.then_some(tm.tm_gmtoff as i32)
    };
    match offset {
        Some(offset) => number(env, offset as f64),
        None => throw(env, &format!("Unsupported time zone: {zone}")),
    }
}

#[cfg(not(unix))]
unsafe extern "C" fn zone_offset(env: napi_env, _info: napi_callback_info) -> napi_value {
    throw(
        env,
        "Time zone offsets are not implemented on this platform",
    )
}

/// The system's IANA time zone, as `TZ` or `/etc/timezone` names it.
unsafe extern "C" fn system_time_zone(env: napi_env, _info: napi_callback_info) -> napi_value {
    let zone = std::env::var("TZ")
        .ok()
        .filter(|zone| !zone.is_empty())
        .or_else(|| {
            std::fs::read_to_string("/etc/timezone")
                .ok()
                .map(|text| text.trim().to_owned())
                .filter(|zone| !zone.is_empty())
        })
        .unwrap_or_else(|| String::from("UTC"));
    string(env, zone.trim_start_matches(':'))
}

/// Installs `__solid.intl`.
pub unsafe fn install(env: napi_env, host: napi_value) {
    let intl = define_object(env, host, c"intl");
    define_function(env, intl, c"plural", plural);
    define_function(env, intl, c"number", number_formatter);
    define_function(env, intl, c"date", date_formatter);
    define_function(env, intl, c"relative", relative_formatter);
    define_function(env, intl, c"list", list_formatter);
    define_function(env, intl, c"collator", collator);
    define_function(env, intl, c"format", format);
    define_function(env, intl, c"compare", compare);
    define_function(env, intl, c"stats", stats);
    define_function(env, intl, c"systemTimeZone", system_time_zone);
    define_function(env, intl, c"zoneOffset", zone_offset);
}
