import * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import * as contracts from "../../contracts/awards";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, requirePermission } from "../../permissions";
import { type Criterion, criterionDefinitions, criterionIds } from "../../shared/criteria";
import { iso } from "../../time";
import { enqueueJob } from "../jobs/queue";
import { mayViewProfile, profileAccess } from "../profiles/shared";
import { grantAward, revokeAward } from "./grants";
import {
  type AwardRow,
  all,
  awardRow,
  awardSql,
  awardValue,
  compareAwards,
  conditions,
  type GrantRow,
  grantValues,
  loadAwards,
  memberXp,
  one,
  run,
  type TotalRow,
} from "./store";

export { registerAwardJobs } from "./automatic";

function visibleAward(ctx: Ctx, actor: Actor, id: number): AwardRow {
  requirePermission(ctx, actor, "profile.view");
  const row = awardRow(ctx, id);
  if (!row.is_active && !can(ctx, actor, "admin.awards")) throw new NotFoundError();
  return row;
}
function visibleMember(ctx: Ctx, actor: Actor, id: number): void {
  requirePermission(ctx, actor, "profile.view", {}, { notFound: true });
  const access = profileAccess(ctx, actor, id);
  if (!mayViewProfile(ctx, actor, id, access)) throw new NotFoundError();
}
function validate(tests: Criterion[]): void {
  for (const item of tests) {
    if (!criterionIds.has(item.criterion))
      throw new ValidationError(`Unknown criterion: ${item.criterion}`);
    if ((item.criterion === "email_verified" || item.criterion === "has_avatar") && item.value > 1)
      throw new ValidationError("Boolean criterion must be 0 or 1.");
  }
}
function grantsPage(
  ctx: Ctx,
  kind: "holders" | "grants",
  id: number,
  input: { cursor?: string; limit: number },
) {
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const rows = all<GrantRow>(ctx, kind, awardSql[kind], id, cursor, input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    items: grantValues(ctx, page),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.id]) : null,
  };
}

export const operations = [
  implement(contracts.awardsList, (ctx, actor) => {
    requirePermission(ctx, actor, "profile.view");
    const admin = can(ctx, actor, "admin.awards");
    return {
      items: all<AwardRow>(ctx, "catalog", awardSql.catalog)
        .filter((row) => admin || row.is_active)
        .map(awardValue)
        .sort(compareAwards),
    };
  }),
  implement(contracts.awardsGet, (ctx, actor, input) =>
    awardValue(visibleAward(ctx, actor, input.awardId)),
  ),
  implement(contracts.awardsHolders, (ctx, actor, input) => {
    visibleAward(ctx, actor, input.awardId);
    return grantsPage(ctx, "holders", input.awardId, input);
  }),
  implement(contracts.awardsCriteria, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.awards");
    return { items: criterionDefinitions };
  }),
  implement(contracts.awardsCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    validate(input.criteria);
    return writeTx(ctx, () => {
      const id = Number(
        run(
          ctx,
          "create",
          "INSERT INTO awards (name, description, icon, tier, xp, credits, is_stackable, is_active, criteria, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
          input.name,
          input.description,
          input.icon,
          input.tier,
          input.xp,
          input.credits,
          Number(input.isStackable),
          Number(input.isActive),
          JSON.stringify(input.criteria),
          ctx.now(),
        ).lastInsertRowid,
      );
      return awardValue(awardRow(ctx, id));
    });
  }),
  implement(contracts.awardsUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    if (input.criteria) validate(input.criteria);
    return writeTx(ctx, () => {
      const award = awardRow(ctx, input.awardId);
      if (input.isStackable === false && one(ctx, "stacked", awardSql.stacked, award.id))
        throw new ConflictError("A member holds this award more than once.");
      run(
        ctx,
        "update",
        "UPDATE awards SET name = ?1, description = ?2, icon = ?3, tier = ?4, xp = ?5, credits = ?6, is_stackable = ?7, is_active = ?8, criteria = ?9, updated_at = ?10 WHERE id = ?11",
        input.name ?? award.name,
        input.description ?? award.description,
        input.icon ?? award.icon,
        input.tier ?? award.tier,
        input.xp ?? award.xp,
        input.credits ?? award.credits,
        Number(input.isStackable ?? !!award.is_stackable),
        Number(input.isActive ?? !!award.is_active),
        JSON.stringify(input.criteria ?? conditions(award)),
        ctx.now(),
        award.id,
      );
      return awardValue(awardRow(ctx, award.id));
    });
  }),
  implement(contracts.awardsDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      awardRow(ctx, input.awardId);
      if (one(ctx, "everGranted", awardSql.everGranted, input.awardId))
        throw new ConflictError("An award that was granted can only be deactivated.");
      run(ctx, "delete", "DELETE FROM awards WHERE id = ?1", input.awardId);
      return { ok: true };
    });
  }),
  implement(contracts.awardsRun, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.awards");
    return {
      queued: enqueueJob(ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" }) !== null,
    };
  }),
  implement(contracts.awardsGrant, (ctx, actor, input) => {
    requirePermission(ctx, actor, "award.grant");
    const granter = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      const award = awardRow(ctx, input.awardId);
      // Only award administrators may learn that an inactive award exists.
      if (!award.is_active && !can(ctx, actor, "admin.awards")) throw new NotFoundError();
      memberXp(ctx, input.userId);
      const grant = grantAward(ctx, award, input.userId, granter.userId, input.reason)!;
      return grantValues(ctx, [grant])[0]!;
    });
  }),
  implement(contracts.awardsRevoke, (ctx, actor, input) => {
    requirePermission(ctx, actor, "award.grant");
    const revoker = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      revokeAward(ctx, input.memberAwardId, revoker.userId, input.reason);
      return { ok: true };
    });
  }),
  implement(contracts.awardsMember, (ctx, actor, input) => {
    visibleMember(ctx, actor, input.userId);
    const xp = memberXp(ctx, input.userId);
    const totals = all<TotalRow>(ctx, "totals", awardSql.totals, input.userId);
    const awards = loadAwards(
      ctx,
      totals.map((row) => row.award_id),
    );
    return {
      xp,
      items: totals
        .map((row) => ({
          award: awards.get(row.award_id)!,
          count: row.count,
          lastGrantedAt: iso(row.last_granted_at),
        }))
        .sort((a, b) => compareAwards(a.award, b.award)),
    };
  }),
  implement(contracts.awardsMemberGrants, (ctx, actor, input) => {
    visibleMember(ctx, actor, input.userId);
    return grantsPage(ctx, "grants", input.userId, input);
  }),
];
