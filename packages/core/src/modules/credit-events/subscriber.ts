import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import type { DomainEvent } from "../../events";
import { moveCredits } from "../../shared/credits";
import { query, type RuleRow, type Trigger } from "./storage";

interface Content {
  user_id: number;
  state: string;
  created_at: number;
  node_id?: number;
  position?: number;
  recipient_id?: number;
  parent_state?: string;
}
interface Source {
  type: string;
  id: number;
  otherUserId?: number;
  nodeId?: number;
}

function content(ctx: Ctx, type: string, id: number): Content | null {
  switch (type) {
    case "thread":
    case "post":
    case "profile_post":
    case "profile_post_comment":
    case "conversation_message":
      return query<Content>(ctx, type).get(id);
    default:
      return null;
  }
}

function apply(
  ctx: Ctx,
  event: DomainEvent,
  trigger: Trigger,
  userId: number,
  source: Source,
): void {
  for (const rule of query<RuleRow>(ctx, "active").all(trigger, event.createdAt)) {
    const nodes = JSON.parse(rule.node_ids) as number[];
    if (nodes.length && (source.nodeId === undefined || !nodes.includes(source.nodeId))) continue;
    if (rule.limit_count !== null) {
      const cutoff = ctx.now() - rule.limit_window_hours! * 3_600_000;
      if (
        query<{ count: number }>(ctx, "limit").get(rule.id, userId, cutoff)!.count >=
        rule.limit_count
      )
        continue;
    }
    const inserted = query<{ id: number }>(ctx, "apply").get(
      rule.id,
      userId,
      source.type,
      source.id,
      source.otherUserId ?? 0,
      rule.amount,
      event.id,
      ctx.now(),
    );
    if (inserted)
      moveCredits(ctx, [
        {
          userId,
          amount: rule.amount,
          type: "event",
          source: { type: "credit_rule", id: rule.id },
          reason: rule.title,
        },
      ]);
  }
}

function reconcile(ctx: Ctx, event: DomainEvent, source: Source, visible: boolean): void {
  const rows = query<{ rule_id: number; user_id: number; amount: number }>(ctx, "flip").all(
    visible ? "applied" : "reverted",
    event.id,
    source.type,
    source.id,
    visible ? "reverted" : "applied",
  );
  if (rows.length)
    moveCredits(
      ctx,
      rows.map((row) => ({
        userId: row.user_id,
        amount: visible ? row.amount : -row.amount,
        type: visible ? "event" : "event_reversal",
        source: { type: "credit_rule", id: row.rule_id },
      })),
    );
}

function creation(ctx: Ctx, event: DomainEvent, row: Content): void {
  const source = { type: event.targetType, id: event.targetId, nodeId: row.node_id };
  if (event.targetType === "thread") apply(ctx, event, "thread_created", row.user_id, source);
  if (event.targetType === "post" && row.position! > 0) {
    apply(ctx, event, "reply_posted", row.user_id, source);
    if (row.user_id !== row.recipient_id)
      apply(ctx, event, "reply_received", row.recipient_id!, {
        ...source,
        otherUserId: row.user_id,
      });
  }
  if (event.targetType === "profile_post" && row.user_id !== row.recipient_id) {
    apply(ctx, event, "profile_post_created", row.user_id, source);
    apply(ctx, event, "profile_post_received", row.recipient_id!, {
      ...source,
      otherUserId: row.user_id,
    });
  }
}

/** One event, including every application and ledger movement, commits atomically. */
export function handleCreditRuleEvent(ctx: Ctx, event: DomainEvent): void {
  if (
    ![
      "content.created",
      "content.deleted",
      "content.state_changed",
      "reaction.added",
      "member.followed",
      "member.registered",
      "member.active_day",
      "member.warned",
      "award.granted",
      "award.revoked",
    ].includes(event.type)
  )
    return;
  writeTx(ctx, () => {
    if (event.type.startsWith("content.") || event.type === "reaction.added") {
      const row = content(ctx, event.targetType, event.targetId);
      if (!row) return;
      const visible =
        row.state === "visible" &&
        (row.parent_state === undefined || row.parent_state === "visible");
      const source = { type: event.targetType, id: event.targetId };
      if (event.type === "reaction.added") {
        if (!visible) return;
        const userId = Number(event.payload.userId);
        const recipientId = Number(event.payload.contentUserId);
        const nodeId = event.targetType === "post" ? row.node_id : undefined;
        apply(ctx, event, "reaction_given", userId, { ...source, nodeId });
        apply(ctx, event, "reaction_received", recipientId, {
          ...source,
          nodeId,
          otherUserId: userId,
        });
      } else {
        reconcile(ctx, event, source, visible);
        if (visible) creation(ctx, event, row);
      }
      return;
    }
    if (event.type === "award.granted" || event.type === "award.revoked") {
      const id = Number(event.payload.memberAwardId);
      const grant = query<{ user_id: number; revoked_at: number | null }>(ctx, "award").get(id);
      if (!grant) return;
      const source = { type: "member_award", id };
      if (grant.revoked_at !== null) reconcile(ctx, event, source, false);
      else if (event.type === "award.granted")
        apply(ctx, event, "award_received", grant.user_id, source);
      return;
    }
    switch (event.type) {
      case "member.followed":
        apply(ctx, event, "followed", event.targetId, {
          type: "user",
          id: Number(event.payload.followerId),
        });
        break;
      case "member.registered":
        apply(ctx, event, "registered", event.targetId, { type: "user", id: event.targetId });
        break;
      case "member.active_day":
        apply(ctx, event, "daily_activity", event.targetId, {
          type: "day",
          id: Number(event.payload.day),
        });
        break;
      case "member.warned":
        if (!event.payload.lifted)
          apply(ctx, event, "warning_received", event.targetId, {
            type: "warning",
            id: Number(event.payload.warningId),
          });
        break;
    }
  });
}
