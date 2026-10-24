import { headers } from "next/headers";
import { safeReturnPath } from "@/lib/sermo/return-path";

// The page an action was called from, as the browser names it (its Referer, which carries the
// search params the address has been given since it was drawn, such as `?pages=3`). Without one,
// or with one that is not on this site, it is the home page.
export async function pageOfRequest(): Promise<string> {
  const sent = await headers();
  const referer = sent.get("referer");
  if (!referer || !URL.canParse(referer)) return "/";
  const { host, pathname, search } = new URL(referer);
  if (host !== (sent.get("x-forwarded-host") ?? sent.get("host"))) return "/";
  return safeReturnPath(pathname + search);
}

// Whether the router asked for this page (it draws a page again for a refresh), as the `rsc` header
// says, rather than a browser opening it. A part that streams in behind a placeholder on a page
// load is drawn whole for the router: its placeholder would take the place of what the screen
// already shows.
export async function isRouterRequest(): Promise<boolean> {
  return (await headers()).has("rsc");
}
