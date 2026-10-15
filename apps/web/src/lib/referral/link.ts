import { parseId } from "@/lib/sermo/ids";

// The query parameter that carries the member whose link a visitor followed.
export const REFERRAL_PARAM = "ref";

// The member id a `ref` value names: a positive whole number in plain decimal, else null. A
// repeated parameter (an array) counts as its first value.
export function referrerOf(
  value: string | string[] | null | undefined,
): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text ? parseId(text) : null;
}

// The address to hand out for `href` (a path, with its query and hash if it has any): for a
// signed-in viewer it carries their id as `ref`, so whoever opens it and registers is credited to
// them; for a guest it is the plain address. Any query and the hash stay as they were.
export function shareAddress(
  href: string,
  origin: string,
  viewerId: number | null,
): string {
  const url = new URL(href, origin);
  if (viewerId === null) return url.href;
  if (url.searchParams.has(REFERRAL_PARAM)) {
    url.searchParams.delete(REFERRAL_PARAM);
  }
  url.search = `${url.search}${url.search ? "&" : "?"}${REFERRAL_PARAM}=${viewerId}`;
  return url.href;
}
