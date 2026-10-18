import { expect, test } from "bun:test";
import { CONSENT_CATEGORIES } from "@sermo/core/contracts";
import { onTheWire } from "../../../tests/wire-cookies";
import {
  type AccountRecord,
  cameFromAccount,
  consentCookieValue,
  reconcile,
} from "./account";
import { OPTIONAL_CATEGORIES } from "./inventory";
import { parseChoice, parseConsent } from "./state";

const record = (
  policyVersion: number,
  decidedAt: string,
  ...categories: AccountRecord["categories"][number][]
): AccountRecord => ({ categories, policyVersion, decidedAt });
const device = (
  at: string,
  ...accepted: AccountRecord["categories"][number][]
) => ({
  accepted,
  at: Date.parse(at),
  gpc: false,
});
const EARLY = "2026-10-01T10:00:00.000Z";
const LATE = "2026-10-02T10:00:00.000Z";

test("the web app's categories are the backend's", () => {
  expect([...OPTIONAL_CATEGORIES]).toEqual([...CONSENT_CATEGORIES]);
});

test("a browser with no choice adopts the account's, if it answers the current version", () => {
  expect(reconcile(null, record(2, EARLY, "embeds"), 2)).toBe("adopt");
  expect(reconcile(null, record(2, EARLY), 2)).toBe("adopt");
  // An older record is no choice: the banner asks.
  expect(reconcile(null, record(1, EARLY, "embeds"), 2)).toBe("none");
  expect(reconcile(null, null, 2)).toBe("none");
});

test("a browser's choice goes to an account that has none for the current version", () => {
  expect(reconcile(device(EARLY, "embeds"), null, 2)).toBe("save");
  expect(
    reconcile(device(EARLY, "embeds"), record(1, LATE, "analytics"), 2),
  ).toBe("save");
});

test("when both have a choice and they differ, the account wins whoever chose last; equal choices need nothing", () => {
  // The browser's choice is newer, but a previous user of a shared browser must not replace the
  // member's own answer.
  expect(
    reconcile(device(LATE, "embeds"), record(2, EARLY, "analytics"), 2),
  ).toBe("adopt");
  expect(
    reconcile(device(EARLY, "embeds"), record(2, LATE, "analytics"), 2),
  ).toBe("adopt");
  expect(
    reconcile(device(LATE, "embeds"), record(2, LATE, "analytics"), 2),
  ).toBe("adopt");
  expect(
    reconcile(
      device(LATE, "embeds", "analytics"),
      record(2, EARLY, "analytics", "embeds"),
      2,
    ),
  ).toBe("none");
  expect(reconcile(device(EARLY), record(2, LATE), 2)).toBe("none");
});

test("a browser clock that is a day ahead decides nothing", () => {
  const ahead = "2026-12-31T10:00:00.000Z";
  const behind = "2026-01-01T10:00:00.000Z";
  // The record is the newest real choice; the browser's clock says otherwise in either direction.
  expect(
    reconcile(device(ahead, "embeds"), record(2, LATE, "analytics"), 2),
  ).toBe("adopt");
  expect(
    reconcile(device(behind, "embeds"), record(2, LATE, "analytics"), 2),
  ).toBe("adopt");
  // And the browser's choice reaches an account that has nothing for this version at any clock.
  expect(reconcile(device(ahead, "embeds"), null, 2)).toBe("save");
  expect(
    reconcile(device(behind, "embeds"), record(1, LATE, "analytics"), 2),
  ).toBe("save");
});

test("a cookie written from the account says so, one the library wrote does not", () => {
  const value = consentCookieValue(record(2, LATE, "embeds"), "en", "id-1");
  const { raw } = onTheWire({ name: "forum_consent", value, path: "/" });
  expect(cameFromAccount(raw)).toBe(true);
  expect(cameFromAccount(undefined)).toBe(false);
  expect(cameFromAccount("garbage")).toBe(false);
  expect(
    cameFromAccount(
      encodeURIComponent(
        JSON.stringify({ categories: ["necessary"], revision: 2, data: null }),
      ),
    ),
  ).toBe(false);
});

test("the cookie written from a record is read back as that record, and only for its version", () => {
  const saved = record(4, LATE, "referrals", "embeds");
  const value = consentCookieValue(
    saved,
    "es",
    "00000000-0000-4000-8000-000000000000",
  );
  // The way the cookie reaches the browser is Next's own: the value is encoded once on the wire,
  // and the library decodes it once and parses the JSON.
  const { raw } = onTheWire({ name: "forum_consent", value, path: "/" });
  const cookie = JSON.parse(decodeURIComponent(raw));
  expect(parseChoice(raw, 4)).toEqual({
    accepted: ["referrals", "embeds"],
    at: Date.parse(LATE),
    gpc: false,
  });
  expect(parseConsent(raw, 3)).toEqual({ decided: false, accepted: [] });
  // What the banner library needs to take the cookie as its own.
  expect(cookie).toMatchObject({
    categories: ["necessary", "referrals", "embeds"],
    revision: 4,
    consentId: "00000000-0000-4000-8000-000000000000",
    consentTimestamp: LATE,
    lastConsentTimestamp: LATE,
    languageCode: "es",
  });
  expect(Object.keys(cookie.services).sort()).toEqual([
    "analytics",
    "embeds",
    "necessary",
    "referrals",
  ]);
});
