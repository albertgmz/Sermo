import { expect, test } from "bun:test";
import { GROUP_IDS } from "../../db/schema";
import { ConflictError } from "../../errors";
import { execute, getOperation } from "../../index";
import { createTestContext, insertUser, userActor } from "../../testing";

function soldGroup(ctx: ReturnType<typeof createTestContext>): number {
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
  return groupId;
}

test("a group a shop item sells cannot be given admin.permissions", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const groupId = soldGroup(ctx);
  const set = (permission: string) =>
    execute(ctx, getOperation("permissions.set"), admin, {
      groupId,
      entries: [{ permission, value: "allow" }],
    });
  await expect(set("admin.permissions")).rejects.toBeInstanceOf(ConflictError);
  await set("search.use");
});

test("a group a shop item sells cannot be deleted", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const groupId = soldGroup(ctx);
  await expect(
    execute(ctx, getOperation("groups.delete"), admin, { groupId }),
  ).rejects.toBeInstanceOf(ConflictError);
  ctx.sqlite.run("DELETE FROM shop_items");
  await execute(ctx, getOperation("groups.delete"), admin, { groupId });
});
