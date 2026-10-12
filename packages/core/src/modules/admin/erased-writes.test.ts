import { afterEach, describe, expect, test } from "bun:test";
import { insertNode } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { ConflictError, ForbiddenError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const MESSAGE = "This member's account was erased.";

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const moderator = await w.register("Moderator", 3);
  const node = insertNode(w.ctx, { type: "forum" });
  invalidate(w.ctx, "node_tree");
  const { thread } = await w.run("threads.create", founder.actor, {
    nodeId: node.id,
    title: "Thread",
    body: "Body",
  });
  const award = await w.run("awards.create", founder.actor, { name: "Star", tier: "gold", xp: 1 });
  const group = await w.run("groups.create", founder.actor, { title: "Earned" });
  const promotion = await w.run("promotions.create", founder.actor, {
    title: "Rule",
    criteria: [{ criterion: "post_count", value: 0 }],
    groupIds: [group.id],
  });
  const erase = async (id: number) =>
    w.run("users.adminErase", founder.actor, {
      userId: id,
      actorPassword: PASSWORD,
      reason: "Cleanup",
    });
  return { ...w, founder, moderator, node, thread, award, promotion, erase };
}
type World = Awaited<ReturnType<typeof world>>;

/** Each write that targets a member, as a function of the member. */
const writes: Record<string, (w: World, userId: number) => Promise<unknown>> = {
  "permissions.set": (w, userId) =>
    w.run("permissions.set", w.founder.actor, {
      userId,
      entries: [{ permission: "forum.reply", value: "allow" }],
    }),
  "users.setGroups": (w, userId) =>
    w.run("users.setGroups", w.founder.actor, { userId, secondaryGroupIds: [3] }),
  "nodes.setModerator": (w, userId) =>
    w.run("nodes.setModerator", w.founder.actor, { nodeId: w.node.id, userId }),
  "warnings.create": (w, userId) =>
    w.run("warnings.create", w.founder.actor, { userId, points: 1, reason: "Rude" }),
  "restrictions.create": (w, userId) =>
    w.run("restrictions.create", w.founder.actor, { userId, kind: "posting", reason: "Spam" }),
  "bans.create": (w, userId) =>
    w.run("bans.create", w.founder.actor, { userId, reason: "Spam", expiresAt: null }),
  "threadBans.create": (w, userId) =>
    w.run("threadBans.create", w.founder.actor, { threadId: w.thread.id, userId, reason: "Off" }),
  "credits.adjust": (w, userId) =>
    w.run("credits.adjust", w.founder.actor, { userId, amount: 5, reason: "Gift" }),
  "awards.grant": (w, userId) =>
    w.run("awards.grant", w.founder.actor, { userId, awardId: w.award.id }),
  "promotions.apply": (w, userId) =>
    w.run("promotions.apply", w.founder.actor, {
      userId,
      promotionId: w.promotion.id,
      action: "promote",
    }),
};

describe("writes on an erased member", () => {
  for (const [name, write] of Object.entries(writes)) {
    describe(name, () => {
      test("works on an ordinary member", async () => {
        const w = await world();
        const member = await w.register("Ordinary");
        await write(w, member.id);
      });

      test("is a conflict with the shared message on an erased member", async () => {
        const w = await world();
        const member = await w.register("Erased One");
        await w.erase(member.id);
        const refused = await write(w, member.id).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ConflictError);
        expect((refused as Error).message).toBe(MESSAGE);
      });
    });
  }

  test("changes nothing", async () => {
    const w = await world();
    const member = await w.register("Erased Two");
    await w.erase(member.id);
    const count = (table: string) =>
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`)
        .get(member.id)!.n;
    const tables = ["warnings", "user_restrictions", "thread_bans", "user_groups", "member_awards"];
    const before = tables.map(count);
    const entries = (
      w.ctx.sqlite.prepare("SELECT count(*) AS n FROM permission_entries").get() as { n: number }
    ).n;
    const credits = () =>
      w.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(member.id)!.credits;
    const balance = credits();
    for (const [name, write] of Object.entries(writes))
      if (name !== "bans.create") await write(w, member.id).catch(() => {});
    expect(tables.map(count)).toEqual(before);
    expect(
      (w.ctx.sqlite.prepare("SELECT count(*) AS n FROM permission_entries").get() as { n: number })
        .n,
    ).toBe(entries);
    expect(credits()).toBe(balance);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM bans WHERE user_id = ?1")
        .get(member.id)!.n,
    ).toBe(1);
  });

  test("a caller without the permission is told it is forbidden, not that the member was erased", async () => {
    const w = await world();
    const member = await w.register("Erased Three");
    await w.erase(member.id);
    await expect(
      w.run("warnings.create", w.moderator.actor, { userId: member.id, points: 1, reason: "Rude" }),
    ).rejects.toThrow();
    await expect(
      w.run("credits.adjust", (await w.register("Plain")).actor, {
        userId: member.id,
        amount: 5,
        reason: "Gift",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
