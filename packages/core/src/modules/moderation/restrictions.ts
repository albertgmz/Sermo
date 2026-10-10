import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { restrictionsCreate, restrictionsLift, restrictionsList } from "../../contracts/moderation";
import { RESTRICTION_PERMANENT } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requirePermission,
} from "../../permissions";
import { iso, isoOrNull } from "../../time";
import { appendModeratorLog } from "./index";

type Kind = "posting" | "conversations" | "profile_posts";
type Row = {
  id: number;
  user_id: number;
  kind: Kind;
  moderator_id: number;
  reason: string;
  created_at: number;
  expires_at: number | null;
  lifted_at: number | null;
};
const columns: Record<Kind, string> = {
  posting: "restricted_posting_until",
  conversations: "restricted_conversations_until",
  profile_posts: "restricted_profile_posts_until",
};

function target(ctx: Ctx, userId: number): Actor {
  const row = prepared(ctx, "restrictions.principal", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ),
  ).get(userId);
  if (!row) throw new NotFoundError();
  return memberActor(row.id, row.group_id, row, currentVersions(ctx));
}

function value(row: Row, now: number) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    moderatorId: row.moderator_id,
    reason: row.reason,
    createdAt: iso(row.created_at),
    expiresAt: isoOrNull(row.expires_at),
    liftedAt: isoOrNull(row.lifted_at),
    active: row.lifted_at === null && (row.expires_at === null || row.expires_at > now),
  };
}

function refresh(ctx: Ctx, userId: number, kind: Kind, now: number) {
  const active = prepared(ctx, "restrictions.active", () =>
    ctx.sqlite.prepare<{ expiry: number | null }, [number, string, number, number]>(
      "SELECT max(coalesce(expires_at, ?4)) AS expiry FROM user_restrictions WHERE user_id = ?1 AND kind = ?2 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?3)",
    ),
  ).get(userId, kind, now, RESTRICTION_PERMANENT);
  ctx.sqlite
    .prepare(`UPDATE users SET ${columns[kind]} = ?1 WHERE id = ?2`)
    .run(active?.expiry ?? null, userId);
}

export const restrictionsCreateOp = implement(restrictionsCreate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const expiry = input.expiresAt === null ? null : Date.parse(input.expiresAt);
  if (!input.reason.trim() || (expiry !== null && expiry <= ctx.now()))
    throw new ValidationError("A reason and future expiry are required.");
  return writeTx(ctx, () => {
    requirePermission(ctx, actor, "member.restrict", { target: target(ctx, input.userId) });
    const now = ctx.now();
    const row = prepared(ctx, "restrictions.insert", () =>
      ctx.sqlite.prepare<Row, [number, string, number, string, number, number | null]>(
        "INSERT INTO user_restrictions (user_id, kind, moderator_id, reason, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *",
      ),
    ).get(input.userId, input.kind, actorUserId(actor)!, input.reason, now, expiry)!;
    refresh(ctx, input.userId, input.kind, now);
    appendModeratorLog(ctx, actor, "restriction.add", "user", input.userId, input.reason, {
      restrictionId: row.id,
      kind: input.kind,
    });
    publishEvent(ctx, {
      type: "member.restricted",
      targetType: "user",
      targetId: input.userId,
      payload: {
        moderatorId: actorUserId(actor),
        reason: input.reason,
        kind: input.kind,
        lifted: false,
        expiresAt: input.expiresAt,
        notify: input.notify,
        message: input.message,
      },
    });
    return value(row, now);
  });
});

export const restrictionsLiftOp = implement(restrictionsLift, (ctx, actor, input) => {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const row = prepared(ctx, "restrictions.byId", () =>
      ctx.sqlite.prepare<Row, [number]>("SELECT * FROM user_restrictions WHERE id = ?1"),
    ).get(input.restrictionId);
    if (!row) throw new NotFoundError();
    requirePermission(ctx, actor, "member.restrict", { target: target(ctx, row.user_id) });
    if (row.lifted_at !== null) throw new ConflictError("This restriction was already lifted.");
    const now = ctx.now();
    prepared(ctx, "restrictions.lift", () =>
      ctx.sqlite.prepare("UPDATE user_restrictions SET lifted_at = ?1 WHERE id = ?2"),
    ).run(now, row.id);
    refresh(ctx, row.user_id, row.kind, now);
    appendModeratorLog(ctx, actor, "restriction.lift", "user", row.user_id, input.reason, {
      restrictionId: row.id,
    });
    publishEvent(ctx, {
      type: "member.restricted",
      targetType: "user",
      targetId: row.user_id,
      payload: {
        moderatorId: actorUserId(actor),
        reason: input.reason,
        kind: row.kind,
        lifted: true,
        notify: row.expires_at !== null && row.expires_at <= now ? false : input.notify,
        message: input.message,
      },
    });
    return value({ ...row, lifted_at: now }, now);
  });
});

export const restrictionsListOp = implement(restrictionsList, (ctx, actor, input) => {
  const viewer = requireAuthenticated(actor).userId;
  if (viewer !== input.userId && !can(ctx, actor, "warning.view")) throw new ForbiddenError();
  target(ctx, input.userId);
  const statement = prepared(ctx, "restrictions.list", () =>
    ctx.sqlite.prepare<Row, [number, string]>(
      "SELECT * FROM user_restrictions WHERE user_id = ?1 AND kind = ?2 ORDER BY id DESC",
    ),
  );
  const rows = (["posting", "conversations", "profile_posts"] as const)
    .flatMap((kind) => statement.all(input.userId, kind))
    .sort((a, b) => b.id - a.id);
  return { items: rows.map((row) => value(row, ctx.now())) };
});
