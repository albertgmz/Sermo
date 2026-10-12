import type { Ctx } from "../../context";
import {
  PAGE_BODY_LENGTH,
  pagesDelete,
  pagesGet,
  pagesGetSource,
  pagesList,
  pagesSave,
} from "../../contracts/pages";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { can, requirePermission } from "../../permissions";
import { renderMarkdown } from "../../render";
import { iso } from "../../time";
import { appendModeratorLog } from "../moderation";

/** The most pages the site holds. */
export const PAGE_LIMIT = 100;

interface PageRow {
  id: number;
  slug: string;
  title: string;
  body_source: string;
  body_html: string;
  is_published: number;
  created_at: number;
  updated_at: number;
}

export const pageSql = {
  bySlug: "SELECT * FROM static_pages WHERE slug = ?1",
  all: "SELECT slug, title, is_published, updated_at FROM static_pages ORDER BY slug",
  count: "SELECT COUNT(*) AS n FROM static_pages",
};

const pageValue = (row: PageRow) => ({
  slug: row.slug,
  title: row.title,
  bodyHtml: row.body_html,
  isPublished: !!row.is_published,
  updatedAt: iso(row.updated_at),
});
const detailValue = (row: PageRow) => ({ ...pageValue(row), bodySource: row.body_source });

const bySlug = (ctx: Ctx, slug: string) =>
  ctx.sqlite.prepare<PageRow, [string]>(pageSql.bySlug).get(slug);

const get = implement(
  pagesGet,
  (ctx, actor, input) => {
    const row = bySlug(ctx, input.slug);
    if (!row || (!row.is_published && !can(ctx, actor, "admin.settings")))
      throw new NotFoundError();
    return pageValue(row);
  },
  { public: "Published pages are read by everyone; unpublished ones need admin.settings." },
);

const list = implement(pagesList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.settings");
  return {
    items: ctx.sqlite
      .prepare<Pick<PageRow, "slug" | "title" | "is_published" | "updated_at">, []>(pageSql.all)
      .all()
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        isPublished: !!row.is_published,
        updatedAt: iso(row.updated_at),
      })),
  };
});

const getSource = implement(pagesGetSource, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  const row = bySlug(ctx, input.slug);
  if (!row) throw new NotFoundError();
  return detailValue(row);
});

const save = implement(pagesSave, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  // Rendered before the transaction and without an actor: a page resolves no mentions or quotes.
  const html = renderMarkdown(input.body, { maxLength: PAGE_BODY_LENGTH });
  return writeTx(ctx, () => {
    const existing = bySlug(ctx, input.slug);
    if (!existing && ctx.sqlite.prepare<{ n: number }, []>(pageSql.count).get()!.n >= PAGE_LIMIT)
      throw new ConflictError(`The site holds at most ${PAGE_LIMIT} pages.`);
    const row = ctx.sqlite
      .prepare<PageRow, (string | number)[]>(
        "INSERT INTO static_pages (slug, title, body_source, body_html, is_published, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_source = excluded.body_source, body_html = excluded.body_html, is_published = excluded.is_published, updated_at = excluded.updated_at RETURNING *",
      )
      .get(input.slug, input.title, input.body, html, input.isPublished ? 1 : 0, ctx.now())!;
    appendModeratorLog(ctx, actor, "page.save", "static_page", row.id, "", {
      slug: row.slug,
      created: !existing,
    });
    return detailValue(row);
  });
});

const remove = implement(pagesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const row = bySlug(ctx, input.slug);
    if (!row) throw new NotFoundError();
    ctx.sqlite.prepare("DELETE FROM static_pages WHERE id = ?1").run(row.id);
    appendModeratorLog(ctx, actor, "page.delete", "static_page", row.id, "", { slug: row.slug });
    return { ok: true as const };
  });
});

export const operations = [get, list, getSource, save, remove];
