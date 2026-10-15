import { expect, test } from "bun:test";
import { CONSENT_CATEGORIES } from "@sermo/core/contracts";
import { onTheWire } from "../../../tests/wire-cookies";
import { type AccountRecord, consentCookieValue, reconcile } from "./account";
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

test("when both have a choice and they differ, the later one wins; equal choices need nothing", () => {
  expect(
    reconcile(device(LATE, "embeds"), record(2, EARLY, "analytics"), 2),
  ).toBe("save");
  expect(
    reconcile(device(EARLY, "embeds"), record(2, LATE, "analytics"), 2),
  ).toBe("adopt");
  // The same moment: the account, which is the proof, stays.
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
