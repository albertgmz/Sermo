import messages from "../../messages/en/lib.json";

type DateInput = string | number | Date;

// Match the fixed locale and time zone in i18n/request without a server import.
const LOCALE = "en";
const TIME_ZONE = "UTC";

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "medium",
  timeZone: TIME_ZONE,
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});
const compact = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat(LOCALE);

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
  now: DateInput = Date.now(),
): string {
  const seconds = (new Date(date).getTime() - new Date(now).getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return messages.format.recent;
}

export function formatDate(date: DateInput): string {
  return dateFormat.format(new Date(date));
}

export function formatDateTime(date: DateInput): string {
  return dateTimeFormat.format(new Date(date));
}

export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatNumber(value: number): string {
  return full.format(value);
}
