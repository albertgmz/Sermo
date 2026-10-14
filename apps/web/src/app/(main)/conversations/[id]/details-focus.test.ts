import { expect, test } from "bun:test";
import {
  expectDetailsFocus,
  forgetDetailsFocus,
  isRedirect,
  MARK_MS,
  takeDetailsFocus,
} from "./details-focus";

test("a write that was expected gives the focus back once", () => {
  expectDetailsFocus(1000);
  expect(takeDetailsFocus(1500)).toBe(true);
  expect(takeDetailsFocus(1500)).toBe(false);
});

test("a refused write, or no write, gives nothing back", () => {
  expect(takeDetailsFocus(0)).toBe(false);
  expectDetailsFocus(0);
  forgetDetailsFocus();
  expect(takeDetailsFocus(10)).toBe(false);
});

test("a mark that is too old is ignored", () => {
  expectDetailsFocus(0);
  expect(takeDetailsFocus(MARK_MS + 1)).toBe(false);
});

test("a redirect is told from another failure", () => {
  expect(
    isRedirect({ digest: "NEXT_REDIRECT;push;/conversations/3;307;" }),
  ).toBe(true);
  expect(isRedirect(new Error("boom"))).toBe(false);
  expect(isRedirect(null)).toBe(false);
});
