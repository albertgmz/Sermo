import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";

const op = (name: string) => getOperation(name);

// A manager who holds exactly one permission, through a group of their own.
async function managerOf(permission: string) {
  const ctx = createTestContext();
  const founder = userActor(insertUser(ctx, { groupId: 4 }));
  const group = (await execute(ctx, op("groups.create"), founder, {
    title: `Only ${permission}`,
    rank: 40,
  })) as { id: number };
  await execute(ctx, op("permissions.set"), founder, {
    groupId: group.id,
    entries: [{ permission, value: "allow" }],
  });
  return { ctx, founder, manager: userActor(insertUser(ctx, { groupId: group.id })), group };
}

describe("criteria.list", () => {
  for (const permission of [
    "admin.promotions",
    "admin.awards",
    "admin.shop",
    "admin.announcements",
    "admin.reactionTypes",
  ])
    test(`a holder of only ${permission} gets the criteria and the groups`, async () => {
      const { ctx, founder, manager, group } = await managerOf(permission);
      const list = (await execute(ctx, op("criteria.list"), manager, {})) as {
        items: { id: string; cost: string }[];
        groups: object[];
      };
      // The same registry the two older reads publish.
      const asAdmin = (await execute(ctx, op("awards.criteria"), founder, {})) as {
        items: unknown[];
      };
      expect(list.items).toEqual(asAdmin.items as typeof list.items);
      expect(list.items.map((item) => item.id)).toContain("in_group");
      expect(list.items.some((item) => item.cost === "background")).toBe(true);
      // Every group, by id and title only.
      expect(list.groups).toContainEqual({ id: group.id, title: `Only ${permission}` });
      for (const entry of list.groups) expect(Object.keys(entry).sort()).toEqual(["id", "title"]);
      expect(list.groups.length).toBe(6);
    });

  test("the awards and credit rules a rule may name come with the criteria, by id and title", async () => {
    const { ctx, manager } = await managerOf("admin.announcements");
    const award = (name: string, active: number) =>
      ctx.sqlite
        .prepare<{ id: number }, [string, number]>(
          "INSERT INTO awards (name, tier, created_at, updated_at, is_active) VALUES (?1, 'gold', 0, 0, ?2) RETURNING id",
        )
        .get(name, active)!.id;
    const open = award("Veteran", 1);
    const hidden = award("Staff secret", 0);
    const creditRule = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO credit_rules (title, trigger, amount, created_at, updated_at) VALUES ('Daily', 'daily_activity', 1, 0, 0) RETURNING id",
      )
      .get()!.id;
    const list = (await execute(ctx, op("criteria.list"), manager, {})) as {
      awards: object[];
      creditRules: object[];
    };
    // An inactive award is not named to someone who does not manage awards.
    expect(list.awards).toEqual([{ id: open, title: "Veteran" }]);
    expect(list.creditRules).toEqual([{ id: creditRule, title: "Daily" }]);
    const { ctx: managed, manager: awardManager } = await managerOf("admin.awards");
    managed.sqlite
      .prepare(
        "INSERT INTO awards (name, tier, created_at, updated_at, is_active) VALUES ('Staff secret', 'gold', 0, 0, 0)",
      )
      .run();
    const seen = (await execute(managed, op("criteria.list"), awardManager, {})) as {
      awards: { title: string }[];
    };
    expect(seen.awards.map((entry) => entry.title)).toEqual(["Staff secret"]);
    expect(hidden).toBeGreaterThan(0);
  });

  test("guests, members and moderators are refused", async () => {
    const { ctx } = await managerOf("admin.shop");
    const member = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    await expect(execute(ctx, op("criteria.list"), GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [member, moderator])
      await expect(execute(ctx, op("criteria.list"), actor, {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
  });

  // The other readers of groups.list are not rule editors: exactly the five permissions open it.
  for (const permission of ["admin.groups", "admin.members", "admin.permissions"])
    test(`a holder of only ${permission} is refused`, async () => {
      const { ctx, manager } = await managerOf(permission);
      await expect(execute(ctx, op("criteria.list"), manager, {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      // That permission does open the group list, so the refusal is about this read alone.
      await expect(execute(ctx, op("groups.list"), manager, {})).resolves.toBeDefined();
    });

  test("the older reads keep their own permission", async () => {
    const { ctx, manager } = await managerOf("admin.shop");
    for (const name of ["promotions.criteria", "awards.criteria"])
      await expect(execute(ctx, op(name), manager, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
