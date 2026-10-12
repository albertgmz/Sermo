import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { insertCatalogImage } from "../appearance/catalog-fixtures";

const op = (name: string) => getOperation(name);

/**
 * A shop manager who gets `admin.shop` from a custom group. `here` is the manager's process
 * (actor resolved); `elsewhere` is another process, where the founder removes the manager from
 * the group.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const staffGroup = (await execute(fixture, op("groups.create"), founder, {
    title: "Shop managers",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: staffGroup.id,
    entries: [{ permission: "admin.shop", value: "allow" }],
  });
  const staff = insertUser(fixture, { groupId: staffGroup.id });
  const category = (await execute(fixture, op("shopCategories.create"), founder, {
    name: "Art",
  })) as { id: number };
  const item = (await execute(fixture, op("shopItems.create"), founder, {
    categoryId: category.id,
    name: "Badge",
    price: 5,
    effect: { type: "frame", frameId: insertCatalogImage(fixture, "frame") },
  })) as { id: number };
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const manager = resolvedActor(here, staff.id);
  expect(can(here, manager, "admin.shop")).toBe(true);
  return { database, here, elsewhere, founder, staff, manager, item };
}

test("images.setShopItemImage is refused to a manager revoked meanwhile", async () => {
  const s = await scenario();
  try {
    const input = { itemId: s.item.id, fileId: null };
    expect(await execute(s.here, op("images.setShopItemImage"), s.manager, input)).toBeNull();
    await execute(s.elsewhere, op("users.setGroups"), s.founder, {
      userId: s.staff.id,
      primaryGroupId: 2,
    });
    await expect(execute(s.here, op("images.setShopItemImage"), s.manager, input)).rejects.toThrow(
      ForbiddenError,
    );
  } finally {
    s.database.close();
  }
});
