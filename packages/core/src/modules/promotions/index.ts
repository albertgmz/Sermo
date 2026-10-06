import * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import * as contracts from "../../contracts/promotions";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { type DomainEvent, publishEvent, registerEventSubscriber } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  currentVersions,
  memberActor,
  memberStanding,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requirePermission,
} from "../../permissions";
import { iso } from "../../time";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import {
  type Criterion,
  criterionDefinitions,
  criterionIds,
  eligible,
  type MemberFacts,
} from "./criteria";

type PromotionRow = {
  id: number;
  title: string;
  is_active: number;
  criteria: string;
  group_ids: string;
  created_at: number;
  updated_at: number;
};
type StateRow = { user_id: number; promotion_id: number; state: "auto" | "manual" | "exempt" };
type PromotionState = StateRow["state"] | null;
type Decision = { groups: number[]; state: PromotionState; action: "promote" | "demote" | null };
type MemberRow = MemberFacts & { id: number; group_id: number };
type LogRow = {
  id: number;
  user_id: number;
  promotion_id: number;
  action: "promote" | "demote" | "exempt" | "reset";
  actor_id: number | null;
  group_ids: string;
  created_at: number;
};
const CHUNK = 200;
const PROMOTION_SQL =
  "SELECT id, title, is_active, criteria, group_ids, created_at, updated_at FROM promotions";
const memberSql =
  "SELECT u.id, u.group_id, u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, a.email_verified, coalesce((SELECT sum(w.points) FROM warnings w WHERE w.user_id = u.id AND (w.expires_at IS NULL OR w.expires_at > ?2)), 0) AS warning_points FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1";

