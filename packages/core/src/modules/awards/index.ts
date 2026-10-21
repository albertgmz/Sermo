import * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import * as contracts from "../../contracts/awards";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, currentActor, requirePermission } from "../../permissions";
import {
  assertRule,
  awardsReadBy,
  criterionDefinitions,
  parseRule,
  type Rule,
} from "../../shared/criteria";
import { viewerLanguage, withTitles } from "../../shared/language";
import { iso } from "../../time";
import { requireNotErased } from "../admin/erased";
import { releaseFile } from "../images/attach";
import { enqueueJob } from "../jobs/queue";
import { requireSiteView } from "../members/site-access";
import { mayViewProfile, profileAccess } from "../profiles/shared";
import { registerAwardJobs as registerSweepJobs, sweepAgainAfterCurrent } from "./automatic";
import { assertCategory, categoryOperations } from "./categories";
import { grantAward, revokeAward } from "./grants";
import { AWARD_ICON_KEYS } from "./icons";
import { registerRevokeJobs, revokeRunValue, startRevoke } from "./revoke";
import {
  type AwardRow,
  all,
  awardRow,
  awardSql,
  awardValue,
  catalogOrder,
  compareAwards,
  type GrantRow,
  grantValues,
  loadAwards,
  memberXp,
  one,
  ruleOf,
  run,
  type TotalRow,
} from "./store";

export function registerAwardJobs(ctx: Ctx): void {
  registerSweepJobs(ctx);
  registerRevokeJobs(ctx);
}

function visibleAward(ctx: Ctx, actor: Actor, id: number): AwardRow {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
  const row = awardRow(ctx, id);
  if (!row.is_active && !can(ctx, actor, "admin.awards")) throw new NotFoundError();
  return row;
}
/** An award's icon is empty (the default medal) or a key of the site's icon set. */
function assertIcon(icon: string): void {
  if (icon !== "" && !AWARD_ICON_KEYS.has(icon)) {
    const message = "This is not an icon of the site's icon set.";
    throw new ValidationError(message, [{ path: ["icon"], message }]);
  }
}
function visibleMember(ctx: Ctx, actor: Actor, id: number): void {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view", {}, { notFound: true });
  const access = profileAccess(ctx, actor, id);
  if (!mayViewProfile(ctx, actor, id, access)) throw new NotFoundError();
}
function validate(ctx: Ctx, rule: Rule): void {
  assertRule(ctx, rule, "background");
}
/**
 * An award's rule may read other awards, and giving or taking one away checks the member's other
 * awards again. To keep that from ever looping, an award cannot require itself, directly or
 * through other awards (the same rule that keeps promotions from depending on one another).
 */
function assertNoAwardLoop(ctx: Ctx, awardId: number, rule: Rule): void {
  const reads = new Map(
    all<AwardRow>(ctx, "catalog", awardSql.catalog).map((row) => [
      row.id,
      awardsReadBy(ruleOf(row)),
    ]),
  );
  reads.set(awardId, awardsReadBy(rule));
  const seen = new Set<number>();
  const pending = [...reads.get(awardId)!];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === awardId)
      throw new ValidationError(
        "An award cannot require itself, directly or through other awards.",
      );
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(reads.get(id) ?? []));
  }
}
/**
 * The stored rules that name an award, in words for a refusal. An award that is deleted while a
 * rule names it would leave that rule counting nothing, and the next award to take its id would
 * inherit the rule.
 */
