import { expect, test } from "bun:test";
import type { Ctx } from "../context";
import { GROUP_IDS } from "../db/schema";
import { writeTx } from "../db/tx";
import { ConflictError, ValidationError } from "../errors";
import { execute } from "../operation";
import { getOperation } from "../operations";
import { createTestContext, insertUser, userActor } from "../testing";
import { can, grantPurchased, validatePurchasedGrant } from ".";

function groupDenyingAdministration(ctx: Ctx): number {
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Patrons', 5) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, -1 FROM permission_definitions WHERE key = 'admin.permissions'",
    )
    .run(groupId);
  return groupId;
}

test("a group that denies admin.permissions cannot be sold or bought", () => {
  const ctx = createTestContext();
  const founder = insertUser(ctx, { groupId: GROUP_IDS.admin });
  const groupId = groupDenyingAdministration(ctx);
  expect(() => validatePurchasedGrant(ctx, { type: "group", groupId })).toThrow(ValidationError);
  // Bought, it would take admin.permissions from the only administrator.
  expect(() =>
    writeTx(ctx, () => grantPurchased(ctx, founder.id, 1, { type: "group", groupId })),
  ).toThrow(ConflictError);
  expect(can(ctx, userActor(founder), "admin.permissions")).toBe(true);
});

test("a group a shop item sells cannot be made to deny admin.permissions", async () => {
  const ctx = createTestContext();
  const founder = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const groupId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Patrons', 5) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite.run(
    "INSERT INTO shop_categories (id, name, created_at, updated_at) VALUES (1, 'Ranks', 0, 0)",
  );
  ctx.sqlite
    .prepare(
      "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (1, 'Patron', 10, ?1, 0, 0)",
    )
    .run(JSON.stringify({ type: "group", groupId }));
  await expect(
    execute(ctx, getOperation("permissions.set"), founder, {
      groupId,
      entries: [{ permission: "admin.permissions", value: "never" }],
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});
