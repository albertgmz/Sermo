import type { Ctx } from "../../context";
import { prepared } from "../../context";
import type { DomainEvent } from "../../events";
import { counted, countOf, listed, refreshing, withValue } from "./build";
import type { Spec } from "./types";

/** A new reply changes the replies its thread's author has received. */
function threadAuthorOfReply(ctx: Ctx, event: DomainEvent): number[] {
  if (event.targetType !== "post") return [];
  const row = prepared(ctx, "shared.criteriaReplyThreadAuthor", () =>
    ctx.sqlite.prepare<{ user_id: number }, [number]>(
      "SELECT t.user_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
    ),
  ).get(event.targetId);
  return row ? [row.user_id] : [];
}

/**
 * Whoever put the tags a thread carries, when the thread is made, its tags change or its
 * opening post (whose hashtags are tags) is edited.
 */
function taggers(ctx: Ctx, event: DomainEvent): number[] {
  if (event.targetType === "thread")
    return prepared(ctx, "shared.criteriaThreadTaggers", () =>
      ctx.sqlite.prepare<{ added_by: number }, [number]>(
        "SELECT DISTINCT added_by FROM thread_tags WHERE thread_id = ?1 AND added_by IS NOT NULL",
      ),
    )
      .all(event.targetId)
      .map((row) => row.added_by);
  if (event.targetType !== "post" || event.type !== "content.edited") return [];
  return prepared(ctx, "shared.criteriaPostTaggers", () =>
    ctx.sqlite.prepare<{ added_by: number }, [number]>(
      "SELECT DISTINCT tt.added_by FROM posts p JOIN threads t ON t.id = p.thread_id AND t.first_post_id = p.id JOIN thread_tags tt ON tt.thread_id = t.id WHERE p.id = ?1 AND tt.added_by IS NOT NULL",
    ),
  )
    .all(event.targetId)
    .map((row) => row.added_by);
}

/**
 * What a member has written, kept and followed. All of these count rows of the member's
 * history, so they only run in background checks.
 */
export const contentSpecs: readonly Spec[] = [
  listed(
    "posts_in_threads",
    "threads",
    {
      shape: "perId",
      // posts_user (user_id, state, thread_id) answers it without reading a post. Posts keep
      // their own state when their thread is hidden, so the thread's is checked once per listed
      // thread, as `users.post_count` counts only posts of visible threads.
      sql:
        "SELECT p.user_id AS user_id, p.thread_id AS id, count(*) AS n FROM posts p " +
        "WHERE p.user_id IN (SELECT value FROM json_each(?1)) AND p.state = 'visible' " +
        "AND p.thread_id IN (SELECT id FROM threads WHERE state = 'visible' AND id IN (SELECT value FROM json_each(?2))) " +
        "GROUP BY p.user_id, p.thread_id",
    },
    { modes: ["each", "one", "all"], value: true },
  ),
  // Every visible reply in their visible threads, their own replies included (the title says so).
  counted(
    "replies_received",
    {
      shape: "scalar",
      sql:
        "SELECT t.user_id AS user_id, NULL AS id, sum(t.reply_count) AS n FROM threads t INDEXED BY threads_user_id " +
        "WHERE t.user_id IN (SELECT value FROM json_each(?1)) AND t.state = 'visible' GROUP BY t.user_id",
    },
    { refresh: { on: ["content.created"], members: threadAuthorOfReply } },
  ),
  counted(
    "busiest_thread_replies",
    {
      shape: "scalar",
      sql:
        "SELECT t.user_id AS user_id, NULL AS id, max(t.reply_count) AS n FROM threads t INDEXED BY threads_user_id " +
        "WHERE t.user_id IN (SELECT value FROM json_each(?1)) AND t.state = 'visible' GROUP BY t.user_id",
    },
    { refresh: { on: ["content.created"], members: threadAuthorOfReply } },
  ),
  counted(
    "profile_posts_written",
    countOf("profile_posts", "user_id", "profile_posts_user_id", "state = 'visible'"),
  ),
  counted(
    "profile_comments_written",
    countOf(
      "profile_post_comments",
      "user_id",
      "profile_post_comments_user_id",
      "state = 'visible'",
    ),
  ),
  counted(
    "attachments_uploaded",
    countOf(
      "files",
      "uploader_id",
      "files_uploader",
      "purpose = 'attachment' AND deleted_at IS NULL AND visibility != 'unattached'",
    ),
  ),
  // The tags the member has put on threads that are visible and still carry them (as post_count
  // counts visible posts of visible threads): a counter on the member's row that triggers keep,
  // so it is read like the awards held, never counted.
  refreshing(
    withValue("tags_added_at_least", "atLeast", "count", "member", (f, v) => f.tagCount >= v),
    ["content.created", "content.edited", "content.state_changed", "content.deleted"],
    taggers,
  ),
  counted("bookmarks_at_least", countOf("bookmarks", "user_id", "bookmarks_user")),
  counted("watching_forums_at_least", countOf("node_watches", "user_id", "node_watches_user")),
  counted("watching_threads_at_least", countOf("thread_watches", "user_id", "thread_watches_user")),
];
