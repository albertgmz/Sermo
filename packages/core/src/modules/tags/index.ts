import * as z from "zod";
import { GUEST } from "../../actor";
import { normalizeTag } from "../../bbcode/hashtag";
import { type Ctx, prepared } from "../../context";
import * as contracts from "../../contracts/tags";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { requirePermission } from "../../permissions";
import { iso } from "../../time";
import { threadValuesFor } from "../forums";
import { requireSiteView, siteOpenToGuests } from "../members/site-access";
import { appendModeratorLog } from "../moderation";
import { seoForTag, TAG_INDEX_MIN_THREADS } from "../seo";
import { hubReach, hubThreads } from "./hub";
import { tagKeys } from "./store";

type TagRow = { id: number; name: string; thread_count: number; created_at: number };

export const adminTagSql = {
  byId: "SELECT id, name, thread_count, created_at FROM tags WHERE id = ?1",
  list: "SELECT id, name, thread_count, created_at FROM tags WHERE name > ?1 AND name >= ?2 AND name < ?3 ORDER BY name LIMIT ?4",
  aliases:
    "SELECT tag_id, name FROM tag_aliases WHERE tag_id IN (SELECT value FROM json_each(?1)) ORDER BY name",
};

const cursorShape = z.tuple([z.string()]);

/** The largest string a tag name sorts below: the end of a prefix range. */
const AFTER_ALL = "\u{10FFFF}";

function tagRow(ctx: Ctx, id: number): TagRow {
  const row = prepared(ctx, "tags.byId", () =>
    ctx.sqlite.prepare<TagRow, [number]>(adminTagSql.byId),
  ).get(id);
  if (!row) throw new NotFoundError();
  return row;
}

function adminValues(ctx: Ctx, rows: TagRow[]) {
  const aliases = new Map<number, string[]>();
  if (rows.length > 0)
    for (const alias of prepared(ctx, "tags.aliases", () =>
      ctx.sqlite.prepare<{ tag_id: number; name: string }, [string]>(adminTagSql.aliases),
    ).all(JSON.stringify(rows.map((row) => row.id)))) {
      const names = aliases.get(alias.tag_id) ?? [];
      names.push(alias.name);
      aliases.set(alias.tag_id, names);
    }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    threadCount: row.thread_count,
    aliases: aliases.get(row.id) ?? [],
    createdAt: iso(row.created_at),
  }));
}

/** The tag a page's name reaches, and the name it is called now. */
function pageTag(ctx: Ctx, name: string): { id: number; name: string } {
  const key = normalizeTag(name);
  const id = key === null ? null : tagIdOfName(ctx, key);
  if (id === null) throw new NotFoundError();
  return { id, name: tagRow(ctx, id).name };
}

function tagIdOfName(ctx: Ctx, key: string): number | null {
  const row = prepared(ctx, "tags.pageId", () =>
    ctx.sqlite.prepare<{ id: number }, [string, string]>(
      "SELECT id FROM tags WHERE name = ?1 UNION ALL SELECT tag_id FROM tag_aliases WHERE name = ?2 LIMIT 1",
    ),
  ).get(key, key);
  return row?.id ?? null;
}

const tagsGetOp = implement(contracts.tagsGet, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  const tag = pageTag(ctx, input.name);
  // A tag is not shown to a viewer who can open none of its threads: it would name a thread or
  // a forum they cannot see.
  if (hubThreads(ctx, hubReach(ctx, actor), tag.id, null, 1).length === 0)
    throw new NotFoundError();
  // The page is indexed for the threads a search engine could index: guests open them and their text.
  const publicThreads = siteOpenToGuests(ctx)
    ? hubThreads(
        ctx,
        hubReach(ctx, GUEST, { indexable: true }),
        tag.id,
        null,
        TAG_INDEX_MIN_THREADS,
      ).length
    : 0;
  const seo = seoForTag(ctx, tag.name, input.requestedPath, publicThreads);
  const typed = normalizeTag(input.name);
  return { name: tag.name, redirect: seo.redirect || typed !== tag.name, seo };
});

const tagsThreadsOp = implement(contracts.tagsThreads, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  const tag = pageTag(ctx, input.name);
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int(), z.number().int()]))
    : null;
  const rows = hubThreads(ctx, hubReach(ctx, actor), tag.id, cursor, input.limit + 1);
  const page = rows.slice(0, input.limit);
  // The first page of a tag with nothing to show is a missing page, as in tags.get.
  if (page.length === 0 && !cursor) throw new NotFoundError();
  const last = page.at(-1);
  return {
    items: threadValuesFor(ctx, actor, page),
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.sort_at, last.id]) : null,
  };
});

