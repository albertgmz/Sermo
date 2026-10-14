import * as z from "zod";
import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { bookmarksList, bookmarksSet, bookmarksStatus } from "../../contracts/bookmarks";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import {
  contentRule,
  postReadable,
  type ThreadRow,
  threadReadable,
  threadRowsByIds,
} from "../forums";
import { excerptFromMarkdown } from "../seo/excerpt";

/** Bookmark rows examined by one `bookmarks.list` request, whatever the page size. */
const SCAN_CAP = 300;
/** Rows read per round trip; the items of a round are loaded per type. */
const BATCH_SIZE = 100;
/** Merges followed to the thread that holds a merged thread, as `threads.get` does. */
const MERGE_HOPS = 16;
/** Source characters masked for an excerpt. */
const EXCERPT_SOURCE = 2000;

type ContentType = "thread" | "post" | "conversation";
type State = "visible" | "moderated" | "deleted";
type Row = { id: number; created_at: number; content_type: ContentType; content_id: number };
type PostItem = {
  id: number;
  thread_id: number;
  user_id: number;
  position: number;
  state: State;
  body_source: string;
};
type ConversationItem = { id: number; title: string; user_id: number };
type Item = {
  title: string;
  threadId: number | null;
  postPosition: number | null;
  authorId: number;
  excerpt: string;
};

export const bookmarksSql = {
  status:
    "SELECT content_id FROM bookmarks WHERE user_id = ?1 AND content_type = ?2 AND content_id IN (SELECT value FROM json_each(?3))",
  page: "SELECT id, created_at, content_type, content_id FROM bookmarks WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  add: "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, content_type, content_id) DO NOTHING",
  remove: "DELETE FROM bookmarks WHERE user_id = ?1 AND content_type = ?2 AND content_id = ?3",
  mergedTarget: "SELECT merged_into_id FROM threads WHERE id = ?1",
  postOne: "SELECT thread_id, user_id, state FROM posts WHERE id = ?1",
  posts:
    "SELECT p.id, p.thread_id, p.user_id, CASE WHEN p.position < 0 THEN -p.position - 1 ELSE p.position END AS position, p.state, b.body_source FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.id IN (SELECT value FROM json_each(?1))",
  conversationOne:
    "SELECT 1 AS found FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2 AND state = 'active'",
  conversations:
    "SELECT c.id, c.title, c.user_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE cp.user_id = ?1 AND cp.state = 'active' AND cp.conversation_id IN (SELECT value FROM json_each(?2))",
} as const;

function statement<R, P extends (string | number)[]>(ctx: Ctx, name: string, sql: string) {
  return prepared(ctx, `bookmarks.${name}`, () => ctx.sqlite.prepare<R, P>(sql));
}

/** The thread a thread was merged into, following the chain; the id itself when never merged. */
function mergeTarget(ctx: Ctx, id: number): number {
  const next = statement<{ merged_into_id: number | null }, [number]>(
    ctx,
    "mergedTarget",
    bookmarksSql.mergedTarget,
  );
  let target = id;
  for (let hops = 0; hops < MERGE_HOPS; hops++) {
    const merged = next.get(target)?.merged_into_id;
    if (!merged) break;
    target = merged;
  }
  return target;
}

/** Whether the viewer may see the item, by the rule of its own read. */
function canSee(ctx: Ctx, actor: Actor, userId: number, type: ContentType, id: number): boolean {
  const rule = contentRule(ctx, actor);
  if (type === "thread") {
    const [thread] = threadRowsByIds(ctx, [id]);
    return thread !== undefined && threadReadable(rule, thread);
  }
  if (type === "post") {
    const post = statement<{ thread_id: number; user_id: number; state: State }, [number]>(
      ctx,
      "postOne",
      bookmarksSql.postOne,
    ).get(id);
    if (!post) return false;
    const [thread] = threadRowsByIds(ctx, [post.thread_id]);
    return thread !== undefined && postReadable(rule, thread, post);
  }
  return (
    statement<{ found: number }, [number, number]>(
      ctx,
      "conversationOne",
      bookmarksSql.conversationOne,
    ).get(id, userId) != null
  );
}

export const bookmarksSetOp = implement(
  bookmarksSet,
  (ctx, actor, input) => {
    const { userId } = requireAuthenticated(actor);
    // A merged thread is bookmarked as the thread it became.
    const contentId =
      input.contentType === "thread" ? mergeTarget(ctx, input.contentId) : input.contentId;
    if (input.bookmarked && !canSee(ctx, actor, userId, input.contentType, contentId))
      throw new NotFoundError();
    // Removing needs no view of the item: a bookmark on something since hidden stays removable.
    writeTx(ctx, () => {
      if (input.bookmarked)
        statement<never, [number, string, number, number]>(ctx, "add", bookmarksSql.add).run(
          userId,
          input.contentType,
          contentId,
          ctx.now(),
        );
      else {
        const remove = statement<never, [number, string, number]>(
          ctx,
          "remove",
          bookmarksSql.remove,
        );
        // Both ids: a row made before the merge is under the old one.
        remove.run(userId, input.contentType, input.contentId);
        if (contentId !== input.contentId) remove.run(userId, input.contentType, contentId);
      }
    });
    return { ok: true as const };
  },
  {
    public:
      "Every member may bookmark; the item must be visible to them by the rule of its own read.",
  },
);

