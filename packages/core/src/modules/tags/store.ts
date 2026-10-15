import { normalizeTag } from "../../bbcode/hashtag";
import { type Ctx, prepared } from "../../context";
import { ConflictError, ValidationError } from "../../errors";
import { MAX_THREAD_TAGS } from "../../limits";

/**
 * The rows behind tags: names, aliases and the tags of a thread. Everything here runs inside the
 * caller's transaction when it writes; permissions are decided by the callers. Counters
 * (tags.thread_count, users.tag_count) and thread_tags.sort_at are kept by triggers.
 */

type Params = (string | number)[];

export const tagSql = {
  /** typed -> name, for names that are a tag's name or one of its aliases (`?1` a JSON list). */
  resolve:
    "SELECT n.value AS typed, t.name AS name FROM json_each(?1) n JOIN tags t ON t.name = n.value " +
    "UNION ALL SELECT n.value AS typed, t.name AS name FROM json_each(?1) n " +
    "JOIN tag_aliases a ON a.name = n.value JOIN tags t ON t.id = a.tag_id",
  idByName: "SELECT id FROM tags WHERE name = ?1",
  idByAlias: "SELECT tag_id AS id FROM tag_aliases WHERE name = ?1",
  insertTag: "INSERT INTO tags (name, created_by, created_at) VALUES (?1, ?2, ?3) RETURNING id",
  insertThreadTag:
    "INSERT INTO thread_tags (thread_id, tag_id, added_by, from_post, sort_at, created_at) " +
    "SELECT ?1, ?2, ?3, ?4, t.sort_at, ?5 FROM threads t WHERE t.id = ?1 " +
    "ON CONFLICT (thread_id, tag_id) DO UPDATE SET from_post = from_post AND excluded.from_post",
  rows: "SELECT tt.tag_id, tt.from_post, t.name FROM thread_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.thread_id = ?1",
  removeRows:
    "DELETE FROM thread_tags WHERE thread_id = ?1 AND tag_id IN (SELECT value FROM json_each(?2))",
  dropUnused:
    "DELETE FROM tags WHERE thread_count <= 0 AND id IN (SELECT value FROM json_each(?1))",
  names:
    "SELECT t.name FROM thread_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.thread_id = ?1 ORDER BY t.name",
};

/**
 * What the names that exist are called now: typed name -> the tag's current name. A renamed or
 * merged tag still answers to its old names. One query, however many names.
 */
export function resolveTagNames(ctx: Ctx, names: string[]): Map<string, string> {
  if (names.length === 0) return new Map();
  return new Map(
    prepared(ctx, "tags.resolve", () =>
      ctx.sqlite.prepare<{ typed: string; name: string }, [string]>(tagSql.resolve),
    )
      .all(JSON.stringify(names))
      .map((row) => [row.typed, row.name]),
  );
}

/** The tag a name reaches (its name or an alias of it), or null. */
export function tagIdOf(ctx: Ctx, name: string): number | null {
  const byName = prepared(ctx, "tags.idByName", () =>
    ctx.sqlite.prepare<{ id: number }, [string]>(tagSql.idByName),
  ).get(name);
  if (byName) return byName.id;
  return (
    prepared(ctx, "tags.idByAlias", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(tagSql.idByAlias),
    ).get(name)?.id ?? null
  );
}

