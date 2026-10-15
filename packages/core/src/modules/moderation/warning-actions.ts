import type { SQLQueryBindings } from "bun:sqlite";
import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { RestrictionKind, WarningActionKind } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { publishEvent } from "../../events";
import { can, groupDecidesAdministration } from "../../permissions";
import { enqueueJob, registerJobHandler } from "../jobs";
import { appendModeratorLog, insertAuthorizedBan, principalMember } from "./index";
import type { Notice } from "./notify";
import { insertAuthorizedRestriction } from "./restrictions";

const DAY_MS = 86_400_000;
/** Fires one transaction settles at most (the sweep, an action being deleted). */
export const WARNING_BATCH = 100;
/** Warnings one transaction lets go of their type at most, when a type is deleted. */
export const TYPE_BATCH = 1000;

type ActionRow = {
  id: number;
  threshold: number;
  kind: WarningActionKind;
  days: number | null;
  group_id: number | null;
  restriction_kind: RestrictionKind | null;
};
type FireRow = {
  id: number;
  user_id: number;
  action_id: number;
  group_id: number | null;
  group_added_at: number | null;
  notify: number;
};

/** The statements of a warning's write, kept as text for the plan tests. */
export const warningSql = {
  activePoints:
    "SELECT coalesce(sum(points), 0) AS n FROM warnings WHERE user_id = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
  due: "SELECT a.id, a.threshold, a.kind, a.days, a.group_id, a.restriction_kind FROM warning_actions a WHERE a.threshold <= ?1 AND a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM warning_action_fires f WHERE f.user_id = ?2 AND f.action_id = a.id) ORDER BY a.threshold, a.id",
  below:
    "SELECT f.id, f.user_id, f.action_id, f.group_id, f.group_added_at, f.notify FROM warning_action_fires f JOIN warning_actions a ON a.id = f.action_id WHERE f.user_id = ?1 AND a.threshold > ?2",
  ended:
    "SELECT id, user_id, action_id, group_id, group_added_at, notify FROM warning_action_fires WHERE group_ends_at <= ?1 LIMIT ?2",
  // The sweep reads every fire (see sweepWarningActions) and seeks warnings_user_expiry for each.
  sweepBelow:
    "SELECT f.id, f.user_id, f.action_id, f.group_id, f.group_added_at, f.notify FROM warning_action_fires f JOIN warning_actions a ON a.id = f.action_id WHERE a.threshold > (SELECT coalesce(sum(w.points), 0) FROM warnings w WHERE w.user_id = f.user_id AND (w.expires_at IS NULL OR w.expires_at > ?1)) LIMIT ?2",
  // Fires of a deleted action that still hold a membership to take back.
  byAction:
    "SELECT id, user_id, action_id, group_id, group_added_at, notify FROM warning_action_fires WHERE action_id = ?1 AND group_added_at IS NOT NULL LIMIT ?2",
};

function statement<T>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `moderation.warningActions.${key}`, () =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql),
  );
}

/** Points of a member's warnings that have not expired. */
export function activeWarningPoints(ctx: Ctx, userId: number, now: number): number {
  return statement<{ n: number }>(ctx, "activePoints", warningSql.activePoints).get(userId, now)!.n;
}

/**
 * Takes back the group membership a fire added, when it added one it may lift: the
 * `user_groups` row it created, unless another fire added the same row too (the last one to
 * go removes it). A membership the member already had, or that a permanent action or a hand edit
 * made, is never touched.
 */
function removeAddedGroup(ctx: Ctx, fire: FireRow): void {
  if (fire.group_id === null || fire.group_added_at === null) return;
  const shared = statement<{ id: number }>(
    ctx,
    "sharedGroup",
    "SELECT id FROM warning_action_fires WHERE user_id = ?1 AND group_id = ?2 AND group_added_at = ?3 AND id <> ?4 LIMIT 1",
  ).get(fire.user_id, fire.group_id, fire.group_added_at, fire.id);
  if (shared) return;
  const removed = statement(
    ctx,
    "removeGroup",
    "DELETE FROM user_groups WHERE user_id = ?1 AND group_id = ?2 AND created_at = ?3",
  ).run(fire.user_id, fire.group_id, fire.group_added_at);
  // A group the member holds another way (made primary since) is not one they lost.
  if (removed.changes > 0 && !heldElsewhere(ctx, fire.user_id, fire.group_id))
    publishEvent(ctx, {
      type: "member.groups_changed",
      targetType: "user",
      targetId: fire.user_id,
      // No member acts here: the payload names the action, and a warning given silently
      // (notify false) takes the group back silently too.
      payload: {
        added: [],
        removed: [fire.group_id],
        source: "admin",
        actorId: null,
        reason: "warning_action",
        actionId: fire.action_id,
        notify: fire.notify !== 0,
      },
    });
}

