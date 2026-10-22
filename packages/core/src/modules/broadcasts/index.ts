import type { z } from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import * as contracts from "../../contracts/broadcasts";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import {
  currentActor,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requirePermission,
} from "../../permissions";
import { renderContent } from "../../render";
import { assertRule, everyone } from "../../shared/criteria";
import { loadUserSummaries } from "../../shared/users";
import { requireNotErased } from "../admin/erased";
import { confirmActorPassword } from "../admin/shared";
import {
  deliverAlerts,
  deliverMessages,
  type Outcome,
  reachable,
  type StoredContent,
} from "./deliver";
import {
  broadcastRunValue,
  CHANGED,
  countBroadcast,
  discardBroadcast,
  isSeen,
  latestRun,
  logBroadcast,
  resumeBroadcast,
  type Seen,
  sendCounted,
  stopBroadcast,
} from "./run";

export { ALERT_CHUNK, BROADCAST_JOB, MESSAGE_CHUNK, registerBroadcastJobs } from "./run";

type Content = z.infer<typeof contracts.BroadcastContent>;

/** The member row with what the hierarchy check reads. */
function principalOf(ctx: Ctx, userId: number) {
  const row = prepared(ctx, "broadcasts.principal", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ),
  ).get(userId);
  if (!row) throw new NotFoundError();
  return memberActor(row.id, row.group_id, row, currentVersions(ctx));
}

/**
 * The content as it is stored and sent: a message is rendered once, for all its recipients, as
 * the administrator would post it. Sending as another member needs `admin.members` over them.
 */
function prepareContent(ctx: Ctx, actor: Actor, content: Content): StoredContent {
  if (content.kind === "alert") return content;
  const adminId = requireAuthenticated(actor).userId;
  const senderId = content.senderId ?? adminId;
  if (senderId !== adminId) {
    requireNotErased(ctx, senderId);
    requirePermission(ctx, actor, "admin.members", { target: principalOf(ctx, senderId) });
  }
  // The files of a message are attached to that message, which a mass message cannot do.
  if (/\[ATTACH/i.test(content.body))
    throw new ValidationError("Attachments cannot be sent in a message to many members.", [
      { path: ["body"], message: "Remove the [ATTACH] tags." },
    ]);
  const rendered = renderContent(ctx, actor, content.body);
  return {
    kind: "message",
    senderId,
    title: content.title,
    source: rendered.source,
    html: rendered.html,
    spoilers: rendered.spoilers,
    mentionedUserIds: rendered.mentionedUserIds,
    quotes: rendered.quotes,
    locked: content.locked,
    removeFromSender: content.removeFromSender,
  };
}

/** Sending as another member needs `admin.members` over them (the administrator is always allowed as themselves). */
function requireMaySendAs(ctx: Ctx, actor: Actor, content: StoredContent): void {
  if (content.kind !== "message" || content.senderId === requireAuthenticated(actor).userId) return;
  requireNotErased(ctx, content.senderId);
  requirePermission(ctx, actor, "admin.members", { target: principalOf(ctx, content.senderId) });
}

const count = implement(contracts.broadcastsCount, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  const rule = input.audience === "everyone" ? everyone() : input.audience;
  assertRule(ctx, rule, "background");
  const content = prepareContent(ctx, actor, input.content);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    return { queued: countBroadcast(ctx, admin.userId, content, rule) };
  });
});

/** The latest run, for the checks made before the password is asked for. */
function pending(ctx: Ctx, wanted: (run: NonNullable<ReturnType<typeof latestRun>>) => boolean) {
  const run = latestRun(ctx);
  return run && wanted(run) ? run : null;
}

const send = implement(contracts.broadcastsSend, async (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  const counted = pending(ctx, (run) => run.state === "done" && run.dryRun);
  const countedAt = Date.parse(input.countedAt);
  if (counted) requireMaySendAs(ctx, actor, counted.content);
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.announcements");
    const latest = latestRun(ctx);
    // Only a finished count is sent; whose message it is matters then.
    if (latest?.state === "done" && latest.dryRun) requireMaySendAs(ctx, current, latest.content);
    return { queued: sendCounted(ctx, admin.userId, countedAt) };
  });
});

type Stoppable = NonNullable<ReturnType<typeof latestRun>>;
const isStopped = (run: Stoppable) => run.state === "stopped" || run.state === "failed";
const seenOf = (input: { runAt: string; kind: Seen["kind"] }): Seen => ({
  runAt: Date.parse(input.runAt),
  kind: input.kind,
});

/**
 * A send's resume or discard needs the password, confirmed before the transaction: one that finds
 * a send there it did not confirm for is refused (the run changed since it was read).
 */
function requireConfirmed(run: Stoppable, confirmed: boolean): void {
  if (!run.dryRun && !confirmed) throw new ConflictError(CHANGED);
}

const resume = implement(contracts.broadcastsResume, async (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  const seen = seenOf(input);
  const stopped = pending(ctx, (run) => isStopped(run) && isSeen(run, seen));
  if (stopped) requireMaySendAs(ctx, actor, stopped.content);
  const confirmed = stopped !== null && !stopped.dryRun;
  if (confirmed) await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.announcements");
    // Only the stopped run named is resumed; whose message it is matters then.
    const queued = resumeBroadcast(ctx, admin.userId, seen, (run) => {
      requireMaySendAs(ctx, current, run.content);
      requireConfirmed(run, confirmed);
    });
    return { queued };
  });
});

const discard = implement(contracts.broadcastsDiscard, async (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  const seen = seenOf(input);
  const confirmed =
    pending(ctx, (run) => isStopped(run) && isSeen(run, seen) && !run.dryRun) !== null;
  if (confirmed) await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    const discarded = discardBroadcast(ctx, admin.userId, seen, (run) =>
      requireConfirmed(run, confirmed),
    );
    return { discarded };
  });
});

const refusal = (outcome: Outcome, kind: StoredContent["kind"]): string | null =>
  outcome.sent > 0
    ? null
    : kind === "message"
      ? "The member may not receive conversations."
      : "The member turned this alert off.";

const test = implement(contracts.broadcastsTest, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  const recipientId = input.recipientId ?? admin.userId;
  const content = prepareContent(ctx, actor, input.content);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    principalOf(ctx, recipientId);
    const members = reachable(ctx, [recipientId]);
    const outcome: Outcome =
      members.length === 0
        ? { sent: 0, skipped: 1, conversationIds: new Map() }
        : content.kind === "message"
          ? deliverMessages(ctx, content, members)
          : deliverAlerts(ctx, content, members, ctx.now());
    const reason =
      members.length === 0
        ? "The account is erased, banned, unconfirmed or awaiting approval."
        : refusal(outcome, content.kind);
    logBroadcast(ctx, admin.userId, "broadcast.test", {
      kind: content.kind,
      recipientId,
      delivered: reason === null,
    });
    return {
      recipient: loadUserSummaries(ctx, [recipientId])(recipientId),
      delivered: reason === null,
      reason,
      conversationId: outcome.conversationIds.get(recipientId) ?? null,
    };
  });
});

const status = implement(contracts.broadcastsStatus, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.announcements");
  return broadcastRunValue(ctx);
});

const stop = implement(contracts.broadcastsStop, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const runAt = Date.parse(input.runAt);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    return { stopped: stopBroadcast(ctx, runAt) };
  });
});

export const operations = [count, send, resume, discard, test, status, stop];
