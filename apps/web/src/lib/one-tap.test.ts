import { expect, test } from "bun:test";
import { oneTapRefusalAddress } from "./one-tap";

test("a One Tap refusal goes to the sign-in page with Google and the backend's code", async () => {
  expect(
    oneTapRefusalAddress(400, { code: "email_not_verified", message: "x" }),
  ).toBe("/login?via=google&error=email_not_verified");
  expect(oneTapRefusalAddress(403, { code: "REGISTRATION_CLOSED" })).toBe(
    "/login?via=google&error=REGISTRATION_CLOSED",
  );
});

test("the 401 without a code is an address that is not linked", () => {
  expect(oneTapRefusalAddress(401, { message: "account not linked" })).toBe(
    "/login?via=google&error=account_not_linked",
  );
});

test("throttling and any other failure have codes of their own", () => {
  expect(oneTapRefusalAddress(429, null)).toBe(
    "/login?via=google&error=RATE_LIMITED",
  );
  expect(oneTapRefusalAddress(500, "not json")).toBe(
    "/login?via=google&error=one_tap_failed",
  );
  expect(oneTapRefusalAddress(0, null)).toBe(
    "/login?via=google&error=one_tap_failed",
  );
});

test("a code that is no plain word is not carried", () => {
  expect(oneTapRefusalAddress(400, { code: "<b>x</b>" })).toBe(
    "/login?via=google&error=one_tap_failed",
  );
});
