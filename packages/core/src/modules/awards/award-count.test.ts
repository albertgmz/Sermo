import { describe, expect, test } from "bun:test";
import { world } from "../members/fixtures.test";
import { evaluateMember } from "./automatic";

function setup() {
  const w = world();
  const count = (id: number) =>
    w.ctx.sqlite
      .prepare<{ award_count: number }, [number]>("SELECT award_count FROM users WHERE id = ?1")
      .get(id)!.award_count;
  const held = (id: number) =>
    w.ctx.sqlite
      .prepare<{ n: number | null }, [number]>(
        "SELECT sum(count) AS n FROM member_award_totals WHERE user_id = ?1",
      )
      .get(id)!.n ?? 0;
  const create = (input: object) =>
    w.call("awards.create", w.adminActor, { name: "A", tier: "gold", xp: 5, ...input });
  const grant = (awardId: number, userId = w.member.id) =>
    w.call("awards.grant", w.adminActor, { userId, awardId });
  return { w, count, held, create, grant };
}

describe("users.award_count", () => {
  test("a grant adds one and a revoke takes it back", async () => {
    const { w, count, held, create, grant } = setup();
    const award = await create({});
    const first = await grant(award.id);
    expect(count(w.member.id)).toBe(1);
    expect(count(w.member.id)).toBe(held(w.member.id));
    await w.call("awards.revoke", w.adminActor, { memberAwardId: first.id });
    expect(count(w.member.id)).toBe(0);
    expect(count(w.member.id)).toBe(held(w.member.id));
  });

  test("a stackable award granted twice counts twice and each revoke takes one", async () => {
    const { w, count, held, create, grant } = setup();
    const award = await create({ isStackable: true });
    const a = await grant(award.id);
    const b = await grant(award.id);
    expect(count(w.member.id)).toBe(2);
    await w.call("awards.revoke", w.adminActor, { memberAwardId: a.id });
    expect(count(w.member.id)).toBe(1);
    await w.call("awards.revoke", w.adminActor, { memberAwardId: b.id });
    expect(count(w.member.id)).toBe(0);
    expect(held(w.member.id)).toBe(0);
  });

  test("a grant that is refused does not count", async () => {
    const { w, count, create, grant } = setup();
    const award = await create({});
    await grant(award.id);
    await expect(grant(award.id)).rejects.toThrow();
    expect(count(w.member.id)).toBe(1);
  });

  test("an automatic grant counts", async () => {
    const { w, count, create } = setup();
    await create({ rule: { match: "all", conditions: [{ criterion: "post_count", value: 1 }] } });
    w.ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(w.member.id);
    expect(evaluateMember(w.ctx, w.member.id)).toBe(1);
    expect(count(w.member.id)).toBe(1);
  });

  test("it only affects the member concerned and never goes negative", async () => {
    const { w, count, create, grant } = setup();
    const award = await create({});
    const given = await grant(award.id, w.moderator.id);
    expect(count(w.member.id)).toBe(0);
    // A counter that drifted below the grant it is asked to remove stops at zero.
    w.ctx.sqlite.prepare("UPDATE users SET award_count = 0 WHERE id = ?1").run(w.moderator.id);
    await w.call("awards.revoke", w.adminActor, { memberAwardId: given.id });
    expect(count(w.moderator.id)).toBe(0);
  });
});
