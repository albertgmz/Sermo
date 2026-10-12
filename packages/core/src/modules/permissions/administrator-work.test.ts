import { describe, expect, spyOn, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ConflictError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can, permissionState } from "../../permissions";
import * as permissionChecks from "../../permissions/check";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { addWarning, banUser, resumeSpamCleanup } from "../moderation";
import { updateSiteSettings } from "../settings";
import { permissionsSetOp, usersSetGroupsOp } from "./index";

function scenario(administrator = false) {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx);
  if (administrator)
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 0, ?1, 1 FROM permission_definitions WHERE key = 'admin.permissions'",
      )
      .run(member.id);
  const unrelated: number[] = [];
  for (let i = 0; i < 12; i++) {
    const other = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 0, ?1, 1 FROM permission_definitions WHERE key = 'forum.reply'",
      )
      .run(other.id);
    unrelated.push(
      ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT permission_combination_id AS id FROM users WHERE id = ?1",
        )
        .get(other.id)!.id,
    );
  }
  const state = permissionState(ctx);
  // Cold combinations are filled in by the background precompute after this synchronous work.
  expect(state.combinations.size).toBe(0);
  const resolvedUnrelated = () => unrelated.filter((id) => state.combinations.has(id));
  return { ctx, admin, member, resolvedUnrelated };
}

describe("administrator guard work for one affected member", () => {
  for (const kind of ["permanent", "temporary", "spam", "warning"] as const)
    test(`a ${kind} ban of a non-administrator resolves no unrelated combinations`, () => {
      const { ctx, admin, member, resolvedUnrelated } = scenario();
      if (kind === "warning") {
        updateSiteSettings(ctx, admin, { warningBanThreshold: 1, warningBanDays: 2 });
        addWarning(ctx, admin, member.id, 1, "Rule");
      } else if (kind === "spam") resumeSpamCleanup(ctx, admin, member.id, null);
      else banUser(ctx, admin, member.id, "Rule", kind === "permanent" ? null : ctx.now() + 60_000);
      expect(resolvedUnrelated()).toEqual([]);
      expect(
        ctx.sqlite
          .prepare<{ banned: number }, [number, number]>(
            "SELECT banned_permanently OR banned_until > ?1 AS banned FROM users WHERE id = ?2",
          )
          .get(ctx.now(), member.id)?.banned,
      ).toBe(1);
    });

  test("changing a non-administrator's groups resolves no unrelated combinations", async () => {
    const { ctx, admin, member, resolvedUnrelated } = scenario();
    await execute(ctx, usersSetGroupsOp, admin, { userId: member.id, secondaryGroupIds: [3] });
    expect(resolvedUnrelated()).toEqual([]);
  });

  test("keeping an administrator's permission resolves no unrelated combinations", async () => {
    const { ctx, admin, member, resolvedUnrelated } = scenario(true);
    await execute(ctx, usersSetGroupsOp, admin, { userId: member.id, secondaryGroupIds: [3] });
    expect(resolvedUnrelated()).toEqual([]);
  });

  for (const administrator of [false, true])
    test(`setting a member's permission without removing administration (already administrator: ${administrator}) does not enumerate combinations`, async () => {
      const { ctx, admin, member } = scenario(administrator);
      const enumeration = spyOn(permissionChecks, "combinationsGranting");
      try {
        await execute(ctx, permissionsSetOp, admin, {
          userId: member.id,
          entries: [{ permission: "admin.permissions", value: administrator ? "allow" : "never" }],
        });
        expect(enumeration).not.toHaveBeenCalled();
        expect(can(ctx, userActor(member), "admin.permissions")).toBe(administrator);
      } finally {
        enumeration.mockRestore();
      }
    });

  test("applying a promotion to a non-administrator resolves no unrelated combinations", async () => {
    const { ctx, admin, member, resolvedUnrelated } = scenario();
    const promotionId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO promotions (title, criteria, group_ids, created_at, updated_at) VALUES ('Promotion', '[]', '[3]', ?1, ?1)",
        )
        .run(ctx.now()).lastInsertRowid,
    );
    await execute(ctx, getOperation("promotions.apply"), admin, {
      userId: member.id,
      promotionId,
      action: "promote",
    });
    expect(resolvedUnrelated()).toEqual([]);
  });

  test("clearing a stored promotion cannot remove the last administrator", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const groupId = Number(
      ctx.sqlite.prepare("INSERT INTO groups (title, rank) VALUES ('Earned', 20)").run()
        .lastInsertRowid,
    );
    const promotionId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO promotions (title, criteria, group_ids, created_at, updated_at) VALUES ('Cleared', '[]', '[]', ?1, ?1)",
        )
        .run(ctx.now()).lastInsertRowid,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, group_id, promotion_id, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .run(member.id, groupId, promotionId, ctx.now());
    // Legacy promotions may retain an administration group until the cleanup job removes it.
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.permissions'",
      )
      .run(groupId);
    await execute(ctx, permissionsSetOp, admin, {
      groupId: 4,
      entries: [{ permission: "admin.permissions", value: "unset" }],
    });
    await expect(
      execute(ctx, getOperation("promotions.apply"), admin, {
        userId: member.id,
        promotionId,
        action: "demote",
      }),
    ).rejects.toThrow(ConflictError);
    expect(can(ctx, userActor(member), "admin.permissions")).toBe(true);
  });

  test("a ban reloads a target made the last administrator by another process", async () => {
    const fixture = createTestContext();
    const founder = insertUser(fixture, { groupId: 4 });
    const member = insertUser(fixture);
    const database = sharedDatabase(fixture);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, founder.id);
      expect(can(here, resolvedActor(here, member.id), "admin.permissions")).toBe(false);
      await execute(elsewhere, permissionsSetOp, resolvedActor(elsewhere, founder.id), {
        userId: member.id,
        entries: [{ permission: "admin.permissions", value: "allow" }],
      });
      await execute(elsewhere, permissionsSetOp, resolvedActor(elsewhere, founder.id), {
        groupId: 4,
        entries: [{ permission: "admin.permissions", value: "unset" }],
      });
      expect(() => banUser(here, actor, member.id, "Rule", null)).toThrow(ConflictError);
      expect(can(here, resolvedActor(here, member.id), "admin.permissions")).toBe(true);
    } finally {
      database.close();
    }
  });
});
