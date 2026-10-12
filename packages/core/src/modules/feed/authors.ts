import * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { postsByAuthor, threadsByAuthor } from "../../contracts/feed";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  contentRule,
  type PostRow,
  postReadable,
  postRowsByIds,
  postValuesMixed,
  type ThreadRow,
  threadColumns,
  threadReadable,
  threadRowsByIds,
  threadValuesFor,
} from "../forums";
import { requireProfileView } from "../profiles";
import { scanKeyset } from "./scan";
import { visibleNodes } from "./viewer";

export const authorSql = {
  threads: `SELECT ${threadColumns} FROM threads WHERE user_id = ?1 AND id < ?2 AND merged_into_id IS NULL ORDER BY id DESC LIMIT ?3`,
  posts:
    "SELECT id, thread_id, state FROM posts WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
};
const cursorSchema = z.tuple([z.number().int().positive()]);
const FIRST_PAGE = Number.MAX_SAFE_INTEGER;

/** The forums' content rule, with the forums the viewer can open resolved once. */
function feedRule(ctx: Ctx, actor: Actor) {
  const nodes = visibleNodes(ctx, actor);
  return contentRule(ctx, actor, (nodeId) => nodes.has(nodeId));
}

type PostCandidate = { id: number; thread_id: number; state: "visible" | "moderated" | "deleted" };

export const threadsByAuthorOp = implement(threadsByAuthor, (ctx, actor, input) => {
  requireProfileView(ctx, actor, input.userId);
  const rule = feedRule(ctx, actor);
  const query = prepared(ctx, "feed.threadsByAuthor", () =>
    ctx.sqlite.prepare<ThreadRow, [number, number, number]>(authorSql.threads),
  );
  const { items, next } = scanKeyset<ThreadRow, number>({
    before: input.cursor ? decodeCursor(input.cursor, cursorSchema)[0] : null,
    limit: input.limit,
    fetch: (before, count) => query.all(input.userId, before ?? FIRST_PAGE, count),
    keyOf: (row) => row.id,
    accept: (rows) => new Set(rows.filter((row) => threadReadable(rule, row))),
  });
  return {
    items: threadValuesFor(ctx, actor, items),
    nextCursor: next === null ? null : encodeCursor([next]),
  };
});

export const postsByAuthorOp = implement(postsByAuthor, (ctx, actor, input) => {
  requireProfileView(ctx, actor, input.userId);
  const rule = feedRule(ctx, actor);
  const query = prepared(ctx, "feed.postsByAuthor", () =>
    ctx.sqlite.prepare<PostCandidate, [number, number, number]>(authorSql.posts),
  );
  const threads = new Map<number, ThreadRow>();
  const { items, next } = scanKeyset<PostCandidate, number>({
    before: input.cursor ? decodeCursor(input.cursor, cursorSchema)[0] : null,
    limit: input.limit,
    fetch: (before, count) => query.all(input.userId, before ?? FIRST_PAGE, count),
    keyOf: (row) => row.id,
    accept: (rows) => {
      loadThreads(ctx, rows, threads);
      return new Set(
        rows.filter((row) => {
          const thread = threads.get(row.thread_id);
          return (
            thread !== undefined && postReadable(rule, thread, { ...row, user_id: input.userId })
          );
        }),
      );
    },
  });
  return {
    items: postsInThreads(ctx, actor, items, threads),
    nextCursor: next === null ? null : encodeCursor([next]),
  };
});

/** Loads the threads of a batch of posts into `into` (one query for the ones not loaded yet). */
export function loadThreads(
  ctx: Ctx,
  rows: { thread_id: number }[],
  into: Map<number, ThreadRow>,
): void {
  const missing = [...new Set(rows.map((row) => row.thread_id))].filter((id) => !into.has(id));
  for (const thread of threadRowsByIds(ctx, missing)) into.set(thread.id, thread);
}

/** `{ post, thread }` for each post, in order: posts, threads and their readers load once. */
export function postsInThreads(
  ctx: Ctx,
  actor: Actor,
  rows: { id: number; thread_id: number }[],
  threads: Map<number, ThreadRow>,
) {
  const posts = new Map<number, PostRow>(
    postRowsByIds(
      ctx,
      rows.map((row) => row.id),
    ).map((p) => [p.id, p]),
  );
  const found = rows.filter((row) => posts.has(row.id) && threads.has(row.thread_id));
  const postValues = new Map(
    postValuesMixed(
      ctx,
      actor,
      found.map((row) => {
        const thread = threads.get(row.thread_id)!;
        return {
          row: posts.get(row.id)!,
          locked: thread.is_locked,
          nodeId: thread.node_id,
          firstPostId: thread.first_post_id,
        };
      }),
    ).map((value) => [value.id, value]),
  );
  const threadValues = new Map(
    threadValuesFor(
      ctx,
      actor,
      [...new Set(found.map((row) => row.thread_id))].map((id) => threads.get(id)!),
    ).map((value) => [value.id, value]),
  );
  return found.map((row) => ({
    post: postValues.get(row.id)!,
    thread: threadValues.get(row.thread_id)!,
  }));
}
