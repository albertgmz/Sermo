import type { SQLQueryBindings } from "bun:sqlite";
import { type Ctx, prepared } from "../../context";
import { ConflictError } from "../../errors";
import { POLL_PURGE_BATCH } from "../../limits";
import { moveCredits } from "../../shared/credits";
import { enqueueJob } from "../jobs";
import { purgeThreadTags } from "../tags/store";

/**
 * Removing content for good: the rows that hang off a post, a profile post or a wall comment,
 * and the content row itself. Callers authorize, check the content is soft-deleted, bound the
 * number of ids (a few hundred) and run this inside their write transaction.
 *
 * Per table, what happens and why:
 * - Deleted with the content: bodies, revisions, reactions (the author's `reaction_score` gives
 *   back what they brought, because a soft delete keeps it), attachments (the files are queued
 *   for deletion), spoilers, mentions, the quotes the content made and the rows that record who
 *   quoted it, alerts about it and about its reports (the members' unread counters go down),
 *   bookmarks, reports and report groups, and the credit applications it caused. Credits the
 *   applications still hold are taken back first, with a ledger row each: a soft delete does this
 *   in a job after the commit, and a reply of a deleted thread keeps its credits until now.
 * - Polls and quizzes of a thread go with it (votes, ballots, answers, questions, pictures); so
 *   does one left on a thread merged away.
 * - Kept, with the reference nulled: `ip_log` rows. The address history of a member is a
 *   security record, so the row stays and only its pointer to the content goes.
 * - Kept as they are: `moderator_log` (append-only; it names the content by id),
 *   `credit_transactions` (append-only; it names the credit rule, never the content) and
 *   `domain_events`. Events are never deleted: an id is reused only when the newest row of a
 *   table is removed, and a subscriber's cursor would then skip the events that took the freed
 *   ids. A subscriber finds the content gone and does nothing.
 *
 * SQLite hands the id of a deleted newest row to the next insert, so what names the old id and
 * would then attach to the new row (quotes, credit applications, alerts, bookmarks, reports,
 * the merge tombstones of a thread) is deleted rather than kept. Readers of the kept rows look
 * only at their own row's life (`created_at`): the credit rules and the report alerts do. A read
 * marker is clamped by the caller. What cannot be reached is listed in the task notes.
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
 * Takes back what the content's credit applications still hold, in the caller's transaction
 * (`moveCredits` writes the ledger rows), before they are deleted. The applications a soft
 * delete already reverted hold nothing.
 */
function takeBackCredits(ctx: Ctx, type: PurgeType | "thread", json: string): void {
  const held = statement<{ rule_id: number; user_id: number; amount: number }>(
    ctx,
    "creditsHeld",
    "SELECT rule_id, user_id, amount FROM credit_rule_applications INDEXED BY credit_rule_applications_source WHERE source_type = ?1 AND source_id IN (SELECT value FROM json_each(?2)) AND state = 'applied' ORDER BY id",
  ).all(type, json);
  for (let at = 0; at < held.length; at += 500)
    moveCredits(
      ctx,
      held.slice(at, at + 500).map((row) => ({
        userId: row.user_id,
        amount: -row.amount,
        type: "event_reversal" as const,
        source: { type: "credit_rule", id: row.rule_id },
      })),
    );
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
  // A join, not a subquery per member: the counts are read once, however many members there are.
  statement(
    ctx,
    "alertsCount",
    "UPDATE users SET unread_notification_count = max(0, unread_notification_count - c.n) FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.n') AS n FROM json_each(?1)) AS c WHERE users.id = c.id",
  ).run(JSON.stringify([...counts].map(([id, n]) => ({ id, n }))));
}
const aboutContent = "n.content_type = ?1 AND n.content_id IN (SELECT value FROM json_each(?2))";

