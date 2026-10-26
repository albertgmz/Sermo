import { expect, test } from "bun:test";
import {
  allows,
  analyticsFor,
  consentOf,
  hasEarlierChoice,
  isUnasked,
  mayEmbed,
  mayStoreReferral,
  NO_CONSENT,
  parseChoice,
  parseConsent,
  sendsGpc,
  standsUnderGpc,
  withoutBanner,
} from "./state";

const cookie = (record: unknown) => encodeURIComponent(JSON.stringify(record));
const google = { provider: "google", measurementId: "G-ABC123" } as const;

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
  expect(analyticsFor(NO_CONSENT, google)).toEqual([]);
  expect(analyticsFor(accepted, google).length).toBeGreaterThan(0);
  expect(analyticsFor(withdrawn, google)).toEqual([]);
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
  ).toEqual({ accepted: ["embeds"], at: Date.parse(at), gpc: false });
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
  });
  const chosen = parseConsent(
    cookie({ categories: ["necessary"], revision: 1 }),
    1,
  );
  expect(withoutBanner(chosen)).toBe(chosen);
});

test("the backend is asked whether the banner applies only to a guest who never answered it, on a Europe-only site", async () => {
  let asked = 0;
  const shown = (answer: boolean) => async () => {
    asked += 1;
    return answer;
  };
  const accepted = cookie({ categories: ["necessary", "embeds"], revision: 2 });
  const everywhere = { version: 2, bannerOutsideEu: true };
  const europeOnly = { version: 2, bannerOutsideEu: false };
  // The banner is for everyone: nobody is asked about it.
  expect(await consentOf(undefined, everywhere, false, shown(false))).toEqual(
    NO_CONSENT,
  );
  // A choice under the current version stands wherever the visitor is.
  expect(await consentOf(accepted, europeOnly, false, shown(false))).toEqual({
    decided: true,
    accepted: ["embeds"],
  });
  expect(asked).toBe(0);
  // No choice at all: inside the banner's reach the answer is none, outside it everything is
  // accepted.
  expect(await consentOf(undefined, europeOnly, false, shown(true))).toEqual(
    NO_CONSENT,
  );
  expect(
    (await consentOf(undefined, europeOnly, false, shown(false))).accepted,
  ).toEqual(["analytics", "referrals", "embeds"]);
});

test("a visitor who answered an earlier policy version is asked again, never treated as accepting, whatever the country", async () => {
  const europeOnly = { version: 2, bannerOutsideEu: false };
  let asked = 0;
  const outside = async () => {
    asked += 1;
    return false;
  };
  for (const earlier of [
    cookie({ categories: ["necessary"], revision: 1 }),
    cookie({ categories: ["necessary", "analytics", "embeds"], revision: 1 }),
    // A later version than the site's (a rollback) is the same: not this version's answer.
    cookie({ categories: ["necessary"], revision: 3 }),
  ]) {
    expect(await consentOf(earlier, europeOnly, false, outside)).toEqual(
      NO_CONSENT,
    );
    expect(await isUnasked(earlier, europeOnly, false, outside)).toBe(false);
  }
  // Nothing readable is no answer: garbage is an unasked guest.
  expect(hasEarlierChoice("garbage", 2)).toBe(false);
  expect(hasEarlierChoice(cookie({ revision: 1 }), 2)).toBe(false);
  expect(hasEarlierChoice(cookie({ categories: [], revision: 2 }), 2)).toBe(
    false,
  );
  expect(hasEarlierChoice(cookie({ categories: [], revision: 1 }), 2)).toBe(
    true,
  );
  // The backend is not even asked.
  expect(asked).toBe(0);
});

test("a signed-in visitor is asked: the site's silence covers guests only", async () => {
  const europeOnly = { version: 2, bannerOutsideEu: false };
  expect(
    await consentOf(undefined, europeOnly, true, async () => false),
  ).toEqual(NO_CONSENT);
  expect(await isUnasked(undefined, europeOnly, true, async () => false)).toBe(
    false,
  );
  expect(await isUnasked(undefined, europeOnly, false, async () => false)).toBe(
    true,
  );
});

test("Global Privacy Control is the header Sec-GPC with the value 1", () => {
  expect(sendsGpc(new Headers({ "sec-gpc": "1" }))).toBe(true);
  for (const value of ["0", "true", ""])
    expect(sendsGpc(new Headers({ "sec-gpc": value })), value).toBe(false);
  expect(sendsGpc(new Headers())).toBe(false);
});

test("a choice says whether it was made under Global Privacy Control, and only such a choice or a refusal stands under it", () => {
  const made = (data: unknown, ...categories: string[]) =>
    parseChoice(
      cookie({ categories: ["necessary", ...categories], revision: 1, data }),
      1,
    );
  expect(made({ gpc: true }, "embeds")?.gpc).toBe(true);
  for (const data of [null, undefined, { gpc: "true" }, { source: "account" }])
    expect(made(data, "embeds")?.gpc, JSON.stringify(data)).toBe(false);
  const stands = (choice: ReturnType<typeof made>) =>
    choice !== null && standsUnderGpc(choice);
  expect(stands(made({ gpc: true }, "embeds"))).toBe(true);
  expect(stands(made(null))).toBe(true);
  expect(stands(made(null, "analytics"))).toBe(false);
  // Without the signal the mark changes nothing.
  expect(
    parseConsent(cookie({ categories: ["embeds"], revision: 1 }), 1),
  ).toEqual({ decided: true, accepted: ["embeds"] });
  expect(
    parseConsent(cookie({ categories: ["embeds"], revision: 1 }), 1, true),
  ).toEqual(NO_CONSENT);
});
