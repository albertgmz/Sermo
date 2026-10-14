import { expect, test } from "bun:test";
import { LOCALE_COOKIE, localeCookieValue } from "./locale-cookie";
import {
  DEFAULT_LOCALE,
  fromAcceptLanguage,
  isLocale,
  LOCALES,
  negotiateLocale,
} from "./locales";

test("the interface languages are the ones a member can choose", () => {
  expect([...LOCALES]).toEqual(["en", "es"]);
  expect(DEFAULT_LOCALE).toBe("en");
  expect(isLocale("es")).toBe(true);
  expect(isLocale("fr")).toBe(false);
  expect(isLocale(undefined)).toBe(false);
});

test("the browser's language is the first supported one by preference", () => {
  expect(fromAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
  expect(fromAcceptLanguage("fr-FR,fr;q=0.9")).toBeUndefined();
  expect(fromAcceptLanguage("en-US,es;q=0.5")).toBe("en");
  expect(fromAcceptLanguage("de;q=0.9,es;q=0.3,en;q=0.1")).toBe("es");
  expect(fromAcceptLanguage("es;q=0,en;q=0.1")).toBe("en");
  expect(fromAcceptLanguage(";;;,,,q=")).toBeUndefined();
});

test("the cookie wins over the browser, then the browser, then English", () => {
  expect(negotiateLocale("en", "es")).toBe("en");
  expect(negotiateLocale("es", "en-US")).toBe("es");
  expect(negotiateLocale("fr", "es")).toBe("es");
  expect(negotiateLocale(undefined, "fr")).toBe("en");
  expect(negotiateLocale(undefined, null)).toBe("en");
});

test("the cookie is found in a cookie string", () => {
  expect(localeCookieValue(`a=1; ${LOCALE_COOKIE}=es; b=2`)).toBe("es");
  expect(localeCookieValue("a=1")).toBeUndefined();
  expect(localeCookieValue("")).toBeUndefined();
});
