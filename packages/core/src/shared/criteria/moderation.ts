import type { Ctx } from "../../context";
import { prepared } from "../../context";
import type { DomainEvent } from "../../events";
import { counted, countOf, flag, lookup, refreshing } from "./build";
import type { Spec } from "./types";

/** The member a ban, restriction or thread ban was put on or lifted from. */
const target = (_ctx: Ctx, event: DomainEvent) => [event.targetId];

/** Whoever reported what a moderator has just resolved. */
function reportersOfResolved(ctx: Ctx, event: DomainEvent): number[] {
  if (event.payload.state !== "resolved") return [];
  return prepared(ctx, "shared.criteriaReporters", () =>
    ctx.sqlite.prepare<{ reporter_id: number }, [number]>(
      "SELECT reporter_id FROM reports WHERE group_id = ?1",
    ),
  )
    .all(event.targetId)
    .map((row) => row.reporter_id);
}

/**
 * What moderators have done to a member, and what a member has done as one. A restriction is
 * active while its expiry on the member's row lies ahead, so those are cheap; the rest is one
 * indexed lookup (thread bans, past bans) or a count of the member's history.
 */
export const moderationSpecs: readonly Spec[] = [
  refreshing(
    flag("restricted_posting", (f) => f.restrictedPosting),
    ["member.restricted"],
    target,
  ),
  refreshing(
    flag("restricted_conversations", (f) => f.restrictedConversations),
    ["member.restricted"],
    target,
  ),
  refreshing(
    flag("restricted_profile_posts", (f) => f.restrictedProfilePosts),
    ["member.restricted"],
    target,
  ),
  // Banned from at least one thread, and the ban has not run out.
  lookup(
    "thread_banned",
    {
      shape: "scalar",
      sql:
        "SELECT user_id, NULL AS id, 1 AS n FROM thread_bans INDEXED BY thread_bans_user " +
        "WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?4) GROUP BY user_id",
    },
    { on: ["member.thread_banned"], members: target },
  ),
  // Any ban on record, current or over.
  lookup(
    "banned_before",
    {
      shape: "scalar",
      sql:
        "SELECT user_id, NULL AS id, 1 AS n FROM bans INDEXED BY bans_user_active " +
        "WHERE user_id IN (SELECT value FROM json_each(?1)) GROUP BY user_id",
    },
    { on: ["member.banned"], members: target },
  ),
  // Reports the member filed that a moderator resolved (not the rejected ones).
  counted(
    "reports_resolved",
    {
      shape: "scalar",
      sql:
        "SELECT r.reporter_id AS user_id, NULL AS id, count(*) AS n FROM reports r INDEXED BY reports_reporter " +
        "JOIN report_groups g ON g.id = r.group_id " +
        "WHERE r.reporter_id IN (SELECT value FROM json_each(?1)) AND g.state = 'resolved' GROUP BY r.reporter_id",
    },
    { refresh: { on: ["report.state_changed"], members: reportersOfResolved } },
  ),
  // Entries in the moderator log under the member's name; the sweep counts them.
  counted("moderator_actions", countOf("moderator_log", "actor_id", "moderator_log_actor")),
];
