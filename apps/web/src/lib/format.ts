type DateInput = string | number | Date;

// Match the time zone in i18n/request without a server import.
const TIME_ZONE = "UTC";

// The formatters of one locale, built on first use. Every helper below takes the active locale
// (`getLocale()` in an async Server Component, `useLocale()` elsewhere).
function build(locale: string) {
  return {
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "always" }),
    // "yesterday" for one day. Two days in Spanish would read "anteayer" with this one.
    yesterday: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    date: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: TIME_ZONE,
    }),
    shortDate: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: TIME_ZONE,
    }),
    shortDateYear: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: TIME_ZONE,
    }),
    dateTime: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: TIME_ZONE,
    }),
    compact: new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }),
    full: new Intl.NumberFormat(locale),
    // Credit amounts are grouped by `formatCredits`, not by `useGrouping: "always"`: that option
    // is newer than the string forms and an older browser would ignore it and write 2300 where the
    // server wrote 2.300. These two never group; the group symbol is the locale's own.
    ungrouped: new Intl.NumberFormat(locale, { useGrouping: false }),
    ungroupedSigned: new Intl.NumberFormat(locale, {
      useGrouping: false,
      signDisplay: "always",
    }),
    groupSymbol:
      new Intl.NumberFormat(locale)
        .formatToParts(1_000_000)
        .find((part) => part.type === "group")?.value ?? ",",
  };
}

const memo = new Map<string, ReturnType<typeof build>>();

function formatters(locale: string) {
  let found = memo.get(locale);
  if (!found) {
    found = build(locale);
    memo.set(locale, found);
  }
  return found;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A moment up to this far back reads as an age; an older one reads as a date.
const AGE_LIMIT = 3 * DAY;

function unitAge(ms: number): [number, Intl.RelativeTimeFormatUnit] {
  if (ms >= DAY) return [Math.floor(ms / DAY), "day"];
  if (ms >= HOUR) return [Math.floor(ms / HOUR), "hour"];
  return [Math.floor(ms / MINUTE), "minute"];
}

/**
 * A past moment for readers: "just now" under a minute (`justNow`, the caller's own text),
 * then minutes, hours and days back to three days ("yesterday" for one day), then the date, with
 * the year only when it is not the year of `now`. The wording is the language's own (`Intl`).
 * A moment after `now` counts as just now. Pass the same `now` on the server and in the browser
 * and both write the same text.
 */
export function formatPast(
  date: DateInput,
  now: DateInput,
  locale: string,
  justNow: string,
): string {
  const moment = new Date(date);
  const age = new Date(now).getTime() - moment.getTime();
  if (age < MINUTE) return justNow;
  if (age > AGE_LIMIT) {
    const { shortDate, shortDateYear } = formatters(locale);
    const sameYear = moment.getUTCFullYear() === new Date(now).getUTCFullYear();
    return (sameYear ? shortDate : shortDateYear).format(moment);
  }
  const [count, unit] = unitAge(age);
  const { relative, yesterday } = formatters(locale);
  return (unit === "day" && count === 1 ? yesterday : relative).format(
    -count,
    unit,
  );
}

export function formatDate(date: DateInput, locale: string): string {
  return formatters(locale).date.format(new Date(date));
}

export function formatDateTime(date: DateInput, locale: string): string {
  return formatters(locale).dateTime.format(new Date(date));
}

export function formatCompact(value: number, locale: string): string {
  return formatters(locale).compact.format(value);
}

export function formatNumber(value: number, locale: string): string {
  return formatters(locale).full.format(value);
}

const MINUS = "\u2212";

// An amount of credits (a price, a balance, a ledger line): the one formatter for all of them.
// Always grouped in threes with the locale's symbol (Spanish groups only from five digits by
// default, so 2300 would read as a bare number): the digits come from `Intl` ungrouped and the
// separators are put in here, so the text is the same on a server and in any browser, whatever its
// `Intl.NumberFormat` supports. `signed` shows + or - before the amount, for a ledger line. A minus
// is always the typographic one (U+2212), signed or not, so a debit reads the same everywhere.
export function formatCredits(
  value: number,
  locale: string,
  { signed = false }: { signed?: boolean } = {},
): string {
  const { ungrouped, ungroupedSigned, groupSymbol } = formatters(locale);
  return (signed ? ungroupedSigned : ungrouped)
    .formatToParts(value)
    .map((part) =>
      part.type === "integer"
        ? part.value.replace(/\B(?=(\d{3})+$)/g, groupSymbol)
        : part.type === "minusSign"
          ? MINUS
          : part.value,
    )
    .join("");
}

// A file's size in the unit that reads best, up to one decimal.
export function formatBytes(bytes: number, locale: string): string {
  const [unit, size] =
    bytes < 1024
      ? (["byte", bytes] as const)
      : bytes < 1024 * 1024
        ? (["kilobyte", bytes / 1024] as const)
        : (["megabyte", bytes / (1024 * 1024)] as const);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  }).format(size);
}
