// The addresses the pages of `app/[locale]` answer, outside the staff panel (whose registry knows
// its own, `(staff)/registry.ts`). The proxy answers any other address with the 404 of the
// visitor's language: the router's own fallback for it (`[...rest]`) streams a 200 shell before it
// can say not found. A `[name]` part is one segment of any value; the proxy's record checks decide
// whether the record exists. `page-routes.test.ts` holds this list to the page files.
export const PAGE_ROUTES = [
  "/",
  "/account",
  "/account/appearance",
  "/account/bookmarks",
  "/account/data-saver",
  "/account/notifications",
  "/account/permissions",
  "/account/preferences",
  "/account/privacy",
  "/account/security",
  "/awards",
  "/awards/[id]",
  "/contact",
  "/conversations",
  "/conversations/[id]",
  "/conversations/[id]/edit/[messageId]",
  "/conversations/new",
  "/cookies",
  "/credits",
  "/data-saver",
  "/developer",
  "/forgot-password",
  "/forums",
  "/forums/[id]",
  "/forums/[id]/new",
  "/legal",
  "/login",
  "/members",
  "/members/[id]",
  "/not-me",
  "/notifications",
  "/pages/[slug]",
  "/posts/[id]",
  "/privacy",
  "/register",
  "/reset-password",
  "/rules",
  "/search",
  "/tags/[name]",
  "/terms",
  "/threads/[id]",
  "/threads/[id]/edit/[postId]",
  "/ui",
  "/upgrade",
  "/verify-email",
] as const;

const PATTERNS = PAGE_ROUTES.map(
  (route) =>
    new RegExp(`^${route === "/" ? "/" : route.replace(/\[\w+\]/g, "[^/]+")}$`),
);

// Whether a page answers the decoded path. A trailing slash does not matter.
export function isPageRoute(pathname: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATTERNS.some((pattern) => pattern.test(path));
}
