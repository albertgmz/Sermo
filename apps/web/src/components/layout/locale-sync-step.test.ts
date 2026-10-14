import { expect, test } from "bun:test";
import { localeSync } from "./locale-sync-step";

test("a member with no saved language changes nothing", () => {
  expect(
    localeSync({ language: null, active: "en", cookie: undefined }),
  ).toBeNull();
  expect(localeSync({ language: null, active: "es", cookie: "es" })).toBeNull();
});

test("a page already in the saved language changes nothing", () => {
  expect(
    localeSync({ language: "es", active: "es", cookie: undefined }),
  ).toBeNull();
  expect(localeSync({ language: "en", active: "en", cookie: "es" })).toBeNull();
});

test("a page in another language sets the cookie and reads the page again", () => {
  expect(
    localeSync({ language: "es", active: "en", cookie: undefined }),
  ).toEqual({ set: "es", refresh: true });
  expect(localeSync({ language: "es", active: "en", cookie: "en" })).toEqual({
    set: "es",
    refresh: true,
  });
});

test("a cookie that already holds the language is not written again, so a refresh never loops", () => {
  expect(localeSync({ language: "es", active: "en", cookie: "es" })).toBeNull();
});
