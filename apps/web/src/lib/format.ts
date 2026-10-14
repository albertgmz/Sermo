import messages from "../../messages/en/lib.json";

type DateInput = string | number | Date;

// Match the time zone in i18n/request without a server import.
const TIME_ZONE = "UTC";

// The formatters of one locale, built on first use. Every helper below takes the active locale
// (`getLocale()` in an async Server Component, `useLocale()` elsewhere).
function build(locale: string) {
  return {
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    date: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/**
 * @deprecated Use RelativeTime, or format.relativeTime(new Date(date), now)
 * with useFormatter/useNow (getFormatter/getNow in async Server Components).
 * Read now only after request-time data; retained for other zones' callers.
 */
export function formatRelativeTime(
  date: DateInput,
  locale: string,
  now: DateInput = Date.now(),
): string {
  const seconds = (new Date(date).getTime() - new Date(now).getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatters(locale).relative.format(
        Math.round(seconds / size),
        unit,
      );
    }
  }
  return messages.format.recent;
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
