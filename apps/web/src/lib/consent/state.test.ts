import { expect, test } from "bun:test";
import {
  allows,
  analyticsFor,
  consentOf,
  isCookielessMatomo,
  mayEmbed,
  mayStoreReferral,
  NO_CONSENT,
  parseChoice,
  parseConsent,
  withoutBanner,
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

test("a choice carries the time of its latest change", () => {
  const at = "2026-10-01T10:00:00.000Z";
  expect(
    parseChoice(
      cookie({
        categories: ["necessary", "embeds"],
        revision: 3,
        consentTimestamp: at,
      }),
      3,
    ),
  ).toEqual({ accepted: ["embeds"], at: Date.parse(at) });
  const later = "2026-10-05T10:00:00.000Z";
  expect(
    parseChoice(
      cookie({
        categories: ["necessary"],
        revision: 3,
        consentTimestamp: at,
        lastConsentTimestamp: later,
      }),
      3,
    )?.at,
  ).toBe(Date.parse(later));
  // Without a usable time the choice still counts, as the oldest.
  expect(parseChoice(cookie({ categories: [], revision: 3 }), 3)?.at).toBe(0);
  expect(parseChoice(cookie({ categories: [], revision: 2 }), 3)).toBeNull();
});

test("a visitor the banner is not shown to counts as accepting, until they choose", () => {
  expect(withoutBanner(NO_CONSENT)).toEqual({
    decided: false,
    accepted: ["analytics", "referrals", "embeds"],
    implied: true,
  });
  const chosen = parseConsent(
    cookie({ categories: ["necessary"], revision: 1 }),
    1,
  );
  expect(withoutBanner(chosen)).toBe(chosen);
});

test("the backend is asked whether the banner applies only to a visitor who has chosen nothing on a Europe-only site", async () => {
  let asked = 0;
  const shown = (answer: boolean) => async () => {
    asked += 1;
    return answer;
  };
  const accepted = cookie({ categories: ["necessary", "embeds"], revision: 2 });
  const everywhere = { version: 2, bannerOutsideEu: true };
  const europeOnly = { version: 2, bannerOutsideEu: false };
  // The banner is for everyone: nobody is asked about it.
  expect(await consentOf(undefined, everywhere, shown(false))).toEqual(
    NO_CONSENT,
  );
  // A choice under the current version stands wherever the visitor is.
  expect(await consentOf(accepted, europeOnly, shown(false))).toEqual({
    decided: true,
    accepted: ["embeds"],
  });
  expect(asked).toBe(0);
  // No choice (or one under another version): inside the banner's reach the answer is none,
  // outside it everything is accepted.
  expect(await consentOf(undefined, europeOnly, shown(true))).toEqual(
    NO_CONSENT,
  );
  expect((await consentOf(undefined, europeOnly, shown(false))).implied).toBe(
    true,
  );
  expect(
    (
      await consentOf(
        cookie({ categories: ["analytics"], revision: 1 }),
        europeOnly,
        shown(false),
      )
    ).accepted,
  ).toEqual(["analytics", "referrals", "embeds"]);
});

test("cookieless Matomo is emitted without any choice, with cookies disabled before the first page view", () => {
  const withdrawn = parseConsent(
    cookie({ categories: ["necessary"], revision: 1 }),
    1,
  );
  for (const consent of [NO_CONSENT, withdrawn]) {
    const snippets = analyticsFor(consent, matomo, true);
    expect(snippets.length).toBeGreaterThan(0);
    const code = snippets.map((s) => s.code ?? "").join("");
    expect(code).toContain("'disableCookies'");
    expect(code.indexOf("disableCookies")).toBeLessThan(
      code.indexOf("trackPageView"),
    );
  }
  // The flag does nothing for another provider, and off it is the ordinary tag behind consent.
  expect(
    isCookielessMatomo({ provider: "google", measurementId: "G-1" }, true),
  ).toBe(false);
  expect(
    analyticsFor(
      NO_CONSENT,
      { provider: "google", measurementId: "G-1" },
      true,
    ),
  ).toEqual([]);
  expect(analyticsFor(NO_CONSENT, matomo, false)).toEqual([]);
  const ordinary = parseConsent(
    cookie({ categories: ["necessary", "analytics"], revision: 1 }),
    1,
  );
  expect(
    analyticsFor(ordinary, matomo, false)
      .map((s) => s.code ?? "")
      .join(""),
  ).not.toContain("disableCookies");
});
