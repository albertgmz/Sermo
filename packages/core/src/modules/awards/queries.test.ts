import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { evaluationSql, SWEEP_CHUNK } from "./automatic";
import { claimSql } from "./grants";
import { REVOKE_CHUNK, revokeSql } from "./revoke";
import { awardSql } from "./store";

test("award hot queries use indexed lookups and keyset order", () => {
  const ctx = createTestContext();
  try {
    const checks: [string, unknown[]][] = [
      [awardSql.catalog, []],
      [awardSql.award, [1]],
      [awardSql.awardBatch, ["[1,2]"]],
      [awardSql.user, [1]],
      [awardSql.holders, [1, 999999, 21]],
      [awardSql.grants, [1, 999999, 21]],
      [awardSql.totals, [1]],
      [awardSql.stacked, [1]],
      [awardSql.everGranted, [1]],
      [awardSql.revoke, [ctx.now(), 1, 1]],
      [claimSql, [1, 1, 0, ctx.now(), 0]],
      [evaluationSql.member, [1]],
      [evaluationSql.members, [0, SWEEP_CHUNK]],
      [evaluationSql.totals, ["[1,2]"]],
      ["SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))", ["[1,2]"]],
      [
        "SELECT profile_view_privacy, profile_post_privacy, EXISTS(SELECT 1 FROM user_follows WHERE user_id = ?1 AND followed_id = ?2) AS follows FROM users WHERE id = ?1",
        [1, 2],
      ],
      [
        "SELECT m.value AS buyer_id, i.value AS item_id FROM json_each(?1) m, json_each(?2) i WHERE EXISTS (SELECT 1 FROM shop_purchases p WHERE p.buyer_id = m.value AND p.item_id = i.value)",
        ["[1,2]", "[1,2]"],
      ],
      [
        "UPDATE member_award_totals SET count = count - 1, auto_granted = auto_granted AND NOT ?3 WHERE user_id = ?1 AND award_id = ?2",
        [1, 1, 1],
      ],
      [revokeSql.members, [0, REVOKE_CHUNK]],
      [revokeSql.grants, ["[1,2]"]],
      [revokeSql.top, []],
      [revokeSql.record, []],
      [revokeSql.setRecord, ["{}", 1]],
      ["UPDATE users SET award_xp = award_xp + ?1 WHERE id = ?2", [1, 1]],
      ["UPDATE users SET award_xp = award_xp - ?1 WHERE id = ?2", [1, 1]],
      ["UPDATE awards SET grant_count = grant_count + 1 WHERE id = ?1", [1]],
      ["UPDATE awards SET grant_count = grant_count - 1 WHERE id = ?1", [1]],
      ["DELETE FROM awards WHERE id = ?1", [1]],
    ];
    for (const table of ["posts", "threads", "profile_posts", "profile_post_comments"])
      checks.push([`SELECT user_id FROM ${table} WHERE id = ?1`, [1]]);
    for (const [sql, args] of checks) expectNoTableScan(ctx, sql, args);
  } finally {
    closeContext(ctx);
  }
});

test("both member reads handle 800 held grants without changing the database", async () => {
  const ctx = createTestContext();
  try {
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const call = (name: string, input: unknown) =>
      execute(ctx, getOperation(`awards.${name}`), admin, input);
    const award = await call("create", { name: "Heavy", tier: "gold", isStackable: true, xp: 2 });
    for (let i = 0; i < 800; i++) await call("grant", { userId: member.id, awardId: award.id });
    const before = ctx.sqlite.prepare("SELECT total_changes() AS total").get();
    const held = await call("member", { userId: member.id });
    expect(held.xp).toBe(1600);
    expect(held.items).toHaveLength(1);
    expect(held.items[0].count).toBe(800);
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await call("memberGrants", { userId: member.id, limit: 100, cursor });
      ids.push(...page.items.map((grant: { id: number }) => grant.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(800);
    expect(new Set(ids).size).toBe(800);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(ctx.sqlite.prepare("SELECT total_changes() AS total").get()).toEqual(before);
  } finally {
    closeContext(ctx);
  }
});
