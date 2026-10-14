import { expect, test } from "bun:test";
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "./format";

const DATE = "2026-03-09T14:05:00.000Z";

test("dates follow the language: English and Spanish month names", () => {
  expect(formatDate(DATE, "en")).toBe("Mar 9, 2026");
  expect(formatDate(DATE, "es")).toBe("9 mar 2026");
  expect(formatDateTime(DATE, "en")).toContain("Mar 9, 2026");
  expect(formatDateTime(DATE, "es")).toContain("9 mar 2026");
});

test("relative times are spoken in the language", () => {
  const now = "2026-03-09T14:05:00.000Z";
  expect(formatRelativeTime("2026-03-06T14:05:00.000Z", "en", now)).toBe(
    "3 days ago",
  );
  expect(formatRelativeTime("2026-03-06T14:05:00.000Z", "es", now)).toBe(
    "hace 3 días",
  );
  expect(formatRelativeTime("2026-03-08T14:05:00.000Z", "es", now)).toBe(
    "ayer",
  );
});

test("numbers use the separators of the language", () => {
  expect(formatNumber(1234567.5, "en")).toBe("1,234,567.5");
  expect(formatNumber(1234567.5, "es")).toBe("1.234.567,5");
  expect(formatCompact(24512, "en")).toBe("24.5K");
  expect(
    formatCompact(24512, "es").replaceAll(String.fromCharCode(160), " "),
  ).toBe("24,5 mil");
  expect(formatBytes(1536, "en")).toBe("1.5 kB");
  expect(formatBytes(1536, "es")).toBe("1,5 kB");
});

test("the time zone stays UTC in every language", () => {
  expect(formatDateTime("2026-03-09T23:30:00.000Z", "en")).toContain("11:30");
  expect(formatDate("2026-03-09T23:30:00.000Z", "es")).toBe("9 mar 2026");
});
