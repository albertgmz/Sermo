import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../context";
import {
  evaluateMember as awardMember,
  sweepChunk as sweepAwards,
} from "../../modules/awards/automatic";
import {
  evaluateMember as promoteMember,
  sweepChunk as sweepPromotions,
} from "../../modules/promotions";
import { traceStatements } from "../../modules/statement-trace";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { createTestContext, insertNode, insertUser, userActor } from "../../testing";
import type { Rule } from "../criteria";

/** What a pass reads from history is read before the write begins, and the write re-checks what it needs. */

const rule = (...conditions: Rule["conditions"]): Rule => ({ match: "all", conditions });

function world() {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx).id;
  const other = insertUser(ctx).id;
  const node = insertNode(ctx, {}).id;
  const thread = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'T', 1, 1, ?2) RETURNING id",
    )
    .get(node, other)!.id;
  ctx.sqlite
    .prepare("INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 1, 1)")
    .run(thread, member);
  const badge = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Badge', 30) RETURNING id",
    )
    .get()!.id;
  const posted = rule({ criterion: "posts_in_threads", ids: [thread], value: 1, mode: "one" });
  const award = async (name: string, conditions: Rule) =>
    (
      (await execute(ctx, getOperation("awards.create"), admin, {
        name,
        tier: "bronze",
        rule: conditions,
      })) as { id: number }
    ).id;
  const promotion = async (title: string, conditions: Rule) =>
    execute(ctx, getOperation("promotions.create"), admin, {
      title,
      rule: conditions,
      groupIds: [badge],
    });
  const holders = () =>
    ctx.sqlite
      .prepare<{ user_id: number }, []>(
        "SELECT user_id FROM member_awards WHERE revoked_at IS NULL",
      )
      .all()
      .map((row) => row.user_id);
  const promoted = () =>
    ctx.sqlite
      .prepare<{ user_id: number }, []>("SELECT user_id FROM user_group_grants")
      .all()
      .map((row) => row.user_id);
  return { ctx, trace, member, thread, badge, posted, award, promotion, holders, promoted };
}

/** Runs `change` just before the first statement that reads history for `pattern` executes. */
function beforeHistory(ctx: Ctx, pattern: RegExp, change: () => void) {
  let done = false;
  // A statement prepared before is cached and would never pass through the wrapper.
  ctx.statements.clear();
  const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
  Reflect.set(ctx.sqlite, "prepare", (text: string) => {
    const statement = prepare(text);
    if (!pattern.test(text)) return statement;
    const all = Reflect.get(statement, "all") as (...args: unknown[]) => unknown;
    Reflect.set(statement, "all", (...args: unknown[]) => {
      if (!done) {
        done = true;
        change();
      }
      return Reflect.apply(all, statement, args);
    });
    return statement;
  });
}

const HISTORY = /FROM posts p WHERE p\.user_id IN/;

