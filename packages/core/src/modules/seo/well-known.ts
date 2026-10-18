import { type Ctx, prepared } from "../../context";
import { SUPPORTED_LANGUAGES } from "../../contracts/settings";
import { requireBaseURL } from "./paths";

/** The page an administrator writes with the site's contact details, and where the site shows it. */
const CONTACT_SLUG = "contact";
const CONTACT_PATH = "/contact";

/**
 * The site's security.txt (RFC 9116), or null when the site names no contact. The only contact
 * an administrator configures is the published contact page, so that page is the Contact; without
 * it there is no file, as a file without a Contact is invalid. Expires is a year from the start of
 * the day: the Contact is read on every request, so it is never stale.
 */
export function securityTxt(ctx: Ctx, baseURL: string): string | null {
  const contact = prepared(ctx, "seo.contactPublished", () =>
    ctx.sqlite.prepare<{ is_published: number }, [string]>(
      "SELECT is_published FROM static_pages WHERE slug = ?1",
    ),
  ).get(CONTACT_SLUG);
  if (!contact?.is_published) return null;
  const origin = requireBaseURL(baseURL);
  const expires = new Date(ctx.now());
  expires.setUTCHours(0, 0, 0, 0);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return [
    `Contact: ${new URL(CONTACT_PATH, origin).href}`,
    `Expires: ${expires.toISOString()}`,
    `Canonical: ${new URL("/.well-known/security.txt", origin).href}`,
    `Preferred-Languages: ${SUPPORTED_LANGUAGES.join(", ")}`,
    "",
  ].join("\n");
}

/**
 * The API catalog (RFC 9727): a linkset whose catalog entry lists the REST API and the MCP
 * endpoint as its items, then what describes each of them and where its status is read.
 */
export function apiCatalog(baseURL: string) {
  const origin = requireBaseURL(baseURL);
  const at = (path: string) => new URL(path, origin).href;
  const status = [{ href: at("/health"), type: "application/json" }];
  return {
    linkset: [
      {
        anchor: at("/.well-known/api-catalog"),
        item: [{ href: at("/api/v1") }, { href: at("/mcp") }],
      },
      {
        anchor: at("/api/v1"),
        "service-desc": [
          { href: at("/api/v1/openapi.json"), type: "application/vnd.oai.openapi+json" },
        ],
        "service-doc": [{ href: at("/developer"), type: "text/html" }],
        status,
      },
      // The MCP endpoint describes its own tools; the developer page covers only the REST API.
      { anchor: at("/mcp"), status },
    ],
  };
}