export const bookmarksStatusOp = implement(
  bookmarksStatus,
  (ctx, actor, input) => {
    const userId = actorUserId(actor);
    if (userId === null || input.ids.length === 0) return { bookmarked: [] };
    const rows = statement<{ content_id: number }, [number, string, string]>(
      ctx,
      "status",
      bookmarksSql.status,
    ).all(userId, input.contentType, JSON.stringify([...new Set(input.ids)]));
    return { bookmarked: rows.map((row) => row.content_id) };
  },
  { public: "A member reads only their own bookmarks; a guest gets an empty list." },
);

/** The items of a batch of bookmarks that the viewer can see, keyed `type:id`. */
function loadVisible(ctx: Ctx, actor: Actor, userId: number, rows: Row[]): Map<string, Item> {
  const idsOf = (type: ContentType) =>
    rows.filter((row) => row.content_type === type).map((row) => row.content_id);
  const threadIds = idsOf("thread");
  const postIds = idsOf("post");
  const conversationIds = idsOf("conversation");
  const posts =
    postIds.length === 0
      ? []
      : statement<PostItem, [string]>(ctx, "posts", bookmarksSql.posts).all(
          JSON.stringify(postIds),
        );
  const threads = new Map<number, ThreadRow>(
    threadRowsByIds(ctx, [...threadIds, ...posts.map((post) => post.thread_id)]).map((row) => [
      row.id,
      row,
    ]),
  );
  // A merged thread is shown as the thread it became: load the targets, a hop at a time.
  const final = (id: number): ThreadRow | undefined => {
    let thread = threads.get(id);
    for (let hops = 0; thread?.merged_into_id && hops < MERGE_HOPS; hops++)
      thread = threads.get(thread.merged_into_id);
    return thread;
  };
  for (let hops = 0; hops < MERGE_HOPS; hops++) {
    const missing = [...threads.values()]
      .map((row) => row.merged_into_id)
      .filter((id): id is number => id !== null && !threads.has(id));
    if (missing.length === 0) break;
    for (const row of threadRowsByIds(ctx, missing)) threads.set(row.id, row);
  }
  const conversations =
    conversationIds.length === 0
      ? []
      : statement<ConversationItem, [number, string]>(
          ctx,
          "conversations",
          bookmarksSql.conversations,
        ).all(userId, JSON.stringify(conversationIds));
  const rule = contentRule(ctx, actor);
  const items = new Map<string, Item>();
  for (const id of threadIds) {
    const thread = final(id);
    if (thread && threadReadable(rule, thread))
      items.set(`thread:${id}`, {
        title: thread.title,
        threadId: thread.id,
        postPosition: null,
        authorId: thread.user_id,
        excerpt: thread.excerpt,
      });
  }
  for (const post of posts) {
    const thread = threads.get(post.thread_id);
    if (thread && postReadable(rule, thread, post))
      items.set(`post:${post.id}`, {
        title: thread.title,
        threadId: thread.id,
        postPosition: post.position,
        authorId: post.user_id,
        excerpt: excerptFromMarkdown(post.body_source, 200, EXCERPT_SOURCE),
      });
  }
  for (const conversation of conversations)
    items.set(`conversation:${conversation.id}`, {
      title: conversation.title,
      threadId: null,
      postPosition: null,
      authorId: conversation.user_id,
      excerpt: "",
    });
  return items;
}

export const bookmarksListOp = implement(
  bookmarksList,
  (ctx, actor, input) => {
    const { userId } = requireAuthenticated(actor);
    let cursor = input.cursor
      ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
      : Number.MAX_SAFE_INTEGER;
    const page = statement<Row, [number, number, number]>(ctx, "page", bookmarksSql.page);
    const accepted: { row: Row; item: Item }[] = [];
    let examined = 0;
    while (accepted.length < input.limit && examined < SCAN_CAP) {
      const rows = page.all(userId, cursor, Math.min(BATCH_SIZE, SCAN_CAP - examined));
      if (rows.length === 0) break;
      const items = loadVisible(ctx, actor, userId, rows);
      for (const row of rows) {
        cursor = row.id;
        examined++;
        const item = items.get(`${row.content_type}:${row.content_id}`);
        if (item) accepted.push({ row, item });
        if (accepted.length === input.limit) break;
      }
    }
    const more = page.get(userId, cursor, 1) != null;
    const users = loadUserSummaries(
      ctx,
      accepted.map(({ item }) => item.authorId),
    );
    return {
      items: accepted.map(({ row, item }) => ({
        id: row.id,
        contentType: row.content_type,
        contentId: row.content_id,
        createdAt: iso(row.created_at),
        title: item.title,
        threadId: item.threadId,
        postPosition: item.postPosition,
        author: users(item.authorId),
        excerpt: item.excerpt,
      })),
      nextCursor: more ? encodeCursor([cursor]) : null,
    };
  },
  { public: "A member lists only their own bookmarks; each item is checked against its own read." },
);

export const operations = [bookmarksSetOp, bookmarksStatusOp, bookmarksListOp];
