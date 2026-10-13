import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { mayViewProfile, profileAccessMany } from "../profiles/shared";
import { excerptFromMarkdown } from "../seo/excerpt";

/** Where a queue item happened: a thread, or a member's profile. */
export type QueueWhere = { kind: "thread" | "profile"; id: number; title: string };
export type QueueItemContext = { excerpt: string; where: QueueWhere | null };
type Item = { type: string; id: number };

const EXCERPT_LIMIT = 200;
const ids = (items: Item[], type: string) =>
  JSON.stringify(items.filter((item) => item.type === type).map((item) => item.id));

/** The key of an item in the map `describeQueueItems` returns. */
export const queueContextKey = (type: string, id: number) => `${type}:${id}`;

const POSTS =
  "SELECT p.id, t.id AS thread_id, t.title, b.body_source FROM posts p JOIN threads t ON t.id = p.thread_id LEFT JOIN post_bodies b ON b.post_id = p.id WHERE p.id IN (SELECT value FROM json_each(?1))";
const THREADS =
  "SELECT id, title, excerpt FROM threads WHERE id IN (SELECT value FROM json_each(?1))";
const PROFILE_POSTS =
  "SELECT pp.id, pp.profile_user_id AS owner_id, u.username, pp.body_source FROM profile_posts pp JOIN users u ON u.id = pp.profile_user_id WHERE pp.id IN (SELECT value FROM json_each(?1))";
const COMMENTS =
  "SELECT pc.id, pp.profile_user_id AS owner_id, u.username, pc.body_source FROM profile_post_comments pc JOIN profile_posts pp ON pp.id = pc.profile_post_id JOIN users u ON u.id = pp.profile_user_id WHERE pc.id IN (SELECT value FROM json_each(?1))";
const USERS = "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))";

type ProfileRow = { id: number; owner_id: number; username: string; body_source: string };

/** What an item of a queue gets when nothing could be described. */
export const NO_CONTEXT: QueueItemContext = Object.freeze({ excerpt: "", where: null });

/**
 * A short plain-text excerpt and the place of each item of a page of a moderation queue (the
 * reports or the approvals the caller has already filtered to what the actor may handle): one
 * batched lookup per kind of content, never one per item. The excerpt is cut from the stored
 * source by `excerptFromMarkdown` (markup, links and tags removed, at most 200 characters).
 * Messages of a conversation are never described: nothing but the logged
 * `reports.viewConversationMessage` lets a non-participant read a conversation. Neither is a
 * profile the actor may not view.
 */
export const describeQueueItems = markPublic(
  "The caller has filtered the page to items the actor may handle; profiles the actor cannot view are left out.",
  function describeQueueItems(
    ctx: Ctx,
    actor: Actor,
    items: Item[],
  ): Map<string, QueueItemContext> {
    const found = new Map<string, QueueItemContext>();
    const rows = <T>(name: string, sql: string, type: string): T[] =>
      items.some((item) => item.type === type)
        ? prepared(ctx, `moderation.queue.${name}`, () => ctx.sqlite.prepare<T, [string]>(sql)).all(
            ids(items, type),
          )
        : [];
    const thread = (id: number, title: string): QueueWhere => ({ kind: "thread", id, title });

    for (const row of rows<{
      id: number;
      thread_id: number;
      title: string;
      body_source: string | null;
    }>("posts", POSTS, "post"))
      found.set(queueContextKey("post", row.id), {
        excerpt: excerptFromMarkdown(row.body_source ?? "", EXCERPT_LIMIT),
        where: thread(row.thread_id, row.title),
      });
    for (const row of rows<{ id: number; title: string; excerpt: string }>(
      "threads",
      THREADS,
      "thread",
    ))
      found.set(queueContextKey("thread", row.id), {
        excerpt: excerptFromMarkdown(row.excerpt, EXCERPT_LIMIT),
        where: thread(row.id, row.title),
      });

    const profiled = [
      ...rows<ProfileRow>("profilePosts", PROFILE_POSTS, "profile_post").map((row) => ({
        type: "profile_post",
        row,
      })),
      ...rows<ProfileRow>("comments", COMMENTS, "profile_post_comment").map((row) => ({
        type: "profile_post_comment",
        row,
      })),
    ];
    const users = rows<{ id: number; username: string }>("users", USERS, "user");
    const access = profileAccessMany(ctx, actor, [
      ...profiled.map(({ row }) => row.owner_id),
      ...users.map((row) => row.id),
    ]);
    const viewable = (ownerId: number) => {
      const row = access.get(ownerId);
      return row !== undefined && mayViewProfile(ctx, actor, ownerId, row);
    };
    for (const { type, row } of profiled)
      if (viewable(row.owner_id))
        found.set(queueContextKey(type, row.id), {
          excerpt: excerptFromMarkdown(row.body_source, EXCERPT_LIMIT),
          where: { kind: "profile", id: row.owner_id, title: row.username },
        });
    for (const row of users)
      if (viewable(row.id))
        found.set(queueContextKey("user", row.id), {
          excerpt: "",
          where: { kind: "profile", id: row.id, title: row.username },
        });
    return found;
  },
);
