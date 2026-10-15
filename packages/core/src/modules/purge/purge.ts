import type { SQLQueryBindings } from "bun:sqlite";
import { type Ctx, prepared } from "../../context";
import { ConflictError } from "../../errors";
import { enqueueJob } from "../jobs";

/**
 * Removing content for good: the rows that hang off a post, a profile post or a wall comment,
 * and the content row itself. Callers authorize, check the content is soft-deleted, bound the
 * number of ids (a few hundred) and run this inside their write transaction.
 *
 * Per table, what happens and why:
 * - Deleted with the content: bodies, revisions, reactions (the author's `reaction_score` gives
 *   back what they brought, because a soft delete keeps it), attachments (the files are queued
 *   for deletion), spoilers, mentions, the quotes the content made and the rows that record who
 *   quoted it, alerts about it (the members' unread counters go down), bookmarks, reports and
 *   report groups, the credit applications it caused, and its domain events.
 * - Kept, with the reference nulled: `ip_log` rows. The address history of a member is a
 *   security record, so the row stays and only its pointer to the content goes.
 * - Kept as they are: `moderator_log` and `credit_transactions` (append-only ledgers that name
 *   the content by id) and the sealed-off `domain_events` cursor positions of subscribers.
 *
 * SQLite hands the id of a deleted newest row to the next insert, so nothing may be left that
 * names the old id: that is why the quotes, events and credit applications are deleted rather
 * than kept.
 */
export type PurgeType = "post" | "profile_post" | "profile_post_comment";

/** Posts or comments removed by one call of a hard delete. */
export const PURGE_CHUNK = 500;

const TABLES: Record<PurgeType, string> = {
  post: "posts",
  profile_post: "profile_posts",
  profile_post_comment: "profile_post_comments",
};

function statement<Row = unknown>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `purge.${key}`, () => ctx.sqlite.prepare<Row, SQLQueryBindings[]>(sql));
}

/**
 * A soft delete takes back the credits the content paid in a job that runs after the commit. A
 * purge before that job ran would strand them, so it waits: the same call succeeds a moment later.
 */
export function assertCreditsSettled(ctx: Ctx, type: PurgeType | "thread", ids: number[]): void {
  if (!ids.length) return;
  const open = statement(
    ctx,
    "creditsOpen",
    "SELECT 1 AS found FROM credit_rule_applications INDEXED BY credit_rule_applications_source WHERE source_type = ?1 AND source_id IN (SELECT value FROM json_each(?2)) AND state = 'applied' LIMIT 1",
  ).get(type, JSON.stringify(ids));
  if (open)
    throw new ConflictError("The credits it paid are still being taken back. Try again shortly.");
}

/**
 * Removes the alerts that match `where` and lowers the unread counters of the members who held
 * them (an alert from an older epoch already counts as read).
 */
function removeAlerts(ctx: Ctx, key: string, where: string, ...params: SQLQueryBindings[]): void {
  const unread = statement<{ user_id: number }>(
    ctx,
    `alertsUnread.${key}`,
    `SELECT n.user_id FROM notifications n JOIN users u ON u.id = n.user_id WHERE ${where} AND n.read_at IS NULL AND n.epoch = u.notification_epoch`,
  ).all(...params);
  statement(ctx, `alertsDelete.${key}`, `DELETE FROM notifications AS n WHERE ${where}`).run(
    ...params,
  );
  if (!unread.length) return;
  const counts = new Map<number, number>();
  for (const row of unread) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  statement(
    ctx,
    "alertsCount",
    "UPDATE users SET unread_notification_count = max(0, unread_notification_count - (SELECT json_extract(value, '$.n') FROM json_each(?1) WHERE json_extract(value, '$.id') = users.id)) WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))",
  ).run(JSON.stringify([...counts].map(([id, n]) => ({ id, n }))));
}
const aboutContent = "n.content_type = ?1 AND n.content_id IN (SELECT value FROM json_each(?2))";

