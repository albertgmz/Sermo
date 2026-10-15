import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import {
  PAGE_BODY_LENGTH,
  pagesDelete,
  pagesGet,
  pagesGetSource,
  pagesList,
  pagesSave,
} from "../../contracts/pages";
import { termsAccept } from "../../contracts/terms";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { can, requirePermission } from "../../permissions";
import { renderBbCode } from "../../render";
import { iso } from "../../time";
import { appendModeratorLog } from "../moderation";
import { insertAcceptances, publishedVersions, startingVersion } from "./acceptance";

/** The most pages the site holds. */
export const PAGE_LIMIT = 100;

interface PageRow {
  id: number;
  slug: string;
  title: string;
  body_source: string;
  body_html: string;
  is_published: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export const pageSql = {
  bySlug: "SELECT * FROM static_pages WHERE slug = ?1",
  all: "SELECT slug, title, is_published, version, updated_at FROM static_pages ORDER BY slug",
  count: "SELECT COUNT(*) AS n FROM static_pages",
};

const pageValue = (row: PageRow) => ({
  slug: row.slug,
  title: row.title,
  bodyHtml: row.body_html,
  isPublished: !!row.is_published,
  version: row.version,
  updatedAt: iso(row.updated_at),
});
const detailValue = (row: PageRow) => ({ ...pageValue(row), bodySource: row.body_source });

const bySlug = (ctx: Ctx, slug: string) =>
  ctx.sqlite.prepare<PageRow, [string]>(pageSql.bySlug).get(slug);

const get = implement(
  pagesGet,
  (ctx, actor, input) => {
    const row = bySlug(ctx, input.slug);
    if (!row || (!row.is_published && !can(ctx, actor, "admin.pages")))
      throw new NotFoundError();
    return pageValue(row);
  },
  { public: "Published pages are read by everyone; unpublished ones need admin.pages." },
);

const list = implement(pagesList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.pages");
  return {
    items: ctx.sqlite
      .prepare<Pick<PageRow, "slug" | "title" | "is_published" | "version" | "updated_at">, []>(
        pageSql.all,
      )
      .all()
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        isPublished: !!row.is_published,
        version: row.version,
        updatedAt: iso(row.updated_at),
      })),
  };
});

const getSource = implement(pagesGetSource, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.pages");
  const row = bySlug(ctx, input.slug);
  if (!row) throw new NotFoundError();
  return detailValue(row);
});

const save = implement(pagesSave, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.pages");
  // Rendered before the transaction and without an actor: a page resolves no mentions or quotes.
  const html = renderBbCode(input.body, { maxLength: PAGE_BODY_LENGTH });
  return writeTx(ctx, () => {
    const existing = bySlug(ctx, input.slug);
    if (!existing && ctx.sqlite.prepare<{ n: number }, []>(pageSql.count).get()!.n >= PAGE_LIMIT)
      throw new ConflictError(`The site holds at most ${PAGE_LIMIT} pages.`);
    // A page that is created again after a delete starts above every version a member accepted
    // under its slug, so a later new version is never lower than what they hold. Only a new page
    // asks: the lookup reads every acceptance of the kind, which an update must not do.
    const first = existing ? 1 : startingVersion(ctx, input.slug);
    const row = ctx.sqlite
      .prepare<PageRow, (string | number)[]>(
        "INSERT INTO static_pages (slug, title, body_source, body_html, is_published, version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?8, ?6, ?6) ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_source = excluded.body_source, body_html = excluded.body_html, is_published = excluded.is_published, version = static_pages.version + ?7, updated_at = excluded.updated_at RETURNING *",
      )
      .get(
        input.slug,
        input.title,
        input.body,
        html,
        input.isPublished ? 1 : 0,
        ctx.now(),
        input.newVersion ? 1 : 0,
        first,
      )!;
    appendModeratorLog(ctx, actor, "page.save", "static_page", row.id, "", {
      slug: row.slug,
      created: !existing,
      version: row.version,
      newVersion: !!existing && input.newVersion,
    });
    return detailValue(row);
  });
});

const remove = implement(pagesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.pages");
  return writeTx(ctx, () => {
    const row = bySlug(ctx, input.slug);
    if (!row) throw new NotFoundError();
    ctx.sqlite.prepare("DELETE FROM static_pages WHERE id = ?1").run(row.id);
    appendModeratorLog(ctx, actor, "page.delete", "static_page", row.id, "", { slug: row.slug });
    return { ok: true as const };
  });
});

const accept = implement(
  termsAccept,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    // Accepting is the member's own answer to a page they were shown: a key acting for them in a
    // script cannot give it.
    if (user.kind === "token")
      throw new ForbiddenError("Accept the terms and rules in the browser; an API key cannot.");
    return writeTx(ctx, () => {
      // Read inside the transaction: a version published a moment ago is the one that counts.
      const published = publishedVersions(ctx);
      for (const item of input.accept)
        if (published[item.kind] !== item.version)
          throw new ConflictError(
            `The ${item.kind} page changed or is no longer published. Read it again.`,
          );
      insertAcceptances(ctx, user.userId, input.accept, user.clientIp);
      return { ok: true as const };
    });
  },
  { public: "A signed-in member accepts for themselves; there is nothing to grant or refuse." },
);

export const operations = [get, list, getSource, save, remove, accept];
