import { describe, expect, test } from "bun:test";
import {
  type CardState,
  cardShown,
  fromSearchEngine,
  REPLIES_FOR_FIRST_INVITE,
  readSnooze,
  SEARCH_VISIT,
  SNOOZE_DAYS,
  scrolledEnough,
  searchVisit,
  threadInvites,
} from "@/lib/signup-nudges";

const OWN = "fcuba.net";
const DAY = 24 * 60 * 60 * 1000;

const ENGINES: [string, string][] = [
  ["Google", "https://www.google.com/"],
  ["Google in Spain", "https://www.google.es/"],
  ["Google in Cuba", "https://www.google.com.cu/"],
  [
    "the Google app on Android",
    "android-app://com.google.android.googlequicksearchbox/",
  ],
  ["Bing", "https://www.bing.com/search?q=foro"],
  ["DuckDuckGo", "https://duckduckgo.com/"],
  ["Yahoo", "https://es.search.yahoo.com/"],
  ["Yahoo Japan", "https://search.yahoo.co.jp/"],
  ["Yandex", "https://yandex.ru/"],
  ["Yandex in English", "https://yandex.com/search/?text=cuba"],
  ["Ya.ru", "https://ya.ru/"],
  ["Ecosia", "https://www.ecosia.org/search?q=cuba"],
  ["Brave Search", "https://search.brave.com/search?q=cuba"],
];

const OTHERS: [string, string][] = [
  ["a page of this site", "https://fcuba.net/threads/7"],
  ["no page at all", ""],
  ["a social network", "https://www.facebook.com/"],
  ["another forum", "https://www.forocubano.com/"],
  ["a site that only names an engine", "https://google.example.com/"],
  ["an engine's name inside another domain", "https://notgoogle.com/"],
  ["Brave's own site", "https://brave.com/"],
  ["a page that is not on the web", "file:///home/google.com"],
];

describe("a visit from a search engine", () => {
  for (const [name, referrer] of ENGINES)
    test(`comes from ${name}`, () => {
      expect(fromSearchEngine(referrer, OWN)).toBe(true);
    });

  for (const [name, referrer] of OTHERS)
    test(`does not come from ${name}`, () => {
      expect(fromSearchEngine(referrer, OWN)).toBe(false);
    });

  test("is kept for the rest of the visit, whatever the next page says", () => {
    expect(searchVisit(null, "https://www.google.com/", OWN)).toBe(true);
    expect(searchVisit(SEARCH_VISIT, "https://fcuba.net/threads/7", OWN)).toBe(
      true,
    );
    expect(searchVisit(SEARCH_VISIT, "", OWN)).toBe(true);
    expect(searchVisit(null, "https://fcuba.net/threads/7", OWN)).toBe(false);
    expect(searchVisit("something else", "", OWN)).toBe(false);
  });
});

const now = Date.parse("2026-10-24T12:00:00Z");
const ready: CardState = {
  consentSettled: true,
  searchVisit: true,
  snoozedAt: null,
  now,
  waited: true,
  windowOpen: false,
  inviteInView: false,
};

describe("the floating card", () => {
  test("comes up for a visit from a search engine, once it has waited", () => {
    expect(cardShown(ready)).toBe(true);
    expect(cardShown({ ...ready, waited: false })).toBe(false);
    expect(cardShown({ ...ready, searchVisit: false })).toBe(false);
  });

  test("waits for the cookie banner", () => {
    expect(cardShown({ ...ready, consentSettled: false })).toBe(false);
  });

  test("steps aside while the sign-up window is open or an invitation in the page is on screen", () => {
    expect(cardShown({ ...ready, windowOpen: true })).toBe(false);
    expect(cardShown({ ...ready, inviteInView: true })).toBe(false);
  });

  test("put off, stays away for some days and then comes back", () => {
    const putOff = now - DAY;
    expect(cardShown({ ...ready, snoozedAt: putOff })).toBe(false);
    expect(
      cardShown({ ...ready, snoozedAt: now - SNOOZE_DAYS * DAY + 60_000 }),
    ).toBe(false);
    expect(cardShown({ ...ready, snoozedAt: now - SNOOZE_DAYS * DAY })).toBe(
      true,
    );
  });

  test("reads when it was put off from whatever the storage held", () => {
    expect(readSnooze(String(now))).toBe(now);
    expect(readSnooze(null)).toBeNull();
    expect(readSnooze("")).toBeNull();
    expect(readSnooze("soon")).toBeNull();
    expect(readSnooze("-5")).toBeNull();
  });

  test("comes up early after half a screen of scrolling", () => {
    expect(scrolledEnough(0, 800)).toBe(false);
    expect(scrolledEnough(399, 800)).toBe(false);
    expect(scrolledEnough(400, 800)).toBe(true);
  });
});

describe("the invitation after a thread's first post", () => {
  const enough = REPLIES_FOR_FIRST_INVITE + 1;
  const guest = {
    guest: true,
    registrationOpen: true,
    locked: false,
    page: 1,
    postsOnPage: enough,
  };

  test("is for a guest on the first page, with enough replies under it", () => {
    expect(threadInvites(guest).afterFirst).toBe(true);
    expect(
      threadInvites({ ...guest, postsOnPage: enough - 1 }).afterFirst,
    ).toBe(false);
    expect(threadInvites({ ...guest, page: 2 }).afterFirst).toBe(false);
  });

  test("is never drawn on a locked thread, which nobody replies to", () => {
    expect(threadInvites({ ...guest, locked: true }).afterFirst).toBe(false);
  });

  test("is never for a member, nor where registration is closed", () => {
    expect(threadInvites({ ...guest, guest: false }).afterFirst).toBe(false);
    expect(
      threadInvites({ ...guest, registrationOpen: false }).afterFirst,
    ).toBe(false);
  });
});