/** The pictures and files of the content: unlinked now, deleted from storage by a job. */
function removeAttachments(ctx: Ctx, type: PurgeType | "poll", json: string): void {
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

/**
 * Deletes polls with everything they hold: votes, ballots (the triggers lower the counters of
 * the polls and of the members who took part), answers, questions, and the pictures (unlinked
 * now, deleted from storage by a job). Callers authorize.
 */
export function purgePolls(ctx: Ctx, pollIds: number[]): void {
  if (!pollIds.length) return;
  const json = JSON.stringify(pollIds);
  for (const [key, sql] of [
    ["votes", "DELETE FROM poll_votes WHERE poll_id IN (SELECT value FROM json_each(?1))"],
    ["ballots", "DELETE FROM poll_ballots WHERE poll_id IN (SELECT value FROM json_each(?1))"],
    ["answers", "DELETE FROM poll_answers WHERE poll_id IN (SELECT value FROM json_each(?1))"],
    ["questions", "DELETE FROM poll_questions WHERE poll_id IN (SELECT value FROM json_each(?1))"],
  ] as const)
    statement(ctx, `polls.${key}`, sql).run(json);
  removeAttachments(ctx, "poll", json);
  statement(
    ctx,
    "polls.rows",
    "DELETE FROM polls WHERE id IN (SELECT value FROM json_each(?1))",
  ).run(json);
}

/**
 * Removes the votes and ballots of one batch of the poll's voters (`POLL_PURGE_BATCH` members, so
 * the counter triggers of one transaction stay bounded) and says how many voters are left. The
 * poll itself stays until `purgePolls` takes what is left.
 */
export function purgePollBatch(ctx: Ctx, pollId: number): number {
  const members = JSON.stringify(
    statement<{ user_id: number }>(
      ctx,
      "polls.batchMembers",
      "SELECT user_id FROM poll_ballots WHERE poll_id = ?1 ORDER BY user_id LIMIT ?2",
    )
      .all(pollId, POLL_PURGE_BATCH)
      .map((row) => row.user_id),
  );
  statement(
    ctx,
    "polls.batchVotes",
    "DELETE FROM poll_votes WHERE poll_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  ).run(pollId, members);
  statement(
    ctx,
    "polls.batchBallots",
    "DELETE FROM poll_ballots WHERE poll_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  ).run(pollId, members);
  return (
    statement<{ ballot_count: number }>(
      ctx,
      "polls.remaining",
      "SELECT ballot_count FROM polls WHERE id = ?1",
    ).get(pollId)?.ballot_count ?? 0
  );
}

/**
 * The poll of the thread, or of a thread merged into it, that has more voters than one batch
 * removes (the id of one of them), or null. A hard delete takes those out batch by batch before
 * it removes anything else.
 */
export function pollNeedingBatches(ctx: Ctx, threadId: number): number | null {
  const ids = JSON.stringify([threadId, ...tombstonesOf(ctx, threadId)]);
  return (
    statement<{ id: number }>(
      ctx,
      "polls.large",
      "SELECT id FROM polls WHERE thread_id IN (SELECT value FROM json_each(?1)) AND ballot_count > ?2 LIMIT 1",
    ).get(ids, POLL_PURGE_BATCH)?.id ?? null
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
  // The alerts moderators got about the report, and the address rows of the people who filed it.
  removeAlerts(ctx, "reportGroup", aboutContent, "report_group", ids);
  statement(
    ctx,
    "reportsIp",
    "UPDATE ip_log SET content_type = NULL, content_id = NULL WHERE content_type = 'report' AND content_id IS NOT NULL AND content_id IN (SELECT id FROM reports WHERE group_id IN (SELECT value FROM json_each(?1)))",
  ).run(ids);
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
  takeBackCredits(ctx, type, json);
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

/**
 * The merge tombstones that resolve to the thread, directly or through other tombstones: threads
 * merged into it, or into one merged into it. They are found through the moderator log, which
 * names every merge by its target (an index seek), not by scanning the threads.
 */
function tombstonesOf(ctx: Ctx, threadId: number): number[] {
  const found: number[] = [];
  const queue = [threadId];
  for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
    const merged = statement<{ id: number }>(
      ctx,
      "tombstones",
      "SELECT id FROM threads WHERE merged_into_id = ?1 AND id IN (SELECT json_extract(details, '$.sourceId') FROM moderator_log WHERE target_type = 'thread' AND target_id = ?1 AND action = 'thread.merge')",
    ).all(target);
    for (const { id } of merged) {
      found.push(id);
      queue.push(id);
    }
  }
  return found;
}

/** What hangs off a thread itself (its posts are purged separately), then the thread. */
export function purgeThread(ctx: Ctx, threadId: number): void {
  // The old addresses of merged threads go too: an id can be given to a new thread, and an old
  // address must not then open an unrelated one.
  for (const id of [threadId, ...tombstonesOf(ctx, threadId)]) purgeThreadRows(ctx, id);
}

function purgeThreadRows(ctx: Ctx, threadId: number): void {
  const json = JSON.stringify([threadId]);
  takeBackCredits(ctx, "thread", json);
  for (const [key, sql] of bySource) statement(ctx, key, sql).run("thread", json);
  removeAlerts(ctx, "thread", aboutContent, "thread", json);
  removeAlerts(ctx, "inThread", "n.thread_id = ?1", threadId);
  purgeThreadTags(ctx, threadId);
  purgePolls(
    ctx,
    statement<{ id: number }>(ctx, "thread.polls", "SELECT id FROM polls WHERE thread_id = ?1")
      .all(threadId)
      .map((row) => row.id),
  );
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

/**
 * Removal of a deleted thread or wall post has begun, and is not finished, when its newest
 * hard-delete log entry says so (`completed: false`); an entry that says `completed: true` closes
 * the life of an earlier row of the same id. Such content is missing its newest posts or comments
 * for good and cannot be brought back. Time plays no part: a thread made by a split carries an
 * old date. One seek on the log's target index.
 */
export function assertRemovalNotBegun(ctx: Ctx, type: "thread" | "profile_post", id: number): void {
  const action = `${type}.hardDelete`;
  const begun = statement(
    ctx,
    "removalBegun",
    "SELECT 1 AS found FROM moderator_log b WHERE b.target_type = ?1 AND b.target_id = ?2 AND b.action = ?3 AND json_extract(b.details, '$.completed') = 0 AND NOT EXISTS (SELECT 1 FROM moderator_log d WHERE d.target_type = ?1 AND d.target_id = ?2 AND d.action = ?3 AND json_extract(d.details, '$.completed') = 1 AND d.id > b.id) LIMIT 1",
  ).get(type, id, action);
  if (begun)
    throw new ConflictError(
      `This ${type === "thread" ? "thread" : "wall post"} is being deleted for good and part of it is already gone. Finish deleting it.`,
    );
}
