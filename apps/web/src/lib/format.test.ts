import { expect, test } from "bun:test";
import {
  formatBytes,
  formatCompact,
  formatCredits,
  formatDate,
  formatDateTime,
  formatNumber,
} from "./format";

const DATE = "2026-03-09T14:05:00.000Z";

test("dates follow the language: English and Spanish month names", () => {
  expect(formatDate(DATE, "en")).toBe("Mar 9, 2026");
  expect(formatDate(DATE, "es")).toBe("9 mar 2026");
  expect(formatDateTime(DATE, "en")).toContain("Mar 9, 2026");
  expect(formatDateTime(DATE, "es")).toContain("9 mar 2026");
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

test("credit amounts are always grouped: Spanish groups four digits too, plain numbers do not", () => {
  expect(formatNumber(2300, "es")).toBe("2300");
  expect(formatCredits(2300, "es")).toBe("2.300");
  expect(formatCredits(2300, "en")).toBe("2,300");
  expect(formatCredits(39000, "es")).toBe("39.000");
  expect(formatCredits(900, "es")).toBe("900");
});

test("a signed credit amount shows its sign and the grouping", () => {
  expect(formatCredits(2300, "es", { signed: true })).toBe("+2.300");
  expect(formatCredits(-2300, "en", { signed: true })).toBe("\u22122,300");
  expect(formatCredits(0, "en", { signed: true })).toBe("+0");
});

test("credit grouping is made here, in threes with the locale's symbol, from any number of digits", () => {
  expect(formatCredits(1234567, "es")).toBe("1.234.567");
  expect(formatCredits(1234567, "en")).toBe("1,234,567");
  expect(formatCredits(-2300, "es")).toBe("\u22122.300");
  expect(formatCredits(999, "es")).toBe("999");
  expect(formatCredits(1000, "es")).toBe("1.000");
  expect(formatCredits(0, "es")).toBe("0");
  // A locale that groups with a space groups four digits too.
  expect(formatCredits(2300, "fr").replace(/\s/g, " ")).toBe("2 300");
});

test("the credit formatter asks for no grouping option an older browser might ignore", () => {
  const real = Intl.NumberFormat;
  const asked: unknown[] = [];
  Intl.NumberFormat = new Proxy(real, {
    construct(target, args) {
      asked.push(args[1]?.useGrouping);
      return Reflect.construct(target, args);
    },
  });
  try {
    formatCredits(2300, "de-CH");
    formatCredits(2300, "de-CH", { signed: true });
  } finally {
    Intl.NumberFormat = real;
  }
  expect(asked).not.toContain("always");
  expect(asked).not.toContain("min2");
});