const tagsListOp = implement(contracts.tagsList, (ctx, actor, input) => {
  requirePermission(ctx, actor, "tag.manage");
  const cursor = input.cursor ? decodeCursor(input.cursor, cursorShape)[0] : "";
  const prefix = (input.query ?? "").replace(/^#/, "").normalize("NFC").toLowerCase();
  const rows = prepared(ctx, "tags.list", () =>
    ctx.sqlite.prepare<TagRow, [string, string, string, number]>(adminTagSql.list),
  ).all(cursor, prefix, prefix + AFTER_ALL, input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    items: adminValues(ctx, page),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.name]) : null,
  };
});

/** A name another tag or alias already holds; a name the tag itself held as an alias is free. */
function requireFreeName(ctx: Ctx, key: string, tagId: number): void {
  const holder = tagIdOfName(ctx, key);
  if (holder !== null && holder !== tagId)
    throw new ConflictError("Another tag already has that name.");
}

const tagsRenameOp = implement(contracts.tagsRename, (ctx, actor, input) => {
  requirePermission(ctx, actor, "tag.manage");
  const [key] = tagKeys([input.name]);
  return writeTx(ctx, () => {
    const row = tagRow(ctx, input.tagId);
    if (row.name === key) return adminValues(ctx, [row])[0]!;
    requireFreeName(ctx, key!, row.id);
    ctx.sqlite.prepare("DELETE FROM tag_aliases WHERE name = ?1").run(key!);
    ctx.sqlite.prepare("UPDATE tags SET name = ?1 WHERE id = ?2").run(key!, row.id);
    ctx.sqlite
      .prepare("INSERT INTO tag_aliases (name, tag_id) VALUES (?1, ?2)")
      .run(row.name, row.id);
    appendModeratorLog(ctx, actor, "tag.rename", "tag", row.id, "", { from: row.name, to: key });
    return adminValues(ctx, [tagRow(ctx, row.id)])[0]!;
  });
});

const tagsMergeOp = implement(contracts.tagsMerge, (ctx, actor, input) => {
  requirePermission(ctx, actor, "tag.manage");
  if (input.tagId === input.intoTagId)
    throw new ValidationError("Choose a tag other than the one being merged.");
  return writeTx(ctx, () => {
    const from = tagRow(ctx, input.tagId);
    const into = tagRow(ctx, input.intoTagId);
    // Inserts and deletes, not an update of tag_id: the triggers keep the counters.
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_tags (thread_id, tag_id, added_by, from_post, sort_at, created_at) " +
          "SELECT thread_id, ?2, added_by, from_post, sort_at, created_at FROM thread_tags WHERE tag_id = ?1 " +
          "ON CONFLICT (thread_id, tag_id) DO UPDATE SET from_post = from_post AND excluded.from_post",
      )
      .run(from.id, into.id);
    ctx.sqlite.prepare("DELETE FROM thread_tags WHERE tag_id = ?1").run(from.id);
    ctx.sqlite
      .prepare("UPDATE tag_aliases SET tag_id = ?2 WHERE tag_id = ?1")
      .run(from.id, into.id);
    ctx.sqlite
      .prepare("INSERT INTO tag_aliases (name, tag_id) VALUES (?1, ?2)")
      .run(from.name, into.id);
    ctx.sqlite.prepare("DELETE FROM tags WHERE id = ?1").run(from.id);
    appendModeratorLog(ctx, actor, "tag.merge", "tag", into.id, "", {
      from: from.name,
      into: into.name,
    });
    return adminValues(ctx, [tagRow(ctx, into.id)])[0]!;
  });
});

const tagsDeleteOp = implement(contracts.tagsDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "tag.manage");
  writeTx(ctx, () => {
    const row = tagRow(ctx, input.tagId);
    ctx.sqlite.prepare("DELETE FROM thread_tags WHERE tag_id = ?1").run(row.id);
    ctx.sqlite.prepare("DELETE FROM tags WHERE id = ?1").run(row.id);
    appendModeratorLog(ctx, actor, "tag.delete", "tag", row.id, "", {
      name: row.name,
      threads: row.thread_count,
    });
  });
  return { ok: true as const };
});

export const operations = [
  tagsGetOp,
  tagsThreadsOp,
  tagsListOp,
  tagsRenameOp,
  tagsMergeOp,
  tagsDeleteOp,
];
