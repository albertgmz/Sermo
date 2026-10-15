import type * as z from "zod";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import type { Award } from "../../contracts/awards";
import { NotFoundError } from "../../errors";
import { parseRule, type Rule } from "../../shared/criteria";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { publicPicture } from "../storage/url";

export type AwardRow = {
  id: number;
  name: string;
  description: string;
  icon: string;
  image_file_id: number | null;
  tier: z.infer<typeof Award>["tier"];
  xp: number;
  credits: number;
  is_stackable: number;
  is_active: number;
  rule: string;
  grant_count: number;
  created_at: number;
  updated_at: number;
};
export type GrantRow = {
  id: number;
  user_id: number;
  award_id: number;
  granted_by: number | null;
  reason: string;
  xp: number;
  credits: number;
  created_at: number;
};
export type TotalRow = {
  user_id: number;
  award_id: number;
  count: number;
  auto_granted: number;
  last_granted_at: number;
};

type Binding = number | string | null;
export function all<T>(ctx: Ctx, key: string, sql: string, ...args: Binding[]): T[] {
  return prepared(ctx, `awards.${key}`, () => ctx.sqlite.prepare<T, Binding[]>(sql)).all(...args);
}
export function one<T>(ctx: Ctx, key: string, sql: string, ...args: Binding[]): T | null {
  return prepared(ctx, `awards.${key}`, () => ctx.sqlite.prepare<T, Binding[]>(sql)).get(...args);
}
export function run(ctx: Ctx, key: string, sql: string, ...args: Binding[]) {
  return prepared(ctx, `awards.${key}`, () => ctx.sqlite.prepare(sql)).run(...args);
}

export const awardSql = {
  catalog: "SELECT * FROM awards ORDER BY id",
  award: "SELECT * FROM awards WHERE id = ?1",
  awardBatch: "SELECT * FROM awards WHERE id IN (SELECT value FROM json_each(?1))",
  user: "SELECT award_xp FROM users WHERE id = ?1",
  holders:
    "SELECT * FROM member_awards WHERE award_id = ?1 AND revoked_at IS NULL AND id < ?2 ORDER BY id DESC LIMIT ?3",
  grants:
    "SELECT * FROM member_awards WHERE user_id = ?1 AND revoked_at IS NULL AND id < ?2 ORDER BY id DESC LIMIT ?3",
  totals: "SELECT * FROM member_award_totals WHERE user_id = ?1 AND count > 0",
  stacked: "SELECT id FROM member_award_totals WHERE award_id = ?1 AND count > 1 LIMIT 1",
  everGranted: "SELECT id FROM member_awards WHERE award_id = ?1 LIMIT 1",
  revoke:
    "UPDATE member_awards SET revoked_at = ?1, revoked_by = ?2 WHERE id = ?3 AND revoked_at IS NULL RETURNING *",
};
export function awardRow(ctx: Ctx, id: number): AwardRow {
  const row = one<AwardRow>(ctx, "award", awardSql.award, id);
  if (!row) throw new NotFoundError();
  return row;
}
export function memberXp(ctx: Ctx, id: number): number {
  const row = one<{ award_xp: number }>(ctx, "user", awardSql.user, id);
  if (!row) throw new NotFoundError();
  return row.award_xp;
}
export const ruleOf = (row: AwardRow): Rule => parseRule(row.rule);
export const awardValue = (ctx: Ctx, row: AwardRow): z.infer<typeof Award> => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  image: publicPicture(ctx, row.image_file_id),
  tier: row.tier,
  xp: row.xp,
  credits: row.credits,
  isStackable: !!row.is_stackable,
  isActive: !!row.is_active,
  rule: ruleOf(row),
  grantCount: row.grant_count,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
const tierOrder = { legendary: 0, gold: 1, silver: 2, bronze: 3 };
export function compareAwards(a: z.infer<typeof Award>, b: z.infer<typeof Award>): number {
  return tierOrder[a.tier] - tierOrder[b.tier] || b.xp - a.xp || a.id - b.id;
}
export function loadAwards(ctx: Ctx, ids: Iterable<number>) {
  const rows = all<AwardRow>(
    ctx,
    "awardBatch",
    awardSql.awardBatch,
    JSON.stringify([...new Set(ids)]),
  );
  return new Map(rows.map((row) => [row.id, awardValue(ctx, row)]));
}
export function grantValues(ctx: Ctx, rows: GrantRow[]) {
  const awards = loadAwards(
    ctx,
    rows.map((row) => row.award_id),
  );
  const users = loadUserSummaries(
    ctx,
    rows.flatMap((row) =>
      row.granted_by === null ? [row.user_id] : [row.user_id, row.granted_by],
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    user: users(row.user_id),
    award: awards.get(row.award_id)!,
    grantedBy: row.granted_by === null ? null : users(row.granted_by),
    reason: row.reason,
    grantedAt: iso(row.created_at),
  }));
}
