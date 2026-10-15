// The card of a composer drawn as a page, and its loading shape: one string so the two cannot drift.
// `overflow-clip` rounds the corners without becoming a scroll container, which the pinned bottom
// bar needs to stick to the screen.
export const COMPOSER_PAGE_CLASS =
  "flex min-h-[70dvh] flex-col overflow-clip rounded-lg border bg-card md:min-h-[34rem]";
