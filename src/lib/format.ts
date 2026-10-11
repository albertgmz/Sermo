type DateInput = string | number | Date;

const LOCALE = "en-US";

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { timeStyle: "short" });
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
  return "just now";
}

export function formatDate(date: DateInput): string {
  return dateFormat.format(new Date(date));
}

export function formatDateTime(date: DateInput): string {
  const value = new Date(date);
  return `${dateFormat.format(value)} at ${timeFormat.format(value)}`;
}

export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatNumber(value: number): string {
  return full.format(value);
}