/** The pictures and files of the content: unlinked now, deleted from storage by a job. */
function removeAttachments(ctx: Ctx, type: PurgeType, json: string): void {
  const files = statement<{ file_id: number }>(
    ctx,
    "attachmentFiles",
    "SELECT file_id FROM attachments WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ).all(type, json);
  if (!files.length) return;
  statement(
    ctx,
    "attachmentsDelete",
    "DELETE FROM attachments WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ).run(type, json);
  const fileIds = JSON.stringify(files.map((row) => row.file_id));
  statement(
    ctx,
    "attachmentsPrivate",
    "UPDATE files SET visibility = 'private' WHERE id IN (SELECT value FROM json_each(?1)) OR parent_file_id IN (SELECT value FROM json_each(?1))",
  ).run(fileIds);
  for (const { file_id } of files)
    enqueueJob(
      ctx,
      "storage.deletePermanent",
      { id: file_id },
      { uniqueKey: `storage.deletePermanent.${file_id}` },
    );
}

/** Removes the reports about the content, whatever their state. */
function removeReports(ctx: Ctx, type: PurgeType, json: string): void {
  const groups = statement<{ id: number }>(
    ctx,
    "reportGroups",
    "SELECT id FROM report_groups WHERE target_type = ?1 AND target_id IN (SELECT value FROM json_each(?2))",
  ).all(type, json);
  if (!groups.length) return;
  const ids = JSON.stringify(groups.map((group) => group.id));
  statement(
    ctx,
    "reportsDelete",
    "DELETE FROM reports WHERE group_id IN (SELECT value FROM json_each(?1))",
  ).run(ids);
  statement(
    ctx,
    "reportGroupsDelete",
    "DELETE FROM report_groups WHERE id IN (SELECT value FROM json_each(?1))",
  ).run(ids);
}

const bySource = [
  [
    "bookmarks",
    "DELETE FROM bookmarks WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "credits",
    "DELETE FROM credit_rule_applications WHERE source_type = ?1 AND source_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "events",
    "DELETE FROM domain_events WHERE target_type = ?1 AND target_id IN (SELECT value FROM json_each(?2))",
  ],
] as const;
/** What only a post, a profile post or a comment has. */
const ofContent = [
  [
    "reactionScore",
    "UPDATE users SET reaction_score = reaction_score - gone.total FROM (SELECT content_user_id, sum(score) AS total FROM reactions WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2)) GROUP BY content_user_id) AS gone WHERE users.id = gone.content_user_id",
  ],
  [
    "reactions",
    "DELETE FROM reactions WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "spoilers",
    "DELETE FROM content_spoilers WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "mentions",
    "DELETE FROM content_mentions WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "quotes",
    "DELETE FROM content_quotes WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
  ],
  [
    "ipLog",
    "UPDATE ip_log SET content_type = NULL, content_id = NULL WHERE content_type = ?1 AND content_id IS NOT NULL AND content_id IN (SELECT value FROM json_each(?2))",
  ],
] as const;

/**
 * Deletes the content rows and all that hangs off them. `ids` are already known to exist and to
 * be soft-deleted (a thread's posts go with the thread, in whatever state they are).
 */
export function purgeContent(ctx: Ctx, type: PurgeType, ids: number[]): void {
  if (!ids.length) return;
  const json = JSON.stringify(ids);
  assertCreditsSettled(ctx, type, ids);
  for (const [key, sql] of ofContent) statement(ctx, key, sql).run(type, json);
  for (const [key, sql] of bySource) statement(ctx, key, sql).run(type, json);
  // Posts quoted by other content: their rows are the record that the quote was announced.
  if (type === "post")
    statement(
      ctx,
      "quotedBy",
      "DELETE FROM content_quotes WHERE quoted_post_id IN (SELECT value FROM json_each(?1))",
    ).run(json);
  removeAlerts(ctx, type, aboutContent, type, json);
  removeAttachments(ctx, type, json);
  removeReports(ctx, type, json);
  if (type === "post") {
    statement(
      ctx,
      "revisions",
      "DELETE FROM post_revisions WHERE post_id IN (SELECT value FROM json_each(?1))",
    ).run(json);
    statement(
      ctx,
      "bodies",
      "DELETE FROM post_bodies WHERE post_id IN (SELECT value FROM json_each(?1))",
    ).run(json);
  }
  statement(
    ctx,
    `rows.${type}`,
    `DELETE FROM ${TABLES[type]} WHERE id IN (SELECT value FROM json_each(?1))`,
  ).run(json);
}

/** What hangs off a thread itself (its posts are purged separately), then the thread. */
export function purgeThread(ctx: Ctx, threadId: number): void {
  const json = JSON.stringify([threadId]);
  assertCreditsSettled(ctx, "thread", [threadId]);
  for (const [key, sql] of bySource) statement(ctx, key, sql).run("thread", json);
  removeAlerts(ctx, "thread", aboutContent, "thread", json);
  removeAlerts(ctx, "inThread", "n.thread_id = ?1", threadId);
  for (const [key, sql] of [
    ["features", "DELETE FROM thread_features WHERE thread_id = ?1"],
    ["reads", "DELETE FROM thread_reads WHERE thread_id = ?1"],
    ["watches", "DELETE FROM thread_watches WHERE thread_id = ?1"],
    ["bans", "DELETE FROM thread_bans WHERE thread_id = ?1"],
    ["rankings", "DELETE FROM rankings WHERE target_id = ?1"],
    ["thread", "DELETE FROM threads WHERE id = ?1"],
  ] as const)
    statement(ctx, `thread.${key}`, sql).run(threadId);
}
