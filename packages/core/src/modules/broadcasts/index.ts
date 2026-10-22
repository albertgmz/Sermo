import type { z } from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import * as contracts from "../../contracts/broadcasts";
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
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
import { assertRule } from "../../shared/criteria";
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
import { broadcastRunValue, logBroadcast, startBroadcast, stopBroadcast } from "./run";

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

const start = implement(contracts.broadcastsStart, async (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const admin = requireAuthenticated(actor);
  if ((input.content === undefined) !== (input.rule === undefined))
    throw new ValidationError("Give both the content and the audience, or neither to resume.");
  if (input.rule) assertRule(ctx, input.rule, "background");
  const content = input.content && prepareContent(ctx, actor, input.content);
  if (!input.dryRun) await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    return {
      queued: startBroadcast(ctx, admin.userId, content, input.rule, input.dryRun),
    };
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

const stop = implement(contracts.broadcastsStop, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.announcements");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.announcements");
    return { stopped: stopBroadcast(ctx) };
  });
});

export const operations = [start, test, status, stop];