describe("sweeps and member checks read history before they write", () => {
  test("the award sweep and the member check count history with no transaction open", async () => {
    const { ctx, trace, member, posted, award, holders } = world();
    await award("Posted", posted);
    sweepAwards(ctx, 0);
    expect(holders()).toEqual([member]);
    const reads = trace.sql.flatMap((text, at) => (HISTORY.test(text) ? [at] : []));
    expect(reads.length).toBe(1);
    for (const at of reads) expect(trace.inTransaction[at]).toBe(false);
    // The grants themselves are written inside one.
    const grant = trace.sql.findIndex((text) => /INSERT INTO member_awards/.test(text));
    expect(trace.inTransaction[grant]).toBe(true);
    // The same for one member, as events check them.
    ctx.sqlite.prepare("DELETE FROM member_awards").run();
    ctx.sqlite.prepare("DELETE FROM member_award_totals").run();
    const before = trace.sql.length;
    expect(awardMember(ctx, member)).toBe(1);
    trace.sql.slice(before).forEach((text, at) => {
      if (HISTORY.test(text)) expect(trace.inTransaction[before + at]).toBe(false);
    });
  });

  test("the promotion sweep and the member check count history with no transaction open", async () => {
    const { ctx, trace, member, posted, promotion, promoted } = world();
    await promotion("Posters", posted);
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([member]);
    const reads = trace.sql.flatMap((text, at) => (HISTORY.test(text) ? [at] : []));
    expect(reads.length).toBe(1);
    for (const at of reads) expect(trace.inTransaction[at]).toBe(false);
    const grant = trace.sql.findIndex((text) => /INSERT INTO user_group_grants/.test(text));
    expect(trace.inTransaction[grant]).toBe(true);
    ctx.sqlite.prepare("DELETE FROM user_group_grants").run();
    ctx.sqlite.prepare("DELETE FROM user_promotions").run();
    const before = trace.sql.length;
    expect(promoteMember(ctx, member)).toBe(1);
    trace.sql.slice(before).forEach((text, at) => {
      if (HISTORY.test(text)) expect(trace.inTransaction[before + at]).toBe(false);
    });
  });

  test("an award edited while its facts were being read is left for the next pass", async () => {
    const { ctx, member, posted, award, holders } = world();
    const id = await award("Posted", posted);
    beforeHistory(ctx, HISTORY, () =>
      ctx.sqlite.prepare("UPDATE awards SET is_active = 0 WHERE id = ?1").run(id),
    );
    sweepAwards(ctx, 0);
    expect(holders()).toEqual([]);
    // Once it is active again the next pass gives it.
    ctx.sqlite.prepare("UPDATE awards SET is_active = 1 WHERE id = ?1").run(id);
    sweepAwards(ctx, 0);
    expect(holders()).toEqual([member]);
  });

  test("an award whose rule changed while its facts were being read is not judged on the old facts", async () => {
    const { ctx, member, posted, award, holders } = world();
    const held = await award("Held", rule({ criterion: "is_member", ids: [99999] }));
    const target = await award("Target", posted);
    ctx.sqlite
      .prepare(
        "INSERT INTO member_award_totals (user_id, award_id, count, auto_granted) VALUES (?1, ?2, 1, 0)",
      )
      .run(member, held);
    // The new rule holds only for a member who holds no "Held": it asks for a fact that was not
    // loaded, which reads as nothing held. Judged on the old facts the member would be given it.
    const changed = rule({ criterion: "holds_awards", ids: [held], mode: "none" });
    beforeHistory(ctx, HISTORY, () =>
      ctx.sqlite
        .prepare("UPDATE awards SET rule = ?1 WHERE id = ?2")
        .run(JSON.stringify(changed), target),
    );
    sweepAwards(ctx, 0);
    expect(holders()).toEqual([]);
    // The next pass loads what the new rule reads: the member holds it, so it is not given
    // (members who hold none of it are).
    sweepAwards(ctx, 0);
    expect(holders()).not.toContain(member);
    expect(holders().length).toBeGreaterThan(0);
  });

  test("a promotion edited while its facts were being read is not judged on the old facts", async () => {
    const { ctx, member, posted, promotion, promoted } = world();
    await promotion("Posters", posted);
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([member]);
    // The member bookmarks something; the promotion is edited to ask for it just as the facts of
    // the next sweep are read. Judged on those facts (no bookmarks loaded) it would take the group away.
    ctx.sqlite
      .prepare(
        "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', 1, 1)",
      )
      .run(member);
    beforeHistory(ctx, HISTORY, () =>
      ctx.sqlite
        .prepare("UPDATE promotions SET rule = ?1")
        .run(JSON.stringify(rule({ criterion: "bookmarks_at_least", value: 1 }))),
    );
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([member]);
    // The next sweep loads what the new rule reads, and it holds.
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([member]);
    // Without the bookmark the new rule no longer holds and the group goes.
    ctx.sqlite.prepare("DELETE FROM bookmarks").run();
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([]);
  });
});

describe("credits earned wait for the sweep", () => {
  const earned = rule({ criterion: "credits_earned", value: 5 });
  const ledger = (ctx: Ctx, userId: number) =>
    ctx.sqlite
      .prepare(
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, created_at) VALUES (?1, 9, 9, 'event', 1)",
      )
      .run(userId);

  test("an award on credits earned is given by the sweep, not by a member check", async () => {
    const { ctx, member, award, holders } = world();
    await award("Earner", earned);
    ledger(ctx, member);
    expect(awardMember(ctx, member)).toBe(0);
    expect(holders()).toEqual([]);
    sweepAwards(ctx, 0);
    expect(holders()).toEqual([member]);
  });

  test("a promotion on credits earned is applied by the sweep, not by a member check", async () => {
    const { ctx, member, promotion, promoted } = world();
    await promotion("Earners", earned);
    ledger(ctx, member);
    expect(promoteMember(ctx, member)).toBe(0);
    expect(promoted()).toEqual([]);
    sweepPromotions(ctx, 0);
    expect(promoted()).toEqual([member]);
  });

  test("a rule that also holds other conditions is left to the sweep as a whole", async () => {
    const { ctx, member, award, holders } = world();
    await award("Mixed", {
      match: "any",
      conditions: [
        { criterion: "credits_earned", value: 5 },
        { criterion: "post_count", value: 0 },
      ],
    });
    expect(awardMember(ctx, member)).toBe(0);
    expect(holders()).toEqual([]);
    sweepAwards(ctx, 0);
    expect(holders()).toContain(member);
  });
});
