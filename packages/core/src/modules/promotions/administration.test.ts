import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { ConflictError, ForbiddenError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { evaluateMember } from "./index";

const op = (name: string) => getOperation(name);
const CRITERIA = [{ criterion: "post_count", value: 0 }];
const entries = (permissions: string[], value: "allow" | "never" | "unset") =>
  permissions.map((permission) => ({ permission, value }));
const createGroup = (ctx: Ctx, actor: Actor, title: string, rank: number) =>
  execute(ctx, op("groups.create"), actor, { title, rank }) as Promise<{ id: number }>;
const createPromotion = (ctx: Ctx, actor: Actor, groupIds: number[], title = "Rule") =>
  execute(ctx, op("promotions.create"), actor, {
    title,
    criteria: CRITERIA,
    groupIds,
  }) as Promise<{ id: number }>;
const administrators = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ id: number; group_id: number }, []>("SELECT id, group_id FROM users")
    .all()
    .filter((row) =>
      can(ctx, userActor({ id: row.id, groupId: row.group_id }), "admin.permissions"),
    )
    .map((row) => row.id);

describe("promotion administrators revoked meanwhile", () => {
  const STAFF = ["admin.promotions", "admin.members"];

  async function scenario() {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const staffGroup = await createGroup(fixture, founder, "Staff", 40);
    await execute(fixture, op("permissions.set"), founder, {
      groupId: staffGroup.id,
      entries: entries(STAFF, "allow"),
    });
    const granted = await createGroup(fixture, founder, "Granted", 5);
    const promotion = await createPromotion(fixture, founder, [granted.id]);
    const staff = insertUser(fixture, { groupId: staffGroup.id });
    const member = insertUser(fixture);
    const database = sharedDatabase(fixture);
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, staff.id);
    expect(can(here, actor, "admin.promotions")).toBe(true);
    return {
      database,
      here,
      elsewhere,
      actor,
      founder,
      staff,
      staffGroup,
      granted,
      promotion,
      member,
    };
  }
  type Scenario = Awaited<ReturnType<typeof scenario>>;

  const revocations: Record<string, (s: Scenario) => Promise<unknown>> = {
    "their group is changed": (s) =>
      execute(s.elsewhere, op("users.setGroups"), s.founder, {
        userId: s.staff.id,
        primaryGroupId: 2,
      }),
    "their group loses its permissions": (s) =>
      execute(s.elsewhere, op("permissions.set"), s.founder, {
        groupId: s.staffGroup.id,
        entries: entries(STAFF, "unset"),
      }),
  };
  const attempts: Record<string, (s: Scenario) => Promise<unknown>> = {
    "promotions.create": (s) => createPromotion(s.here, s.actor, [s.granted.id], "Second"),
    "promotions.update": (s) =>
      execute(s.here, op("promotions.update"), s.actor, {
        promotionId: s.promotion.id,
        title: "Renamed",
      }),
    "promotions.apply": (s) =>
      execute(s.here, op("promotions.apply"), s.actor, {
        userId: s.member.id,
        promotionId: s.promotion.id,
        action: "promote",
      }),
    "promotions.delete": (s) =>
      execute(s.here, op("promotions.delete"), s.actor, { promotionId: s.promotion.id }),
  };
  const snapshot = (ctx: Ctx) =>
    JSON.stringify([
      ctx.sqlite
        .prepare("SELECT id, title, is_active, group_ids FROM promotions ORDER BY id")
        .all(),
      ctx.sqlite.prepare("SELECT user_id, group_id FROM user_group_grants ORDER BY id").all(),
      ctx.sqlite.prepare("SELECT user_id, state FROM user_promotions ORDER BY user_id").all(),
    ]);

  for (const [revoked, revoke] of Object.entries(revocations))
    for (const [name, attempt] of Object.entries(attempts))
      test(`${name} is refused (${revoked})`, async () => {
        const s = await scenario();
        try {
          await revoke(s);
          const before = snapshot(s.elsewhere);
          await expect(attempt(s)).rejects.toThrow(ForbiddenError);
          expect(snapshot(s.elsewhere)).toBe(before);
        } finally {
          s.database.close();
        }
      });

  test("an administrator who was not revoked still acts from a second process", async () => {
    const s = await scenario();
    try {
      for (const attempt of Object.values(attempts)) await attempt(s);
      expect(snapshot(s.elsewhere)).toContain("Second");
    } finally {
      s.database.close();
    }
  });
});

