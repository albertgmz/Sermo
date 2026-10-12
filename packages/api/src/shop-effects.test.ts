import { afterEach, expect, test } from "bun:test";
import { contracts as c } from "@sermo/core";
import {
  insertCatalogImage,
  insertPaletteColor,
} from "../../core/src/modules/appearance/catalog-fixtures";
import { cleanupEconomy, error, setup, success } from "./economy-fixtures.test";

afterEach(cleanupEconomy);

const origin = "http://localhost:3000";

test("the shop's effects work end to end over HTTP", async () => {
  const f = await setup();
  await f.api(
    c.creditsAdjust,
    "POST",
    `/users/${f.member.id}/credits`,
    f.admin.auth,
    { amount: 500, reason: "Budget" },
    201,
  );
  const category = await f.category();
  const frameId = insertCatalogImage(f.ctx, "frame");
  const colorId = insertPaletteColor(f.ctx);
  const frameItem = await f.item(category.id, {
    effect: { type: "frame", frameId },
  });
  const colorItem = await f.item(category.id, {
    effect: { type: "nameColor", colorId },
  });

  // Nothing is held, so nothing can be worn.
  const empty = await success(f.send("GET", "/appearance", f.member.auth), c.appearanceGet.output);
  expect(empty).toMatchObject({ frameId: null, available: { frames: [], nameColors: [] } });
  await error(f.send("PUT", "/appearance", f.member.auth, { frameId }), 403, "forbidden");
  await error(f.send("GET", "/appearance"), 401, "unauthenticated");

  for (const item of [frameItem, colorItem])
    await f.api(c.shopBuy, "POST", `/shop/items/${item.id}/buy`, f.member.auth, {}, 201);
  const worn = await success(
    f.send("PUT", "/appearance", f.member.auth, { frameId, nameColorId: colorId }),
    c.appearanceSet.output,
  );
  expect(worn).toMatchObject({ frameId, nameColorId: colorId });
  const cards = await success(
    f.send("GET", `/member-cards?userIds=${f.member.id}`, {}),
    c.usersCards.output,
  );
  expect(cards.items[0]).toMatchObject({ nameColor: "#336699" });
  expect(cards.items[0]!.frame).not.toBeNull();

  // A frame is worn, not used.
  const inventory = await f.api(
    c.shopInventory,
    "GET",
    "/shop/inventory?state=active",
    f.member.auth,
  );
  const frameRow = inventory.items.find((row) => row.item.id === frameItem.id)!;
  await error(
    f.send("POST", `/shop/inventory/${frameRow.id}/use`, f.member.auth, {}),
    409,
    "conflict",
  );
});

test("a username changes only through PUT /profile/username", async () => {
  const f = await setup();
  const category = await f.category();
  const rename = await f.item(category.id, {
    isConsumable: true,
    price: 5,
    effect: { type: "usernameChange" },
  });
  await f.api(
    c.creditsAdjust,
    "POST",
    `/users/${f.member.id}/credits`,
    f.admin.auth,
    { amount: 50, reason: "Budget" },
    201,
  );
  const usernameOf = (id: number) =>
    f.ctx.sqlite
      .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
      .get(id)!.username;
  const identityOf = (id: number) =>
    f.ctx.sqlite
      .prepare<{ username: string; display_username: string }, [number]>(
        "SELECT username, display_username FROM auth_user WHERE id = ?1",
      )
      .get(id)!;
  const direct = (body: object) =>
    f.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", ...f.member.cookieAuth },
      body: JSON.stringify(body),
    });

  // Better Auth's own endpoint no longer renames, with or without units.
  await f.api(c.shopBuy, "POST", `/shop/items/${rename.id}/buy`, f.member.auth, {}, 201);
  for (const body of [{ username: "sneaky" }, { displayUsername: "MEMBER" }]) {
    const response = await direct(body);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "USERNAME_CHANGE_NOT_ALLOWED" });
  }
  expect(usernameOf(f.member.id)).toBe("member");
  expect(identityOf(f.member.id)).toEqual({ username: "member", display_username: "member" });
  // Other profile fields keep working through it.
  expect((await direct({ name: "Member Name" })).status).toBe(200);

  // Without a unit the operation refuses; with one it renames and keeps both stores in step.
  await error(
    f.send("PUT", "/profile/username", f.other.auth, { username: "Another Name" }),
    409,
    "conflict",
  );
  await error(
    f.send("PUT", "/profile/username", f.member.auth, { username: "admin" }),
    409,
    "conflict",
  );
  await error(
    f.send("PUT", "/profile/username", f.member.auth, { username: "no/way" }),
    400,
    "validation",
  );
  const changed = await success(
    f.send("PUT", "/profile/username", f.member.auth, { username: "Renamed Member" }),
    c.usersChangeUsername.output,
  );
  expect(changed).toEqual({ username: "Renamed Member", remaining: 0 });
  expect(usernameOf(f.member.id)).toBe("Renamed Member");
  expect(identityOf(f.member.id)).toEqual({
    username: "renamed member",
    display_username: "Renamed Member",
  });
  const card = await success(
    f.send("GET", `/member-cards?userIds=${f.member.id}`, f.member.auth),
    c.usersCards.output,
  );
  expect(card.items[0]!.username).toBe("Renamed Member");

  // The new name signs in; a guest cannot rename at all.
  const signIn = await f.request("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username: "Renamed Member", password: "Password123!" }),
  });
  expect(signIn.status).toBe(200);
  await error(
    f.send("PUT", "/profile/username", {}, { username: "Guest Name" }),
    401,
    "unauthenticated",
  );
  // An administrator holds profile.renameFree and pays nothing.
  expect(
    await success(
      f.send("PUT", "/profile/username", f.admin.auth, { username: "The Admin" }),
      c.usersChangeUsername.output,
    ),
  ).toEqual({ username: "The Admin", remaining: null });
});

test("threads.removeCover is routed and /appearance does not shadow the catalog routes", async () => {
  const f = await setup();
  const guestCatalog = await f.send("GET", "/appearance/images?kind=frame", {});
  expect(guestCatalog.status).toBe(200);
  const colors = await f.send("GET", "/appearance/colors?kind=accent", {});
  expect(colors.status).toBe(200);
  await error(f.send("DELETE", "/threads/999999/cover", f.member.auth), 404, "not_found");
  await error(f.send("DELETE", "/threads/999999/cover", {}), 401, "unauthenticated");
});
