// How the feed is drawn: full cards, or one compact row each. A member's choice is kept on their
// account (it comes with `auth.me`, so the first page is drawn right the first time and follows
// them to another device); a guest has no account, so theirs is a cookie the server reads when it
// draws the page, which a browser-only preference (local storage) could not do without the page
// jumping from one layout to the other as it loads.
//
// The two names are the backend's own (`FEED_VIEWS`); they are written out so the browser's code
// (the consent inventory, the toggle) does not carry the contracts. `feed-view.test.ts` holds them
// equal.
export const FEED_VIEWS = ["cards", "compact"] as const;

export type FeedView = (typeof FEED_VIEWS)[number];

export const FEED_VIEW_COOKIE = "forum_feed_view";

export const DEFAULT_FEED_VIEW: FeedView = "cards";

export function parseFeedView(value: unknown): FeedView | null {
  return FEED_VIEWS.find((view) => view === value) ?? null;
}

// What the list assumes a row is high, in pixels, until the row has been measured (the gap above
// it included): a card is about 320 on a phone; a compact row is two lines, 40 px of buttons and
// `py-2` (58 on a phone, 55 on a desktop) plus the 16 px gap. A wrong guess only moves the scroll
// bar until the rows draw, but compact rows guessed at card height made it four times too long.
export const FEED_ROW_ESTIMATE: Record<FeedView, number> = {
  cards: 320,
  compact: 72,
};
