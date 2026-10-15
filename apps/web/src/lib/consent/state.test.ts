import { expect, test } from "bun:test";
import {
  allows,
  analyticsFor,
  mayEmbed,
  mayStoreReferral,
  NO_CONSENT,
  parseConsent,
  policyVersion,
} from "./state";

const cookie = (record: unknown) => encodeURIComponent(JSON.stringify(record));
const matomo = {
  provider: "matomo",
  url: "https://stats.example.com",
  siteId: 3,
} as const;

test("no cookie, a broken one or one of another policy version is no choice", () => {
  expect(parseConsent(undefined, 1)).toEqual(NO_CONSENT);
  expect(parseConsent("%E0%A4%A", 1)).toEqual(NO_CONSENT);
  expect(parseConsent("not json", 1)).toEqual(NO_CONSENT);
  expect(parseConsent(cookie(null), 1)).toEqual(NO_CONSENT);
  expect(
    parseConsent(cookie({ categories: "analytics", revision: 1 }), 1),
  ).toEqual(NO_CONSENT);
  expect(
    parseConsent(
      cookie({ categories: ["necessary", "analytics"], revision: 1 }),
      2,
    ),
  ).toEqual(NO_CONSENT);
});

test("a choice records the optional categories accepted, nothing else", () => {
  const consent = parseConsent(
    cookie({ categories: ["necessary", "embeds", "bogus"], revision: 2 }),
    2,
  );
  expect(consent).toEqual({ decided: true, accepted: ["embeds"] });
  expect(allows(consent, "embeds")).toBe(true);
  expect(allows(consent, "analytics")).toBe(false);
  expect(
    parseConsent(cookie({ categories: ["necessary"], revision: 1 }), 1),
  ).toEqual({
    decided: true,
    accepted: [],
  });
});

test("analytics is emitted only while the category is accepted", () => {
  const accepted = parseConsent(
    cookie({ categories: ["necessary", "analytics"], revision: 1 }),
    1,
  );
  const withdrawn = parseConsent(
    cookie({ categories: ["necessary"], revision: 1 }),
    1,
  );
  expect(analyticsFor(NO_CONSENT, matomo)).toEqual([]);
  expect(analyticsFor(accepted, matomo).length).toBeGreaterThan(0);
  expect(analyticsFor(withdrawn, matomo)).toEqual([]);
  expect(analyticsFor(accepted, { provider: "none" })).toEqual([]);
  // Another category does not stand in for analytics.
  const other = parseConsent(
    cookie({ categories: ["necessary", "embeds", "referrals"], revision: 1 }),
    1,
  );
  expect(
    analyticsFor(other, { provider: "google", measurementId: "G-1" }),
  ).toEqual([]);
});

test("the referral cookie and players need their own category", () => {
  const referrals = parseConsent(
    cookie({ categories: ["necessary", "referrals"], revision: 1 }),
    1,
  );
  expect(mayStoreReferral(NO_CONSENT)).toBe(false);
  expect(mayStoreReferral(referrals)).toBe(true);
  expect(mayEmbed(referrals)).toBe(false);
  expect(
    mayEmbed(
      parseConsent(
        cookie({ categories: ["necessary", "embeds"], revision: 1 }),
        1,
      ),
    ),
  ).toBe(true);
});

test("the policy version comes from the site once the backend sends one", () => {
  expect(policyVersion({})).toBe(1);
  expect(policyVersion({ cookiePolicyVersion: 4 })).toBe(4);
  expect(policyVersion({ cookiePolicyVersion: 0 })).toBe(1);
  expect(policyVersion({ cookiePolicyVersion: "4" })).toBe(1);
  expect(policyVersion({ cookiePolicyVersion: 1.5 })).toBe(1);
});