describe("administration is never earned by a promotion", () => {
  async function scenario() {
    const ctx = createTestContext();
    const founderUser = insertUser(ctx, { groupId: 4 });
    const founder = userActor(founderUser);
    const member = insertUser(ctx);
    const group = await createGroup(ctx, founder, "Earned", 20);
    const administer = (value: "allow" | "never" | "unset", groupId = group.id) =>
      execute(ctx, op("permissions.set"), founder, {
        groupId,
        entries: entries(["admin.permissions"], value),
      });
    return { ctx, founderUser, founder, member, group, administer };
  }
  /** Runs the steps a careless or hostile administrator would, skipping the refused ones. */
  async function attempt(steps: (() => unknown)[]) {
    const refused: number[] = [];
    for (const [index, step] of steps.entries())
      try {
        await step();
      } catch (error) {
        if (!(error instanceof ConflictError || error instanceof ValidationError)) throw error;
        refused.push(index);
      }
    return refused;
  }

  test("a promoted member never becomes the only administrator", async () => {
    const { ctx, founder, member, group, administer } = await scenario();
    let promotionId = 0;
    const refused = await attempt([
      () => administer("allow"),
      async () => {
        promotionId = (await createPromotion(ctx, founder, [group.id])).id;
      },
      () => evaluateMember(ctx, member.id),
      // Allowed only while someone else keeps admin.permissions.
      () => administer("unset", 4),
      () => execute(ctx, op("promotions.update"), founder, { promotionId, isActive: false }),
      () => evaluateMember(ctx, member.id),
    ]);
    expect(administrators(ctx).length).toBeGreaterThan(0);
    expect(refused).toContain(1);
  });

  test("nor when the group gets admin.permissions after the promotion exists", async () => {
    const { ctx, founder, member, group, administer } = await scenario();
    const promotion = await createPromotion(ctx, founder, [group.id]);
    evaluateMember(ctx, member.id);
    await expect(administer("allow")).rejects.toThrow(ConflictError);
    // Deleting the promotion removes its grants in a job; until then the group is still granted.
    await execute(ctx, op("promotions.delete"), founder, { promotionId: promotion.id });
    await expect(administer("allow")).rejects.toThrow(ConflictError);
    ctx.sqlite.run("DELETE FROM user_group_grants");
    await administer("allow");
    await expect(createPromotion(ctx, founder, [group.id])).rejects.toThrow(ValidationError);
    const other = await createGroup(ctx, founder, "Other", 5);
    const second = await createPromotion(ctx, founder, [other.id]);
    await expect(
      execute(ctx, op("promotions.update"), founder, {
        promotionId: second.id,
        groupIds: [other.id, group.id],
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("a promotion cannot take admin.permissions away from the last administrator", async () => {
    const { ctx, founder, founderUser, group, administer } = await scenario();
    const refused = await attempt([
      () => createPromotion(ctx, founder, [group.id]),
      () => administer("never"),
      () => evaluateMember(ctx, founderUser.id),
    ]);
    expect(administrators(ctx)).toEqual([founderUser.id]);
    expect(refused).toEqual([1]);
    const denied = await createGroup(ctx, founder, "Denied", 5);
    await administer("never", denied.id);
    await expect(createPromotion(ctx, founder, [denied.id])).rejects.toThrow(ValidationError);
  });

  test("applying by hand a promotion stored before the rule is refused", async () => {
    const { ctx, founder, member, group, administer } = await scenario();
    await administer("allow");
    const promotionId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO promotions (title, group_ids, criteria, created_at, updated_at) VALUES ('Old', ?1, '[]', 0, 0)",
        )
        .run(JSON.stringify([group.id])).lastInsertRowid,
    );
    const apply = (action: "promote" | "demote") =>
      execute(ctx, op("promotions.apply"), founder, { userId: member.id, promotionId, action });
    await expect(apply("promote")).rejects.toThrow(ConflictError);
    expect(administrators(ctx)).not.toContain(member.id);
    await apply("demote");
  });
});

describe("returning a member to automatic evaluation", () => {
  test("obeys the rank ceiling and the administration rule of promoting by hand", async () => {
    const ctx = createTestContext();
    const founder = userActor(insertUser(ctx, { groupId: 4 }));
    const staffGroup = await createGroup(ctx, founder, "Staff", 40);
    await execute(ctx, op("permissions.set"), founder, {
      groupId: staffGroup.id,
      entries: entries(["admin.promotions", "admin.members"], "allow"),
    });
    const staff = userActor(insertUser(ctx, { groupId: staffGroup.id }));
    const high = await createGroup(ctx, founder, "High", 60);
    const promotion = await createPromotion(ctx, founder, [high.id]);
    const member = insertUser(ctx);
    const apply = (actor: Actor, action: "exempt" | "reset", promotionId = promotion.id) =>
      execute(ctx, op("promotions.apply"), actor, { userId: member.id, promotionId, action });
    await apply(founder, "exempt");
    await expect(apply(staff, "reset")).rejects.toThrow(ForbiddenError);
    const earned = await createGroup(ctx, founder, "Earned", 20);
    await execute(ctx, op("permissions.set"), founder, {
      groupId: earned.id,
      entries: entries(["admin.permissions"], "allow"),
    });
    const stored = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO promotions (title, group_ids, criteria, created_at, updated_at) VALUES ('Old', ?1, '[]', 0, 0)",
        )
        .run(JSON.stringify([earned.id])).lastInsertRowid,
    );
    await expect(apply(founder, "reset", stored)).rejects.toThrow(ConflictError);
    expect(administrators(ctx)).not.toContain(member.id);
  });

  test("demoting by hand cannot remove the last administrator of a stored promotion", async () => {
    const ctx = createTestContext();
    const founderUser = insertUser(ctx, { groupId: 4 });
    const founder = userActor(founderUser);
    const member = insertUser(ctx);
    const earned = await createGroup(ctx, founder, "Earned", 20);
    const promotion = await createPromotion(ctx, founder, [earned.id]);
    evaluateMember(ctx, member.id);
    // The state a database from before the rule can hold.
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.permissions'",
      )
      .run(earned.id);
    await execute(ctx, op("permissions.set"), founder, {
      groupId: 4,
      entries: entries(["admin.permissions"], "unset"),
    });
    expect(administrators(ctx)).toEqual([member.id]);
    await expect(
      execute(ctx, op("promotions.apply"), founder, {
        userId: member.id,
        promotionId: promotion.id,
        action: "demote",
      }),
    ).rejects.toThrow(ConflictError);
    expect(administrators(ctx)).toEqual([member.id]);
  });
});
