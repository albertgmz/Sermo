import { expect, test } from "bun:test";
import { consentCookie } from "../../../scripts/lighthouse-lib";
import {
  type AccountRecord,
  consentCookieValue,
} from "../src/lib/consent/account";
import { OPTIONAL_CATEGORIES } from "../src/lib/consent/inventory";
import { parseChoice } from "../src/lib/consent/state";

// The Lighthouse runner (scripts/lighthouse-lib.ts) writes the cookie the banner writes on
// "Accept all", for its runs "after the banner". This pins its shape to the app's: the server reads
// it as a choice of the policy version in force, and it has the fields the library and the account
// sync write.

test("the Lighthouse runner's consent cookie is read as an accepted choice of the policy version", () => {
  const record = JSON.parse(decodeURIComponent(consentCookie(4).value));
  expect(parseChoice(consentCookie(4).value, 4)?.accepted).toEqual([
    ...OPTIONAL_CATEGORIES,
  ]);
  expect(parseChoice(consentCookie(4).value, 5)).toBeNull();
  expect(record.categories).toEqual(["necessary", ...OPTIONAL_CATEGORIES]);
});

test("it carries the fields the app writes for a choice made elsewhere", () => {
  const account: AccountRecord = {
    categories: [...OPTIONAL_CATEGORIES],
    policyVersion: 1,
    decidedAt: "2026-10-01T10:00:00.000Z",
  };
  const app = Object.keys(
    JSON.parse(consentCookieValue(account, "en", "id")),
  ).sort();
  const runner = Object.keys(
    JSON.parse(decodeURIComponent(consentCookie(1).value)),
  ).sort();
  // The library's own cookie also has the time it expires; the account's copy leaves it out.
  expect(runner).toEqual([...app, "expirationTime"].sort());
});