/** Names as members typed them, as tag keys: distinct, in order. A name that is no tag is refused. */
export function tagKeys(typed: readonly string[]): string[] {
  const keys: string[] = [];
  for (const raw of typed) {
    const key = normalizeTag(raw);
    if (!key)
      throw new ValidationError(`"${raw}" is not a tag.`, [
        {
          path: ["tags"],
          message: "A tag is letters, numbers and _ (at least one letter, at most 50 characters).",
        },
      ]);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The tags of a thread, alphabetically. */
export function threadTagNames(ctx: Ctx, threadId: number): string[] {
  return prepared(ctx, "tags.names", () =>
    ctx.sqlite.prepare<{ name: string }, [number]>(tagSql.names),
  )
    .all(threadId)
    .map((row) => row.name);
}

/** The current names of tags given by any of their names, distinct and in order. */
function canonicalKeys(ctx: Ctx, names: string[]): string[] {
  const current = resolveTagNames(ctx, names);
  return [...new Set(names.map((name) => current.get(name) ?? name))];
}

/** The tag with this key, made when it does not exist and `create` says it may be. */
function ensureTag(ctx: Ctx, key: string, userId: number, create: boolean): number {
  const existing = tagIdOf(ctx, key);
  if (existing !== null) return existing;
  if (!create) throw new ConflictError("Tags changed; retry.");
  return prepared(ctx, "tags.insert", () =>
    ctx.sqlite.prepare<{ id: number }, Params>(tagSql.insertTag),
  ).get(key, userId, ctx.now())!.id;
}

export interface TagWish {
  /** The key of the tag. */
  name: string;
  /** Put there by the opening post's hashtags. */
  fromPost: boolean;
}

function requireRoom(ctx: Ctx, threadId: number): void {
  const count = prepared(ctx, "tags.rowCount", () =>
    ctx.sqlite.prepare<{ n: number }, [number]>(
      "SELECT count(*) AS n FROM thread_tags WHERE thread_id = ?1",
    ),
  ).get(threadId)!.n;
  if (count > MAX_THREAD_TAGS)
    throw new ValidationError(`A thread can carry at most ${MAX_THREAD_TAGS} tags.`, [
      { path: ["tags"], message: `At most ${MAX_THREAD_TAGS} tags per thread.` },
    ]);
}

/**
 * Takes tags off a thread, and the tags that no thread carries any more go with them (a tag
 * exists because a thread carries it). Run inside the write transaction.
 */
export function removeThreadTags(ctx: Ctx, threadId: number, tagIds: number[]): void {
  if (tagIds.length === 0) return;
  const json = JSON.stringify(tagIds);
  prepared(ctx, "tags.removeRows", () =>
    ctx.sqlite.prepare<unknown, [number, string]>(tagSql.removeRows),
  ).run(threadId, json);
  prepared(ctx, "tags.dropUnused", () =>
    ctx.sqlite.prepare<unknown, [string]>(tagSql.dropUnused),
  ).run(json);
}

/**
 * Puts tags on a thread. A tag put by hand stays when the opening post stops naming it. A name
 * that is no tag yet is created when `create` says so, otherwise the write is retried (the tag
 * was there when the text was read). Run inside the write transaction.
 */
export function addThreadTags(
  ctx: Ctx,
  threadId: number,
  userId: number,
  wishes: TagWish[],
  create: boolean,
): void {
  for (const wish of wishes) {
    const tagId = ensureTag(ctx, wish.name, userId, create);
    prepared(ctx, "tags.insertThreadTag", () =>
      ctx.sqlite.prepare<unknown, Params>(tagSql.insertThreadTag),
    ).run(threadId, tagId, userId, Number(wish.fromPost), ctx.now());
  }
  requireRoom(ctx, threadId);
}

/** Makes `names` the whole list of tags a thread carries (by hand). */
export function replaceThreadTags(
  ctx: Ctx,
  threadId: number,
  userId: number,
  names: string[],
  create: boolean,
): void {
  names = canonicalKeys(ctx, names);
  const wanted = new Set(names);
  const gone = prepared(ctx, "tags.rows", () =>
    ctx.sqlite.prepare<{ tag_id: number; from_post: number; name: string }, [number]>(tagSql.rows),
  )
    .all(threadId)
    .filter((row) => !wanted.has(row.name))
    .map((row) => row.tag_id);
  removeThreadTags(ctx, threadId, gone);
  addThreadTags(
    ctx,
    threadId,
    userId,
    names.map((name) => ({ name, fromPost: false })),
    create,
  );
}

/**
 * Follows an edit of the opening post: the tags its hashtags put there before and its text no
 * longer names go, the ones it names now are put. Tags set by hand stay as they are.
 */
export function syncPostTags(
  ctx: Ctx,
  threadId: number,
  userId: number,
  names: string[],
  create: boolean,
): void {
  names = canonicalKeys(ctx, names);
  const wanted = new Set(names);
  const gone = prepared(ctx, "tags.rows", () =>
    ctx.sqlite.prepare<{ tag_id: number; from_post: number; name: string }, [number]>(tagSql.rows),
  )
    .all(threadId)
    .filter((row) => row.from_post === 1 && !wanted.has(row.name))
    .map((row) => row.tag_id);
  removeThreadTags(ctx, threadId, gone);
  addThreadTags(
    ctx,
    threadId,
    userId,
    names.map((name) => ({ name, fromPost: true })),
    create,
  );
}

/**
 * Removes every tag from a thread that is going for good, with the tags that carried only it.
 */
export function purgeThreadTags(ctx: Ctx, threadId: number): void {
  removeThreadTags(
    ctx,
    threadId,
    prepared(ctx, "tags.rows", () => ctx.sqlite.prepare<{ tag_id: number }, [number]>(tagSql.rows))
      .all(threadId)
      .map((row) => row.tag_id),
  );
}

/** How many of a thread's tags were put by hand (the opening post's hashtags do not count). */
export function manualTagCount(ctx: Ctx, threadId: number): number {
  return prepared(ctx, "tags.manualCount", () =>
    ctx.sqlite.prepare<{ n: number }, [number]>(
      "SELECT count(*) AS n FROM thread_tags WHERE thread_id = ?1 AND from_post = 0",
    ),
  ).get(threadId)!.n;
}