function all<T extends object>(
  ctx: Ctx,
  key: string,
  sql: string,
  ...args: (number | string)[]
): T[] {
  return prepared(ctx, `promotions.${key}`, () =>
    ctx.sqlite.prepare<T, (number | string)[]>(sql),
  ).all(...args);
}
function one<T extends object>(
  ctx: Ctx,
  key: string,
  sql: string,
  ...args: (number | string)[]
): T | null {
  return (
    prepared(ctx, `promotions.${key}`, () => ctx.sqlite.prepare<T, (number | string)[]>(sql)).get(
      ...args,
    ) ?? null
  );
}
function run(ctx: Ctx, key: string, sql: string, ...args: (number | string | null)[]) {
  return prepared(ctx, `promotions.${key}`, () => ctx.sqlite.prepare(sql)).run(...args);
}
function rows(ctx: Ctx): PromotionRow[] {
  return all(ctx, "all", `${PROMOTION_SQL} ORDER BY id`);
}
function evaluationRows(ctx: Ctx): PromotionRow[] {
  const pending = all<{ payload: string }>(
    ctx,
    "pendingDeletes",
    "SELECT payload FROM jobs WHERE type = 'promotions.delete' AND status IN ('pending', 'running')",
  );
  const deleting = new Set(
    pending.map((row) => (JSON.parse(row.payload) as DeleteProgress).promotionId),
  );
  return rows(ctx).filter((p) => !deleting.has(p.id));
}
function promotion(ctx: Ctx, id: number): PromotionRow {
  const row = one<PromotionRow>(ctx, "one", `${PROMOTION_SQL} WHERE id = ?1`, id);
  if (!row) throw new NotFoundError();
  return row;
}
const conditions = (row: PromotionRow) => JSON.parse(row.criteria) as Criterion[];
const groupIds = (row: PromotionRow) => JSON.parse(row.group_ids) as number[];
const promotionPlans = new WeakMap<PromotionRow, { tests: Criterion[]; ids: number[] }>();
function planFor(p: PromotionRow) {
  let plan = promotionPlans.get(p);
  if (!plan) {
    plan = { tests: conditions(p), ids: [...new Set(groupIds(p))].sort((a, b) => a - b) };
    promotionPlans.set(p, plan);
  }
  return plan;
}
const value = (row: PromotionRow) => ({
  id: row.id,
  title: row.title,
  isActive: !!row.is_active,
  criteria: conditions(row),
  groupIds: groupIds(row),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
function member(ctx: Ctx, id: number): MemberRow {
  const row = one<MemberRow>(ctx, "member", memberSql, id, ctx.now());
  if (!row) throw new NotFoundError();
  return row;
}
function target(ctx: Ctx, id: number): Actor {
  const row = one<PrincipalRow & { id: number; group_id: number }>(
    ctx,
    "target",
    `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    id,
  );
  if (!row) throw new NotFoundError();
  return memberActor(id, row.group_id, row, currentVersions(ctx));
}
function validate(ctx: Ctx, actor: Actor, tests: Criterion[], ids: number[]): void {
  for (const item of tests) {
    if (!criterionIds.has(item.criterion))
      throw new ValidationError(`Unknown criterion: ${item.criterion}`);
    if ((item.criterion === "email_verified" || item.criterion === "has_avatar") && item.value > 1)
      throw new ValidationError("Boolean criterion must be 0 or 1.");
  }
  assertGrantRanks(ctx, actor, ids);
}
function assertGrantRanks(ctx: Ctx, actor: Actor, ids: number[]): void {
  const ceiling = memberStanding(ctx, actor).maxRank;
  for (const id of ids) {
    const group = one<{ rank: number; builtin: string | null }>(
      ctx,
      "group",
      "SELECT rank, builtin FROM groups WHERE id = ?1",
      id,
    );
    if (!group) throw new NotFoundError();
    if (group.builtin === "guest" || group.rank >= ceiling) throw new ForbiddenError();
  }
}
function state(ctx: Ctx, userId: number, promotionId: number) {
  return (
    one<StateRow>(
      ctx,
      "state",
      "SELECT user_id, promotion_id, state FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2",
      userId,
      promotionId,
    )?.state ?? null
  );
}
function grants(ctx: Ctx, userId: number, promotionId: number): number[] {
  return all<{ group_id: number }>(
    ctx,
    "grants",
    "SELECT group_id FROM user_group_grants WHERE user_id = ?1 AND promotion_id = ?2 ORDER BY group_id",
    userId,
    promotionId,
  ).map((r) => r.group_id);
}
function effective(ctx: Ctx, userId: number): Set<number> {
  return new Set(
    all<{ group_id: number }>(
      ctx,
      "effective",
      "SELECT group_id FROM user_groups WHERE user_id = ?1 UNION SELECT group_id FROM user_group_grants WHERE user_id = ?1 UNION SELECT group_id FROM users WHERE id = ?1",
      userId,
    ).map((r) => r.group_id),
  );
}
function log(
  ctx: Ctx,
  userId: number,
  p: PromotionRow,
  action: LogRow["action"],
  actorId: number | null,
  ids: number[],
) {
  run(
    ctx,
    "insertLog",
    "INSERT INTO promotion_log (user_id, promotion_id, action, actor_id, group_ids, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    userId,
    p.id,
    action,
    actorId,
    JSON.stringify(ids),
    ctx.now(),
  );
}
function decide(
  m: MemberRow,
  p: PromotionRow,
  current: PromotionState,
  old: number[],
  now: number,
): Decision {
  const { ids, tests } = planFor(p);
  if (ids.length === 0) return { groups: [], state: null, action: null };
  if (current === "manual") return { groups: ids, state: "manual", action: null };
  if (current === "exempt") return { groups: [], state: "exempt", action: null };
  if (p.is_active && eligible(m, tests, now))
    return { groups: ids, state: "auto", action: "promote" };
  return { groups: [], state: null, action: old.length ? "demote" : null };
}
function differs(old: number[], current: PromotionState, result: Decision): boolean {
  return (
    current !== result.state ||
    old.length !== result.groups.length ||
    old.some((id, i) => id !== result.groups[i])
  );
}
function reconcile(
  ctx: Ctx,
  m: MemberRow,
  p: PromotionRow,
  desired: number[],
  desiredState: StateRow["state"] | null,
  action: LogRow["action"] | null,
  actorId: number | null,
  known?: { old: number[]; state: PromotionState },
): boolean {
  const old = known?.old ?? grants(ctx, m.id, p.id);
  const currentState = known ? known.state : state(ctx, m.id, p.id);
  const wanted = [...new Set(desired)].sort((a, b) => a - b);
  const changed =
    old.length !== wanted.length ||
    old.some((id, i) => id !== wanted[i]) ||
    currentState !== desiredState;
  if (!changed) return false;
  const before = effective(ctx, m.id);
  run(
    ctx,
    "deleteGrants",
    "DELETE FROM user_group_grants WHERE user_id = ?1 AND promotion_id = ?2",
    m.id,
    p.id,
  );
  for (const id of wanted)
    run(
      ctx,
      "insertGrant",
      "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, ?4)",
      m.id,
      p.id,
      id,
      ctx.now(),
    );
  if (desiredState === null)
    run(
      ctx,
      "deleteState",
      "DELETE FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2",
      m.id,
      p.id,
    );
  else
    run(
      ctx,
      "upsertState",
      "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(user_id, promotion_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      m.id,
      p.id,
      desiredState,
      ctx.now(),
    );
  if (action) log(ctx, m.id, p, action, actorId, action === "demote" ? old : wanted);
  const after = effective(ctx, m.id);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  if (added.length || removed.length)
    publishEvent(ctx, {
      type: "member.groups_changed",
      targetType: "user",
      targetId: m.id,
      payload: { added, removed, source: "promotion", promotionId: p.id },
    });
  return true;
}
function evaluate(
  ctx: Ctx,
  m: MemberRow,
  p: PromotionRow,
  known?: { old: number[]; state: PromotionState },
): boolean {
  const current = known ? known.state : state(ctx, m.id, p.id);
  const old = known?.old ?? grants(ctx, m.id, p.id);
  const result = decide(m, p, current, old, ctx.now());
  if (!differs(old, current, result)) return false;
  return reconcile(ctx, m, p, result.groups, result.state, result.action, null, {
    old,
    state: current,
  });
}
export function evaluateMember(ctx: Ctx, userId: number): number {
  return writeTx(ctx, () => {
    const m = one<MemberRow>(ctx, "member", memberSql, userId, ctx.now());
    if (!m) return 0;
    const states = all<StateRow>(
      ctx,
      "memberStates",
      "SELECT user_id, promotion_id, state FROM user_promotions WHERE user_id = ?1",
      userId,
    );
    const stateMap = new Map(states.map((s) => [s.promotion_id, s.state]));
    const grantRows = all<{ promotion_id: number; group_id: number }>(
      ctx,
      "memberGrants",
      "SELECT promotion_id, group_id FROM user_group_grants WHERE user_id = ?1 ORDER BY promotion_id, group_id",
      userId,
    );
    const grantMap = new Map<number, number[]>();
    for (const row of grantRows) {
      const list = grantMap.get(row.promotion_id) ?? [];
      list.push(row.group_id);
      grantMap.set(row.promotion_id, list);
    }
    let changes = 0;
    for (const p of evaluationRows(ctx)) {
      const current = stateMap.get(p.id) ?? null;
      const old = grantMap.get(p.id) ?? [];
      if (evaluate(ctx, m, p, { old, state: current })) changes++;
    }
    return changes;
  });
}
function status(ctx: Ctx, m: MemberRow, p: PromotionRow) {
  return {
    promotionId: p.id,
    title: p.title,
    state: state(ctx, m.id, p.id),
    eligible: eligible(m, conditions(p), ctx.now()),
    grantedGroupIds: grants(ctx, m.id, p.id),
  };
}

export const operations = [
  implement(contracts.promotionsCriteria, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.promotions");
    return { items: criterionDefinitions };
  }),
  implement(contracts.promotionsList, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.promotions");
    return { items: rows(ctx).map(value) };
  }),
  implement(contracts.promotionsGet, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    return value(promotion(ctx, input.promotionId));
  }),
  implement(contracts.promotionsCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    return writeTx(ctx, () => {
      validate(ctx, actor, input.criteria, input.groupIds);
      const now = ctx.now();
      const id = Number(
        run(
          ctx,
          "create",
          "INSERT INTO promotions (title, is_active, criteria, group_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
          input.title,
          Number(input.isActive),
          JSON.stringify(input.criteria),
          JSON.stringify([...new Set(input.groupIds)]),
          now,
        ).lastInsertRowid,
      );
      return value(promotion(ctx, id));
    });
  }),
  implement(contracts.promotionsUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    return writeTx(ctx, () => {
      const p = promotion(ctx, input.promotionId);
      const tests = input.criteria ?? conditions(p);
      const ids = input.groupIds ?? groupIds(p);
      validate(ctx, actor, tests, ids);
      run(
        ctx,
        "update",
        "UPDATE promotions SET title = ?1, is_active = ?2, criteria = ?3, group_ids = ?4, updated_at = ?5 WHERE id = ?6",
        input.title ?? p.title,
        Number(input.isActive ?? !!p.is_active),
        JSON.stringify(tests),
        JSON.stringify([...new Set(ids)]),
        ctx.now(),
        p.id,
      );
      return value(promotion(ctx, p.id));
    });
  }),
  implement(contracts.promotionsDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    return writeTx(ctx, () => {
      const p = promotion(ctx, input.promotionId);
      assertGrantRanks(ctx, actor, groupIds(p));
      run(
        ctx,
        "markDeleting",
        "UPDATE promotions SET is_active = 0, group_ids = '[]', updated_at = ?1 WHERE id = ?2",
        ctx.now(),
        p.id,
      );
      enqueueJob(
        ctx,
        "promotions.delete",
        { promotionId: p.id, after: 0, actorId: actor.kind === "guest" ? null : actor.userId },
        { uniqueKey: `promotions.delete.${p.id}` },
      );
      return { ok: true };
    });
  }),
  implement(contracts.promotionsMemberStatus, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    const m = member(ctx, input.userId);
    return { items: rows(ctx).map((p) => status(ctx, m, p)) };
  }),
  implement(contracts.promotionsApply, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    const user = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      const m = member(ctx, input.userId);
      requirePermission(ctx, actor, "admin.members", { target: target(ctx, m.id) });
      const p = promotion(ctx, input.promotionId);
      if (groupIds(p).length === 0) {
        reconcile(ctx, m, p, [], null, null, null);
        return status(ctx, m, p);
      }
      if (input.action === "reset") {
        const old = grants(ctx, m.id, p.id);
        const current = state(ctx, m.id, p.id);
        const result = decide(m, p, null, [], ctx.now());
        reconcile(ctx, m, p, result.groups, result.state, null, null, {
          old,
          state: current,
        });
        log(ctx, m.id, p, "reset", user.userId, result.groups);
        const grantsChanged =
          old.length !== result.groups.length || old.some((id, i) => id !== result.groups[i]);
        if (grantsChanged && groupIds(p).length > 0)
          log(
            ctx,
            m.id,
            p,
            result.groups.length ? "promote" : "demote",
            null,
            result.groups.length ? result.groups : old,
          );
      } else {
        if (input.action === "promote") assertGrantRanks(ctx, actor, groupIds(p));
        const desired = input.action === "promote" ? groupIds(p) : [];
        if (
          !reconcile(
            ctx,
            m,
            p,
            desired,
            input.action === "promote" ? "manual" : "exempt",
            input.action,
            user.userId,
          )
        )
          log(ctx, m.id, p, input.action, user.userId, desired);
      }
      return status(ctx, m, p);
    });
  }),
  implement(contracts.promotionsLog, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.promotions");
    const cursor = input.cursor
      ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
      : Number.MAX_SAFE_INTEGER;
    const sql =
      input.userId === undefined
        ? "SELECT * FROM promotion_log WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
        : "SELECT * FROM promotion_log WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3";
    const records =
      input.userId === undefined
        ? all<LogRow>(ctx, "logRecent", sql, cursor, input.limit + 1)
        : all<LogRow>(ctx, "logUser", sql, input.userId, cursor, input.limit + 1);
    const page = records.slice(0, input.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        userId: r.user_id,
        promotionId: r.promotion_id,
        action: r.action,
        actorId: r.actor_id,
        groupIds: JSON.parse(r.group_ids) as number[],
        createdAt: iso(r.created_at),
      })),
      nextCursor: records.length > input.limit ? encodeCursor([page.at(-1)!.id]) : null,
    };
  }),
  implement(contracts.promotionsRun, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.promotions");
    return {
      queued:
        enqueueJob(ctx, "promotions.sweep", { after: 0 }, { uniqueKey: "promotions.sweep" }) !==
        null,
    };
  }),
];

export function sweepChunk(ctx: Ctx, after = 0): number {
  return writeTx(ctx, () => {
    const members = all<MemberRow>(
      ctx,
      "sweepPage",
      "SELECT u.id, u.group_id, u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, a.email_verified, 0 AS warning_points FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id > ?1 ORDER BY u.id LIMIT ?2",
      after,
      CHUNK,
    );
    const ids = JSON.stringify(members.map((m) => m.id));
    const warnings = all<{ user_id: number; points: number }>(
      ctx,
      "sweepWarnings",
      "SELECT user_id, sum(points) AS points FROM warnings WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2) GROUP BY user_id",
      ids,
      ctx.now(),
    );
    const points = new Map(warnings.map((w) => [w.user_id, w.points]));
    const states = all<StateRow>(
      ctx,
      "sweepStates",
      "SELECT user_id, promotion_id, state FROM user_promotions WHERE user_id IN (SELECT value FROM json_each(?1))",
      ids,
    );
    const stateMap = new Map(states.map((s) => [`${s.user_id}:${s.promotion_id}`, s.state]));
    const grantRows = all<{ user_id: number; promotion_id: number; group_id: number }>(
      ctx,
      "sweepGrants",
      "SELECT user_id, promotion_id, group_id FROM user_group_grants WHERE user_id IN (SELECT value FROM json_each(?1)) ORDER BY user_id, promotion_id, group_id",
      ids,
    );
    const grantMap = new Map<string, number[]>();
    for (const grant of grantRows) {
      const key = `${grant.user_id}:${grant.promotion_id}`;
      const list = grantMap.get(key) ?? [];
      list.push(grant.group_id);
      grantMap.set(key, list);
    }
    const handGroups = all<{ user_id: number; group_id: number }>(
      ctx,
      "sweepHandGroups",
      "SELECT user_id, group_id FROM user_groups WHERE user_id IN (SELECT value FROM json_each(?1))",
      ids,
    );
    const membership = new Map<number, Map<number, number>>();
    const countGroup = (userId: number, groupId: number, delta: number) => {
      const counts = membership.get(userId) ?? new Map<number, number>();
      counts.set(groupId, (counts.get(groupId) ?? 0) + delta);
      membership.set(userId, counts);
    };
    for (const m of members) countGroup(m.id, m.group_id, 1);
    for (const row of handGroups) countGroup(row.user_id, row.group_id, 1);
    for (const row of grantRows) countGroup(row.user_id, row.group_id, 1);
    const active = evaluationRows(ctx);
    const now = ctx.now();
    for (const m of members) {
      m.warning_points = points.get(m.id) ?? 0;
      for (const p of active) {
        const key = `${m.id}:${p.id}`;
        const oldState = stateMap.get(key) ?? null;
        const old = grantMap.get(key) ?? [];
        const result = decide(m, p, oldState, old, now);
        if (!differs(old, oldState, result)) continue;
        const desired = result.groups;
        const nextState = result.state;
        run(
          ctx,
          "deleteGrants",
          "DELETE FROM user_group_grants WHERE user_id = ?1 AND promotion_id = ?2",
          m.id,
          p.id,
        );
        for (const id of desired)
          run(
            ctx,
            "insertGrant",
            "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            m.id,
            p.id,
            id,
            now,
          );
        if (nextState === null)
          run(
            ctx,
            "deleteState",
            "DELETE FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2",
            m.id,
            p.id,
          );
        else
          run(
            ctx,
            "upsertState",
            "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(user_id, promotion_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
            m.id,
            p.id,
            nextState,
            now,
          );
        if (result.action)
          log(ctx, m.id, p, result.action, null, result.action === "demote" ? old : desired);
        const counts = membership.get(m.id)!;
        const added: number[] = [];
        const removed: number[] = [];
        for (const id of old) {
          const before = counts.get(id)!;
          countGroup(m.id, id, -1);
          if (before === 1) removed.push(id);
        }
        for (const id of desired) {
          const before = counts.get(id) ?? 0;
          countGroup(m.id, id, 1);
          if (before === 0) added.push(id);
        }
        const netAdded = added.filter((id) => !removed.includes(id));
        const netRemoved = removed.filter((id) => !added.includes(id));
        if (netAdded.length || netRemoved.length)
          publishEvent(ctx, {
            type: "member.groups_changed",
            targetType: "user",
            targetId: m.id,
            payload: {
              added: netAdded,
              removed: netRemoved,
              source: "promotion",
              promotionId: p.id,
            },
          });
        if (nextState === null) stateMap.delete(key);
        else stateMap.set(key, nextState);
        grantMap.set(key, desired);
      }
    }
    if (members.length === CHUNK) {
      run(
        ctx,
        "releaseSweepKey",
        "UPDATE jobs SET unique_key = NULL WHERE unique_key = 'promotions.sweep' AND status = 'running'",
      );
      enqueueJob(
        ctx,
        "promotions.sweep",
        { after: members.at(-1)!.id },
        { uniqueKey: "promotions.sweep" },
      );
    }
    return members.length;
  });
}
type DeleteProgress = { promotionId: number; after: number; actorId: number | null };
export function deletePromotionChunk(ctx: Ctx, progress: DeleteProgress): number {
  if (
    !Number.isSafeInteger(progress.promotionId) ||
    progress.promotionId < 1 ||
    !Number.isSafeInteger(progress.after) ||
    progress.after < 0
  )
    throw new TypeError("Invalid promotion deletion progress.");
  return writeTx(ctx, () => {
    const p = one<PromotionRow>(
      ctx,
      "deleteTarget",
      `${PROMOTION_SQL} WHERE id = ?1`,
      progress.promotionId,
    );
    if (!p) return 0;
    const batch = all<{ user_id: number }>(
      ctx,
      "deletePage",
      "SELECT user_id FROM user_promotions WHERE promotion_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      p.id,
      progress.after,
      CHUNK,
    );
    for (const { user_id } of batch) {
      const m = one<MemberRow>(ctx, "member", memberSql, user_id, ctx.now());
      if (!m) continue;
      const old = grants(ctx, user_id, p.id);
      const current = state(ctx, user_id, p.id);
      reconcile(ctx, m, p, [], null, old.length ? "demote" : null, progress.actorId, {
        old,
        state: current,
      });
    }
    if (batch.length < CHUNK)
      run(ctx, "deletePromotion", "DELETE FROM promotions WHERE id = ?1", p.id);
    else {
      run(
        ctx,
        "releaseDeleteKey",
        "UPDATE jobs SET unique_key = NULL WHERE unique_key = ?1 AND status = 'running'",
        `promotions.delete.${p.id}`,
      );
      enqueueJob(
        ctx,
        "promotions.delete",
        { ...progress, after: batch.at(-1)!.user_id },
        { uniqueKey: `promotions.delete.${p.id}` },
      );
    }
    return batch.length;
  });
}
function onEvent(ctx: Ctx, event: DomainEvent): void {
  let userId: number | null = null;
  if (
    event.type === "content.created" &&
    ["post", "thread", "profile_post", "profile_post_comment"].includes(event.targetType)
  ) {
    const table = {
      post: "posts",
      thread: "threads",
      profile_post: "profile_posts",
      profile_post_comment: "profile_post_comments",
    }[event.targetType]!;
    userId =
      one<{ user_id: number }>(
        ctx,
        `eventAuthor.${table}`,
        `SELECT user_id FROM ${table} WHERE id = ?1`,
        event.targetId,
      )?.user_id ?? null;
  }
  if (event.type === "reaction.added") userId = Number(event.payload.contentUserId) || null;
  if (event.type === "member.warned") userId = event.targetId;
  if (event.type === "content.edited" && event.targetType === "profile") userId = event.targetId;
  if (event.type === "member.groups_changed" && event.payload.source === "admin")
    userId = event.targetId;
  if (userId !== null) evaluateMember(ctx, userId);
}
export function registerPromotionJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "promotions.sweep", (context, payload) => {
    sweepChunk(context, (payload as { after: number }).after);
  });
  registerEventSubscriber(ctx, "promotions", (event) => onEvent(ctx, event));
  registerJobHandler(ctx, "promotions.delete", (context, payload) => {
    deletePromotionChunk(context, payload as DeleteProgress);
  });
}