/** The action stops being in effect: its timed group goes, the fire is forgotten (re-armed). */
function liftFire(ctx: Ctx, fire: FireRow): void {
  statement(ctx, "deleteFire", "DELETE FROM warning_action_fires WHERE id = ?1").run(fire.id);
  removeAddedGroup(ctx, fire);
}

/**
 * Lifts what a member's actions added when their points no longer reach the threshold, so the
 * next crossing fires again: timed group memberships end and the fires are forgotten. Bans and
 * restrictions are not lifted (they end on their own date), nor are permanent memberships.
 * Inside the caller's write transaction. Call it after anything that lowers a member's active
 * points (a warning deleted); a warning expiring is noticed by the sweep job and by the next
 * warning.
 */
export function reconcileWarningActions(ctx: Ctx, userId: number, now: number): void {
  const fires = statement<FireRow>(ctx, "fireBelow", warningSql.below).all(
    userId,
    activeWarningPoints(ctx, userId, now),
  );
  for (const fire of fires) liftFire(ctx, fire);
}

/** Whether the member belongs to the group through a source other than `user_groups`. */
function heldElsewhere(ctx: Ctx, userId: number, groupId: number): boolean {
  return !!statement<{ held: number }>(
    ctx,
    "heldElsewhere",
    "SELECT (EXISTS (SELECT 1 FROM users WHERE id = ?1 AND group_id = ?2) OR EXISTS (SELECT 1 FROM user_group_grants WHERE user_id = ?1 AND group_id = ?2) OR EXISTS (SELECT 1 FROM shop_group_grants WHERE user_id = ?1 AND group_id = ?2)) AS held",
  ).get(userId, groupId)!.held;
}

/**
 * Adds the member to the action's group. Returns the `created_at` of the `user_groups` row the
 * fire may lift later (null when the action is permanent, or added nothing of its own).
 */
function addGroup(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  action: ActionRow,
  now: number,
  details: Record<string, unknown>,
  notify: boolean,
): number | null {
  const groupId = action.group_id!;
  // Administration is never given or taken by an action no one can refuse.
  if (groupDecidesAdministration(ctx, groupId))
    throw new ConflictError("A warning action adds a group that decides administration.");
  const timed = action.days !== null;
  const own = statement<{ created_at: number }>(
    ctx,
    "ownGroup",
    "SELECT created_at FROM user_groups WHERE user_id = ?1 AND group_id = ?2",
  ).get(userId, groupId);
  if (own) {
    const shared = statement<{ id: number }>(
      ctx,
      "ownShared",
      "SELECT id FROM warning_action_fires WHERE user_id = ?1 AND group_id = ?2 AND group_added_at = ?3 LIMIT 1",
    ).get(userId, groupId, own.created_at);
    // A permanent action takes over the membership other actions would have lifted.
    if (!timed)
      statement(
        ctx,
        "adopt",
        "UPDATE warning_action_fires SET group_added_at = NULL, group_ends_at = NULL WHERE user_id = ?1 AND group_id = ?2 AND group_added_at = ?3",
      ).run(userId, groupId, own.created_at);
    return timed && shared ? own.created_at : null;
  }
  if (heldElsewhere(ctx, userId, groupId)) return null;
  statement(
    ctx,
    "insertGroup",
    "INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, ?3)",
  ).run(userId, groupId, now);
  appendModeratorLog(ctx, actor, "user.groups", "user", userId, "", {
    ...details,
    added: [groupId],
  });
  publishEvent(ctx, {
    type: "member.groups_changed",
    targetType: "user",
    targetId: userId,
    payload: {
      added: [groupId],
      removed: [],
      source: "admin",
      actorId: actorUserId(actor),
      reason: "warning_action",
      actionId: action.id,
      notify,
    },
  });
  return timed ? now : null;
}

/**
 * Applies, once, every action whose threshold the member's active points have reached and that
 * is not already in effect for them. Inside the write transaction of the warning, after
 * `reconcileWarningActions` (so a crossing counts only when the points had fallen below it).
 * A member who holds `member.immuneToAutoBan` is skipped. An action that cannot be applied
 * (a ban on the last administrator) throws and the warning with it.
 */
