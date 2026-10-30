import { expect, test } from "bun:test";
import { LOCALE_COOKIE, localeCookieValue } from "./locale-cookie";
import { DEFAULT_LOCALE, isLocale, LOCALES, negotiateLocale } from "./locales";

test("the interface languages are the ones a member can choose", () => {
  expect([...LOCALES]).toEqual(["en", "es"]);
  expect(DEFAULT_LOCALE).toBe("es");
  expect(isLocale("es")).toBe(true);
  expect(isLocale("fr")).toBe(false);
  expect(isLocale(undefined)).toBe(false);
});

test("the cookie wins, then the site default, then Spanish", () => {
  expect(negotiateLocale("en", "es")).toBe("en");
  expect(negotiateLocale("es", "en")).toBe("es");
  expect(negotiateLocale("fr", "en")).toBe("en");
  expect(negotiateLocale("xx", "es")).toBe("es");
  expect(negotiateLocale(undefined, "en")).toBe("en");
  expect(negotiateLocale(undefined, "xx")).toBe("es");
  expect(negotiateLocale(undefined, null)).toBe("es");
  expect(negotiateLocale(undefined)).toBe("es");
  expect(negotiateLocale("fr")).toBe("es");
});

test("the cookie is found in a cookie string", () => {
  expect(localeCookieValue(`a=1; ${LOCALE_COOKIE}=es; b=2`)).toBe("es");
  expect(localeCookieValue("a=1")).toBeUndefined();
  expect(localeCookieValue("")).toBeUndefined();
});
