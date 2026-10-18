import { type Ctx, prepared } from "../../context";
import { SUPPORTED_LANGUAGES } from "../../contracts/settings";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";
import { requireBaseURL } from "./paths";

/** The page an administrator writes with the site's contact details, and where the site shows it. */
const CONTACT_SLUG = "contact";
const CONTACT_PATH = "/contact";

type Administrator = PrincipalRow & { id: number; group_id: number; username: string };

/** Hosts a site is run on only for local development and checks, where plain http is accepted. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where a security researcher reaches the people who run the site: the published contact page,
 * or else a new private conversation to the site's first super admin who can receive one (a
 * report then needs an account, which a member may open). Never an email address: the site
 * configures none to publish, and an administrator's sign-in address is private.
 */
function contactPath(ctx: Ctx): string | null {
  const page = prepared(ctx, "seo.contactPublished", () =>
    ctx.sqlite.prepare<{ is_published: number }, [string]>(
      "SELECT is_published FROM static_pages WHERE slug = ?1",
    ),
  ).get(CONTACT_SLUG);
  if (page?.is_published) return CONTACT_PATH;
  const administrators = prepared(ctx, "seo.contactAdministrators", () =>
    ctx.sqlite.prepare<Administrator, []>(
      `SELECT u.id, u.group_id, u.username, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.is_super_admin = 1 AND u.erased_at IS NULL ORDER BY u.id`,
    ),
  ).all();
  const versions = currentVersions(ctx);
  // `can` refuses a banned member before anything else.
  const reachable = administrators.find((row) =>
    can(ctx, memberActor(row.id, row.group_id, row, versions), "conversation.receive"),
  );
  return reachable ? `/conversations/new?to=${encodeURIComponent(reachable.username)}` : null;
}

/**
 * The site's security.txt (RFC 9116), or null when there is none to publish: when no one can be
 * reached (a file without a Contact is invalid), or when the site's address is not https (RFC 9116
 * wants an https Contact), except on a loopback host. Expires is the first of the month a year on:
 * between 11 and 12 months ahead, the same all month. It is never let lapse, because the Contact
 * is read on every request rather than written by hand.
 */
export function securityTxt(ctx: Ctx, baseURL: string): string | null {
  const origin = requireBaseURL(baseURL);
  if (origin.protocol !== "https:" && !LOOPBACK.has(origin.hostname)) return null;
  const contact = contactPath(ctx);
  if (contact === null) return null;
  const now = new Date(ctx.now());
  const expires = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1));
  return [
    `Contact: ${new URL(contact, origin).href}`,
    `Expires: ${expires.toISOString()}`,
    `Canonical: ${new URL("/.well-known/security.txt", origin).href}`,
    `Preferred-Languages: ${SUPPORTED_LANGUAGES.join(", ")}`,
    "",
  ].join("\n");
}

/**
 * The API catalog (RFC 9727) as a linkset in the form of its appendix A.1: one entry per API,
 * anchored at the API's own address, with the links that describe it and where its status is
 * read. Every link answers a GET; the anchors only name the APIs (the MCP endpoint answers POST).
 */
export function apiCatalog(baseURL: string) {
  const origin = requireBaseURL(baseURL);
  const at = (path: string) => new URL(path, origin).href;
  const status = [{ href: at("/health"), type: "application/json" }];
  return {
    linkset: [
      {
        anchor: at("/api/v1"),
        "service-desc": [{ href: at("/api/v1/openapi.json"), type: "application/json" }],
        "service-doc": [{ href: at("/developer"), type: "text/html" }],
        status,
      },
      // The MCP endpoint describes its own tools; the developer page covers only the REST API.
      { anchor: at("/mcp"), status },
    ],
  };
}
