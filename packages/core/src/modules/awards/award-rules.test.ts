import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { evaluateMember, registerAwardJobs } from "./automatic";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx);
  registerAwardJobs(ctx);
  const call = (name: string, input: unknown = {}) =>
    execute(ctx, getOperation(`awards.${name}`), admin, input) as Promise<{
      id: number;
      rule: { conditions: unknown[] };
    }>;
  const create = async (name: string, rule: unknown) =>
    (await call("create", { name, tier: "bronze", rule })).id as number;
  const requires = (...ids: number[]) => ({
    match: "all",
    conditions: [{ criterion: "holds_awards", ids, mode: "each" }],
  });
  const held = (userId: number) =>
    ctx.sqlite
      .prepare<{ award_id: number }, [number]>(
        "SELECT award_id FROM member_awards WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY award_id",
      )
      .all(userId)
      .map((row) => row.award_id);
  const drain = async () => {
    for (let i = 0; i < 30; i++) if ((await dispatchEvents(ctx)) === 0) return;
    throw new Error("Award events did not terminate.");
  };
  return { ctx, call, create, requires, held, drain, member };
}

const posts = { match: "all", conditions: [{ criterion: "post_count", value: 1 }] };

describe("an award that needs other awards", () => {
  test("cannot require itself, directly or through others", async () => {
    const { call, create, requires } = setup();
    const a = await create("A", { match: "all", conditions: [] });
    const b = await create("B", requires(a));
    const c = await create("C", requires(b));
    const refused = (awardId: number, rule: unknown) =>
      expect(call("update", { awardId, rule })).rejects.toBeInstanceOf(ValidationError);
    // Directly.
    await refused(a, requires(a));
    // Through one award, and through two.
    await refused(a, requires(b));
    await refused(a, requires(c));
    await refused(b, requires(c));
    // Among several conditions, whatever the mode and the match.
    await refused(a, {
      match: "any",
      conditions: [
        { criterion: "post_count", value: 1 },
        { criterion: "holds_awards", ids: [c], mode: "none" },
      ],
    });
    // The rules stay as they were.
    expect((await call("get", { awardId: a })).rule.conditions).toEqual([]);
    // A chain without a cycle, and a rule saved again, are fine.
    await call("update", { awardId: a, rule: posts });
    await call("update", { awardId: c, rule: requires(a, b) });
    await call("update", { awardId: b, rule: requires(a) });
    await call("update", { awardId: b, name: "B again" });
  });

  test("is checked for a loop when it is created, whatever id it takes", async () => {
    const { ctx, call, create, requires } = setup();
    const a = await create("A", { match: "all", conditions: [] });
    // A rule that names the id the next award will take (a stale id left in a rule).
    ctx.sqlite
      .prepare("UPDATE awards SET rule = ?1 WHERE id = ?2")
      .run(JSON.stringify(requires(a + 1)), a);
    await expect(
      call("create", { name: "C", tier: "bronze", rule: requires(a) }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Refused whole: nothing was created.
    expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM awards").get()).toEqual({ n: 1 });
    // An award that closes no loop is created.
    await call("create", { name: "D", tier: "bronze", rule: { match: "all", conditions: [] } });
    expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM awards").get()).toEqual({ n: 2 });
  });

  test("cannot be deleted while a rule names it, and the refusal says whose", async () => {
    const { ctx, call, create, requires } = setup();
    const [a, b] = [
      await create("A", { match: "all", conditions: [] }),
      await create("B", { match: "all", conditions: [] }),
    ];
    await call("update", { awardId: a, rule: requires(b) });
    await expect(call("delete", { awardId: b })).rejects.toThrow(/award "A"/);
    // Promotions, notices and the shop name awards too.
    ctx.sqlite
      .prepare(
        "INSERT INTO promotions (title, group_ids, rule, created_at, updated_at) VALUES ('P', '[]', ?1, 0, 0)",
      )
      .run(JSON.stringify(requires(b)));
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_categories (name, rule, created_at, updated_at) VALUES ('Shelf', ?1, 0, 0)",
      )
      .run(JSON.stringify(requires(b)));
    await expect(call("delete", { awardId: b })).rejects.toThrow(
      /award "A", promotion "P", shop category "Shelf"/,
    );
    expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM awards WHERE id = ?1").get(b)).toEqual({
      n: 1,
    });
    // Once nothing names it, it goes; the id it leaves is taken by an award with no rule of its own.
    await call("update", { awardId: a, rule: { match: "all", conditions: [] } });
    ctx.sqlite.prepare("DELETE FROM promotions").run();
    ctx.sqlite.prepare("DELETE FROM shop_categories").run();
    await call("delete", { awardId: b });
    const reused = await create("C", { match: "all", conditions: [] });
    expect(reused).toBe(b);
    expect((await call("get", { awardId: a })).rule.conditions).toEqual([]);
  });

  test("has to name awards that exist", async () => {
    const { call } = setup();
    await expect(
      call("create", {
        name: "X",
        tier: "bronze",
        rule: { match: "all", conditions: [{ criterion: "holds_awards", ids: [999] }] },
      }),
    ).rejects.toThrow(/Unknown award: 999/);
  });

  test("is checked again when a required award is given or taken away, and the chain ends", async () => {
    const { ctx, call, create, requires, held, drain, member } = setup();
    // Made last-first, so each step has to wait for the event of the one before it.
    const c = await create("C", { match: "all", conditions: [] });
    const b = await create("B", { match: "all", conditions: [] });
    const a = await create("A", { match: "all", conditions: [] });
    await call("update", { awardId: c, rule: requires(b) });
    await call("update", { awardId: b, rule: requires(a) });
    await call("update", { awardId: a, rule: posts });
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    expect(evaluateMember(ctx, member.id)).toBe(1);
    expect(held(member.id)).toEqual([a]);
    await drain();
    expect(held(member.id)).toEqual([a, b, c].sort((x, y) => x - y));
  });

  test("an award earlier in the same pass is seen by the awards after it", async () => {
    const { ctx, create, requires, held, member } = setup();
    const a = await create("A", posts);
    const b = await create("B", requires(a));
    const c = await create("C", requires(a, b));
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    // One pass grants all three, because each award sees the ones granted before it.
    expect(evaluateMember(ctx, member.id)).toBe(3);
    expect(held(member.id)).toEqual([a, b, c]);
  });

  test("none of the selected awards: the member qualifies once the award is taken away", async () => {
    const { ctx, call, create, held, drain, member } = setup();
    const a = await create("A", { match: "all", conditions: [] });
    const clean = await create("Never had A", {
      match: "all",
      conditions: [{ criterion: "holds_awards", ids: [a], mode: "none" }],
    });
    const grant = await call("grant", { userId: member.id, awardId: a });
    await drain();
    expect(held(member.id)).toEqual([a]);
    expect(evaluateMember(ctx, member.id)).toBe(0);
    await call("revoke", { memberAwardId: grant.id });
    await drain();
    expect(held(member.id)).toEqual([clean]);
  });

  test("one, each and the counts of awards and XP", async () => {
    const { ctx, call, create, held, drain, member } = setup();
    const [a, b] = [
      await create("A", { match: "all", conditions: [] }),
      await create("B", { match: "all", conditions: [] }),
    ];
    await call("update", { awardId: a, xp: 40 });
    const one = await create("Has one", {
      match: "all",
      conditions: [{ criterion: "holds_awards", ids: [a, b], mode: "one" }],
    });
    const both = await create("Has both", {
      match: "all",
      conditions: [{ criterion: "holds_awards", ids: [a, b], mode: "each" }],
    });
    const two = await create("Two awards", {
      match: "all",
      conditions: [{ criterion: "awards_held_at_least", value: 2 }],
    });
    await call("grant", { userId: member.id, awardId: a });
    await drain();
    // Holding A and "Has one" is already two awards.
    expect(held(member.id)).toEqual([a, one, two].sort((x, y) => x - y));
    await call("grant", { userId: member.id, awardId: b });
    await drain();
    expect(held(member.id)).toEqual([a, b, one, both, two].sort((x, y) => x - y));
    expect(
      ctx.sqlite.prepare("SELECT award_count FROM users WHERE id = ?1").get(member.id),
    ).toEqual({
      award_count: 5,
    });
  });
});