export function applyWarningActions(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  activePoints: number,
  warningId: number,
  notice: Pick<Notice, "notify" | "message">,
): void {
  const due = statement<ActionRow>(ctx, "due", warningSql.due).all(activePoints, userId);
  if (due.length === 0) return;
  const now = ctx.now();
  const target = principalMember(ctx, userId);
  const immune = can(ctx, target, "member.immuneToAutoBan");
  for (const action of due) {
    const reason = `Warning threshold: ${activePoints} points`;
    const expiry = action.days === null ? null : now + action.days * DAY_MS;
    const details = { warningId, actionId: action.id, activePoints };
    let addedAt: number | null = null;
    if (!immune) {
      if (action.kind === "ban")
        insertAuthorizedBan(ctx, actor, userId, reason, expiry, notice, "ban.threshold", details);
      else if (action.kind === "restriction")
        insertAuthorizedRestriction(
          ctx,
          actor,
          userId,
          action.restriction_kind!,
          reason,
          expiry,
          notice,
          details,
        );
      else addedAt = addGroup(ctx, actor, userId, action, now, details, notice.notify);
    }
    statement(
      ctx,
      "insertFire",
      "INSERT INTO warning_action_fires (user_id, action_id, fired_at, group_id, group_added_at, group_ends_at, notify) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ).run(
      userId,
      action.id,
      now,
      action.kind === "group" ? action.group_id : null,
      addedAt,
      addedAt === null ? null : expiry,
      Number(notice.notify),
    );
  }
}

/**
 * One bounded transaction of the sweep: timed groups that reached their end go (the action
 * stays in effect, so it does not fire again), and actions whose member's points fell below the
 * threshold are lifted. Returns how many it settled.
 */
export function sweepWarningActions(ctx: Ctx): number {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const ended = statement<FireRow>(ctx, "ended", warningSql.ended).all(now, WARNING_BATCH);
    for (const fire of ended) {
      statement(
        ctx,
        "endGroup",
        "UPDATE warning_action_fires SET group_added_at = NULL, group_ends_at = NULL WHERE id = ?1",
      ).run(fire.id);
      removeAddedGroup(ctx, fire);
    }
    // Every fire is looked at, one seek into warnings each. A fire stays while its member's
    // points stay over the threshold, so the table grows with the members who ever crossed one
    // and whose warnings do not expire; the plan test keeps the seek on the index.
    const below = statement<FireRow>(ctx, "below", warningSql.sweepBelow).all(now, WARNING_BATCH);
    for (const fire of below) liftFire(ctx, fire);
    return ended.length + below.length;
  });
}

export type DeletionTarget = { kind: "action" | "type"; id: number };

/** Queues the cleanup that follows the deletion of an action or a type. Inside a write transaction. */
export function cleanupJob(ctx: Ctx, kind: DeletionTarget["kind"], id: number): void {
  enqueueJob(ctx, "moderation.warningCleanup", { kind, id } satisfies DeletionTarget, {
    uniqueKey: `moderation.warningCleanup.${kind}.${id}`,
  });
}

/**
 * One bounded transaction of the cleanup after a deletion began. An action takes back the group
 * memberships of up to `limit` fires (each publishes an event); a type lets up to `limit`
 * warnings go. The row itself goes with the first step that finds less than a full batch, so an
 * exact multiple takes one empty step more. All state is in the rows, so a stopped run resumes
 * from the next one.
 */
export function settleDeletion(
  ctx: Ctx,
  target: DeletionTarget,
  limit = target.kind === "action" ? WARNING_BATCH : TYPE_BATCH,
): { settled: number; done: boolean } {
  return writeTx(ctx, () => {
    let settled: number;
    if (target.kind === "action") {
      const fires = statement<FireRow>(ctx, "fireByAction", warningSql.byAction).all(
        target.id,
        limit,
      );
      for (const fire of fires) liftFire(ctx, fire);
      settled = fires.length;
    } else {
      settled = statement(
        ctx,
        "typeForget",
        "UPDATE warnings SET type_id = NULL WHERE id IN (SELECT id FROM warnings WHERE type_id = ?1 LIMIT ?2)",
      ).run(target.id, limit).changes;
    }
    if (settled === limit) return { settled, done: false };
    // The action's fires without a membership go with its row, in one cascade.
    statement(
      ctx,
      target.kind === "action" ? "actionRemove" : "typeRemove",
      target.kind === "action"
        ? "DELETE FROM warning_actions WHERE id = ?1 AND deleted_at IS NOT NULL"
        : "DELETE FROM warning_types WHERE id = ?1 AND deleted_at IS NOT NULL",
    ).run(target.id);
    return { settled, done: true };
  });
}

export function registerWarningJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "moderation.warningCleanup", async (_ctx, payload) => {
    const target = payload as Partial<DeletionTarget>;
    if ((target.kind !== "action" && target.kind !== "type") || !Number.isSafeInteger(target.id))
      throw new Error("Invalid warning cleanup job.");
    while (!settleDeletion(ctx, target as DeletionTarget).done)
      await new Promise<void>((resolve) => setImmediate(resolve));
  });
  registerJobHandler(ctx, "moderation.warningSweep", async () => {
    while (sweepWarningActions(ctx) > 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  });
}
