// When the forum invites a guest to create an account: the rules as plain functions, so a test can
// hold them (`components/layout/signup-nudges.tsx` reads the browser and draws the card). Members
// never get an invitation; guests get, at most one on the screen at a time:
//
// - a floating card, for a visit that arrived from a search engine (kept for the visit): once the
//   cookie banner is out of the way, after a few seconds or some scrolling. "Not now" keeps it away
//   for some days. It steps aside while the sign-up window is open, while an invitation drawn in the
//   page is on the screen, and on the +18 page (which has its own ways in);
// - an invitation in a thread, after the first post and at the end of the page (`threadInvites`);
// - the sign-up window, opened by an action only members can take (`lib/join-window.ts`).
//
// None of them is drawn where registration is closed: the actions then go to the log-in page.

export const SNOOZE_DAYS = 7;
// How long the card waits on a page before it comes up, unless the guest scrolls first.
export const DELAY_MS = 6000;
// How far the guest scrolls before the card comes up early: this share of the screen's height.
export const SCROLL_SHARE = 0.5;
// The invitation after the first post is drawn only on a first page with at least this many replies
// on it, so it never shares the screen with the one at the end of the page.
export const REPLIES_FOR_FIRST_INVITE = 5;
const DAY = 24 * 60 * 60 * 1000;

// What the tab keeps under `SEARCH_VISIT_KEY` (`lib/signup-nudge-keys.ts`) for a visit that came
// from a search engine.
export const SEARCH_VISIT = "search";

// The search engines whose visitors get the card, by the host name of the page they came from:
// Google, Bing, DuckDuckGo, Yahoo, Yandex, Ecosia and Brave Search, under any of their country
// domains (google.es, google.com.cu, yahoo.co.jp).
const COUNTRY = String.raw`(?:co\.|com\.)?[a-z]{2,3}`;
const ENGINES = [
  new RegExp(String.raw`(?:^|\.)google\.${COUNTRY}$`),
  /(?:^|\.)bing\.com$/,
  /(?:^|\.)duckduckgo\.com$/,
  new RegExp(String.raw`(?:^|\.)yahoo\.${COUNTRY}$`),
  new RegExp(String.raw`(?:^|\.)yandex\.${COUNTRY}$`),
  /(?:^|\.)ya\.ru$/,
  /(?:^|\.)ecosia\.org$/,
  /^search\.brave\.com$/,
];
// The Google app on Android names itself instead of a page.
const GOOGLE_APP = "android-app://com.google.android.googlequicksearchbox";

// Whether `referrer` (the page the visitor came from, `document.referrer`) is a search engine's.
// A page of this site, or no referrer at all, is not.
export function fromSearchEngine(referrer: string, ownHost: string): boolean {
  if (referrer.startsWith(GOOGLE_APP)) return true;
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === ownHost.toLowerCase()) return false;
  return ENGINES.some((engine) => engine.test(host));
}

// Whether this visit came from a search engine: said so earlier in the visit (`stored`, what the
// tab keeps), or by the page it arrived from now. Moving on through the site keeps it.
export function searchVisit(
  stored: string | null,
  referrer: string,
  ownHost: string,
): boolean {
  return stored === SEARCH_VISIT || fromSearchEngine(referrer, ownHost);
}

// When the card was put off, from whatever the storage held.
export function readSnooze(text: string | null): number | null {
  const value = Number(text);
  return text !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export const snoozed = (snoozedAt: number | null, now: number) =>
  snoozedAt !== null && snoozedAt + SNOOZE_DAYS * DAY > now;

export type CardState = {
  // The cookie banner has been answered, or is not shown to this visitor.
  consentSettled: boolean;
  searchVisit: boolean;
  snoozedAt: number | null;
  now: number;
  // The page has been on long enough, or the guest has scrolled far enough.
  waited: boolean;
  // The sign-up window is open.
  windowOpen: boolean;
  // An invitation drawn in the page (`SignupInvite`) is on the screen.
  inviteInView: boolean;
};

// Whether the floating card is on the screen now.
export function cardShown(state: CardState): boolean {
  return (
    state.consentSettled &&
    state.searchVisit &&
    state.waited &&
    !snoozed(state.snoozedAt, state.now) &&
    !state.windowOpen &&
    !state.inviteInView
  );
}

// Whether the guest has scrolled far enough for the card to come up before its time.
export const scrolledEnough = (scrollY: number, screenHeight: number) =>
  scrollY >= screenHeight * SCROLL_SHARE;

// Which invitations a page of a thread holds: the one after the first post, on a first page with
// enough replies under it. The one at the end of the page stands in the reply box of every page.
export function threadInvites(state: {
  guest: boolean;
  registrationOpen: boolean;
  page: number;
  postsOnPage: number;
}): { afterFirst: boolean } {
  return {
    afterFirst:
      state.guest &&
      state.registrationOpen &&
      state.page === 1 &&
      state.postsOnPage - 1 >= REPLIES_FOR_FIRST_INVITE,
  };
}
