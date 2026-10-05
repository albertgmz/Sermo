import { GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { getGlobalPermissions, getNodeAccess } from "../permissions";
import { canonicalUrl, requireBaseURL } from "./paths";

export type SitemapKind = "node" | "thread" | "profile";
export interface SitemapEntry {
  id: number;
  url: string;
  lastmod?: string;
}
export const SITEMAP_CAP = 50_000;
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );

/** Keyset scan; permissions are checked using the guest actor for every public entry. */
export function* sitemapEntries(
  ctx: Ctx,
  baseURL: string,
  kind: SitemapKind,
): Generator<SitemapEntry> {
  requireBaseURL(baseURL);
  let after = 0;
  if (kind === "node") {
    const access = getNodeAccess(ctx, GUEST);
    const rows = prepared(ctx, "seo.sitemapNodes", () =>
      ctx.sqlite.prepare<
        {
          id: number;
          title: string;
          last_post_at: number | null;
          content_updated_at: number | null;
        },
        [number]
      >(
        "SELECT id,title,last_post_at,content_updated_at FROM nodes WHERE id>?1 ORDER BY id LIMIT 500",
      ),
    );
    for (;;) {
      const batch = rows.all(after);
      if (!batch.length) return;
      for (const row of batch) {
        after = row.id;
        if (access(row.id).view)
          yield {
            id: row.id,
            url: canonicalUrl(baseURL, "node", row.id, row.title),
            ...((row.content_updated_at ?? row.last_post_at)
              ? {
                  lastmod: new Date(
                    Math.max(row.content_updated_at ?? 0, row.last_post_at ?? 0),
                  ).toISOString(),
                }
              : {}),
          };
      }
    }
  }
  if (kind === "thread") {
    const access = getNodeAccess(ctx, GUEST);
    const rows = prepared(ctx, "seo.sitemapThreads", () =>
      ctx.sqlite.prepare<
        {
          id: number;
          node_id: number;
          title: string;
          created_at: number;
          content_updated_at: number | null;
          last_post_at: number;
        },
        [number]
      >(
        "SELECT id,node_id,title,created_at,content_updated_at,last_post_at FROM threads WHERE id>?1 AND state='visible' AND first_post_id IS NOT NULL ORDER BY id LIMIT 500",
      ),
    );
    for (;;) {
      const batch = rows.all(after);
      if (!batch.length) return;
      for (const row of batch) {
        after = row.id;
        if (access(row.node_id).view)
          yield {
            id: row.id,
            url: canonicalUrl(baseURL, "thread", row.id, row.title),
            lastmod: new Date(
              row.content_updated_at ?? row.last_post_at ?? row.created_at,
            ).toISOString(),
          };
      }
    }
  }
  if (!getGlobalPermissions(ctx, GUEST).canViewProfiles) return;
  const rows = prepared(ctx, "seo.sitemapProfiles", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        username: string;
        created_at: number;
        content_updated_at: number | null;
        has_public_wall: number;
        about: string;
      },
      [number]
    >(
      "SELECT id,username,created_at,content_updated_at,about,EXISTS(SELECT 1 FROM profile_posts WHERE profile_user_id=users.id AND state='visible' LIMIT 1) AS has_public_wall FROM users WHERE id>?1 ORDER BY id LIMIT 500",
    ),
  );
  for (;;) {
    const batch = rows.all(after);
    if (!batch.length) return;
    for (const row of batch) {
      after = row.id;
      if (row.has_public_wall === 1 || row.about.trim().length > 0)
        yield {
          id: row.id,
          url: canonicalUrl(baseURL, "profile", row.id, row.username),
          lastmod: new Date(row.content_updated_at ?? row.created_at).toISOString(),
        };
    }
  }
}

/** A shard never emits more than 50,000 URLs. Each scan keeps only one shard in memory. */
export function sitemapShard(ctx: Ctx, baseURL: string, kind: SitemapKind, shard: number): string {
  if (!Number.isSafeInteger(shard) || shard < 1) throw new RangeError("Invalid shard");
  const start = (shard - 1) * SITEMAP_CAP;
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  let i = 0;
  for (const entry of sitemapEntries(ctx, baseURL, kind)) {
    if (i++ < start) continue;
    if (i > start + SITEMAP_CAP) break;
    parts.push(
      `<url><loc>${xml(entry.url)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`,
    );
  }
  parts.push("</urlset>");
  return parts.join("");
}

export function sitemapIndex(ctx: Ctx, baseURL: string): string {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const kind of ["node", "thread", "profile"] as const) {
    let count = 0;
    let lastmod = "";
    const append = () => {
      const location = new URL(
        `/sitemaps/${kind}-${Math.ceil(count / SITEMAP_CAP)}.xml`,
        requireBaseURL(baseURL),
      ).href;
      parts.push(
        `<sitemap><loc>${xml(location)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`,
      );
    };
    for (const entry of sitemapEntries(ctx, baseURL, kind)) {
      if (count > 0 && count % SITEMAP_CAP === 0) {
        append();
        lastmod = "";
      }
      count++;
      if (entry.lastmod && entry.lastmod > lastmod) lastmod = entry.lastmod;
    }
    if (count > 0) append();
  }
  parts.push("</sitemapindex>");
  return parts.join("");
}

export function robotsTxt(baseURL: string): string {
  const sitemap = new URL("/sitemap.xml", requireBaseURL(baseURL)).href;
  return `User-agent: *\nDisallow: /search\nDisallow: /api/\nDisallow: /mcp\nSitemap: ${sitemap}\n`;
}