function readersOf(ctx: Ctx, awardId: number): string[] {
  const readers: string[] = [];
  const check = (kind: string, name: string, rule: string) => {
    if (awardsReadBy(parseRule(rule)).includes(awardId)) readers.push(`${kind} "${name}"`);
  };
  for (const row of all<AwardRow>(ctx, "catalog", awardSql.catalog))
    if (row.id !== awardId) check("award", row.name, row.rule);
  for (const [kind, table, column] of [
    ["promotion", "promotions", "title"],
    ["notice", "notices", "title"],
    ["shop category", "shop_categories", "name"],
    ["shop item", "shop_items", "name"],
    ["reaction type", "reaction_types", "title"],
  ] as const)
    for (const row of all<{ name: string; rule: string }>(
      ctx,
      `readers.${table}`,
      `SELECT ${column} AS name, rule FROM ${table}`,
    ))
      check(kind, row.name, row.rule);
  return readers;
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
  ...categoryOperations,
  implement(contracts.awardsList, (ctx, actor) => {
    requireSiteView(ctx, actor);
    requirePermission(ctx, actor, "profile.view");
    const admin = can(ctx, actor, "admin.awards");
    return {
      items: catalogOrder(
        all<AwardRow>(ctx, "catalog", awardSql.catalog).filter((row) => admin || row.is_active),
      ).map((row) => awardValue(ctx, row, admin)),
    };
  }),
  implement(contracts.awardsGet, (ctx, actor, input) =>
    awardValue(ctx, visibleAward(ctx, actor, input.awardId), can(ctx, actor, "admin.awards")),
  ),
  implement(contracts.awardsHolders, (ctx, actor, input) => {
    visibleAward(ctx, actor, input.awardId);
    // A list of members, like the member list itself.
    requirePermission(ctx, actor, "member.viewList");
    return grantsPage(ctx, "holders", input.awardId, input);
  }),
  implement(contracts.awardsCriteria, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.awards");
    return { items: withTitles(viewerLanguage(ctx, actor), criterionDefinitions) };
  }),
  implement(contracts.awardsCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    assertIcon(input.icon);
    validate(ctx, input.rule);
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
      assertCategory(ctx, input.categoryId);
      const id = Number(
        run(
          ctx,
          "create",
          "INSERT INTO awards (name, description, icon, tier, xp, credits, is_stackable, is_active, rule, created_at, updated_at, category_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)",
          input.name,
          input.description,
          input.icon,
          input.tier,
          input.xp,
          input.credits,
          Number(input.isStackable),
          Number(input.isActive),
          JSON.stringify(input.rule),
          ctx.now(),
          input.categoryId,
        ).lastInsertRowid,
      );
      assertNoAwardLoop(ctx, id, input.rule);
      if (input.isActive && input.rule.conditions.length > 0) sweepAgainAfterCurrent(ctx);
      return awardValue(ctx, awardRow(ctx, id), true);
    });
  }),
  implement(contracts.awardsUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    if (input.rule) validate(ctx, input.rule);
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
      const award = awardRow(ctx, input.awardId);
      if (input.categoryId !== undefined) assertCategory(ctx, input.categoryId);
      // An icon that is not a key is refused when it is being set, not when it is only sent back
      // unchanged: awards made before the set was checked keep their text and stay editable.
      if (input.icon !== undefined && input.icon !== award.icon) assertIcon(input.icon);
      if (input.rule) assertNoAwardLoop(ctx, award.id, input.rule);
      if (input.isStackable === false && one(ctx, "stacked", awardSql.stacked, award.id))
        throw new ConflictError("A member holds this award more than once.");
      run(
        ctx,
        "update",
        "UPDATE awards SET name = ?1, description = ?2, icon = ?3, tier = ?4, xp = ?5, credits = ?6, is_stackable = ?7, is_active = ?8, rule = ?9, updated_at = ?10, category_id = ?12 WHERE id = ?11",
        input.name ?? award.name,
        input.description ?? award.description,
        input.icon ?? award.icon,
        input.tier ?? award.tier,
        input.xp ?? award.xp,
        input.credits ?? award.credits,
        Number(input.isStackable ?? !!award.is_stackable),
        Number(input.isActive ?? !!award.is_active),
        JSON.stringify(input.rule ?? ruleOf(award)),
        ctx.now(),
        award.id,
        input.categoryId === undefined ? award.category_id : input.categoryId,
      );
      const after = awardRow(ctx, award.id);
      const judgedAnew = input.rule !== undefined || (after.is_active && !award.is_active);
      if (judgedAnew && after.is_active && ruleOf(after).conditions.length > 0)
        sweepAgainAfterCurrent(ctx);
      return awardValue(ctx, after, true);
    });
  }),
  implement(contracts.awardsDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
      const award = awardRow(ctx, input.awardId);
      if (one(ctx, "everGranted", awardSql.everGranted, input.awardId))
        throw new ConflictError("An award that was granted can only be deactivated.");
      const readers = readersOf(ctx, award.id);
      if (readers.length > 0)
        throw new ConflictError(
          `The rule of ${readers.join(", ")} names this award; take it out of there first.`,
        );
      run(ctx, "delete", "DELETE FROM awards WHERE id = ?1", input.awardId);
      if (award.image_file_id !== null) releaseFile(ctx, award.image_file_id);
      return { ok: true };
    });
  }),
  implement(contracts.awardsRun, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
      return {
        queued:
          enqueueJob(ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" }) !== null,
      };
    });
  }),
  implement(contracts.awardsRevokeUnqualified, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    const admin = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
      return { queued: startRevoke(ctx, admin.userId, input.apply) };
    });
  }),
  implement(contracts.awardsRevokeStatus, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.awards");
    return revokeRunValue(ctx);
  }),
  implement(contracts.awardsGrant, (ctx, actor, input) => {
    requirePermission(ctx, actor, "award.grant");
    const granter = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      const current = currentActor(ctx, actor);
      requirePermission(ctx, current, "award.grant");
      const award = awardRow(ctx, input.awardId);
      // Only award administrators may learn that an inactive award exists.
      if (!award.is_active && !can(ctx, current, "admin.awards")) throw new NotFoundError();
      memberXp(ctx, input.userId);
      requireNotErased(ctx, input.userId);
      const grant = grantAward(ctx, award, input.userId, granter.userId, input.reason)!;
      return grantValues(ctx, [grant])[0]!;
    });
  }),
  implement(contracts.awardsRevoke, (ctx, actor, input) => {
    requirePermission(ctx, actor, "award.grant");
    const revoker = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "award.grant");
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
