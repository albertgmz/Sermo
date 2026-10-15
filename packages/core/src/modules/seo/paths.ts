import slugify from "@sindresorhus/slugify";

export type SeoKind = "node" | "thread" | "profile";

/** The web app serves a node under /forums; the REST API's own routes keep /nodes. */
const PREFIX: Record<SeoKind, string> = { node: "forums", thread: "threads", profile: "members" };

const segment = (name: string) => slugify(name, { decamelize: false }) || "item";

/** A tag's page: the name is the address, there is no id or slug. */
export function tagPath(name: string): string {
  return `/tags/${encodeURIComponent(name)}`;
}

export function tagUrl(baseURL: string, name: string): string {
  return new URL(tagPath(name), requireBaseURL(baseURL)).href;
}

export function canonicalPath(kind: SeoKind, id: number, name: string): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError("Invalid SEO id");
  return `/${PREFIX[kind]}/${id}-${segment(name)}`;
}

export function canonicalUrl(baseURL: string, kind: SeoKind, id: number, name: string): string {
  return new URL(canonicalPath(kind, id, name), requireBaseURL(baseURL)).href;
}

export function requireBaseURL(value: string): URL {
  const url = new URL(value);
  if (!/https?:/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new TypeError("SEO base URL must be an HTTP(S) origin");
  return new URL(url.origin);
}

/** The numeric id resolves the resource; a stale cosmetic slug redirects to its current URL. */
export function resolveCanonical(
  requestedPath: string,
  baseURL: string,
  kind: SeoKind,
  id: number,
  name: string,
): { canonical: string; redirect: boolean } {
  const canonical = canonicalUrl(baseURL, kind, id, name);
  return {
    canonical,
    redirect:
      requestedPath.length > 0 &&
      new URL(requestedPath, requireBaseURL(baseURL)).href !== canonical,
  };
}
