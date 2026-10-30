import { expect, test } from "bun:test";
import { formatPast } from "./format";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const JUST_NOW = { en: "just now", es: "ahora mismo" };

function ago(ms: number, locale: "en" | "es") {
  return formatPast(
    new Date(NOW.getTime() - ms),
    NOW,
    locale,
    JUST_NOW[locale],
  );
}

const BANDS: [string, number, string, string][] = [
  ["0 s", 0, "just now", "ahora mismo"],
  ["59 s", 59_000, "just now", "ahora mismo"],
  ["1 min", MIN, "1 minute ago", "hace 1 minuto"],
  ["59 min", 59 * MIN, "59 minutes ago", "hace 59 minutos"],
  ["59 min 59 s", HOUR - 1000, "59 minutes ago", "hace 59 minutos"],
  ["1 h", HOUR, "1 hour ago", "hace 1 hora"],
  ["23 h", 23 * HOUR, "23 hours ago", "hace 23 horas"],
  ["1 d", DAY, "yesterday", "ayer"],
  ["2 d", 2 * DAY, "2 days ago", "hace 2 días"],
  ["3 d", 3 * DAY, "3 days ago", "hace 3 días"],
  ["3 d + 1 s", 3 * DAY + 1000, "Oct 27", "27 oct"],
  ["10 d", 10 * DAY, "Oct 20", "20 oct"],
];

for (const [name, ms, en, es] of BANDS) {
  test(`${name} ago reads as the band says, in English and Spanish`, () => {
    expect(ago(ms, "en")).toBe(en);
    expect(ago(ms, "es")).toBe(es);
  });
}

test("a date in another year shows the year", () => {
  const old = new Date("2025-10-12T08:00:00.000Z");
  expect(formatPast(old, NOW, "en", "just now")).toBe("Oct 12, 2025");
  expect(formatPast(old, NOW, "es", "ahora mismo")).toBe("12 oct 2025");
});

test("a date in the current year hides the year", () => {
  const old = new Date("2026-01-05T08:00:00.000Z");
  expect(formatPast(old, NOW, "en", "just now")).toBe("Jan 5");
  expect(formatPast(old, NOW, "es", "ahora mismo")).toBe("5 ene");
});

test("the year is read in UTC, as the date is", () => {
  const now = new Date("2027-01-01T00:30:00.000Z");
  const old = new Date("2026-12-20T23:30:00.000Z");
  expect(formatPast(old, now, "en", "just now")).toBe("Dec 20, 2026");
});

test("a moment after now (clock difference) reads as just now", () => {
  const ahead = new Date(NOW.getTime() + 5000);
  expect(formatPast(ahead, NOW, "en", "just now")).toBe("just now");
});
