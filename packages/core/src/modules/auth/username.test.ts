import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { moveCredits } from "../../shared/credits";
import { getAuth } from "./index";
import { renameStanding } from "./rename-limit";
import { asUsernameChange } from "./rename-marker";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  const memberRow = insertUser(ctx, { username: "Member" });
  const member = userActor(memberRow);
  writeTx(ctx, () =>
    moveCredits(ctx, [{ userId: memberRow.id, amount: 1000, type: "adjustment" }]),
  );
  // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
  const run = (name: string, actor: object, input: object = {}): Promise<any> =>
    execute(ctx, getOperation(name), actor as never, input);
  const category = await run("shopCategories.create", userActor(admin), { name: "Names" });
  const renameItem = await run("shopItems.create", userActor(admin), {
    categoryId: category.id,
    name: "Rename",
    price: 10,
    isConsumable: true,
    effect: { type: "usernameChange" },
  });
  const buyUnits = (quantity: number, as: object = member) =>
    run("shop.buy", as, { itemId: renameItem.id, quantity });
  const rename = (username: string, as: object = member) =>
    run("users.changeUsername", as, { username });
  const stored = (id = memberRow.id) => ({
    forum: ctx.sqlite.prepare("SELECT username, username_key FROM users WHERE id = ?1").get(id) as {
      username: string;
      username_key: string;
    },
    identity: ctx.sqlite
      .prepare("SELECT username, display_username FROM auth_user WHERE id = ?1")
      .get(id) as { username: string; display_username: string },
  });
  const units = () =>
    ctx.sqlite
      .prepare("SELECT quantity, state FROM shop_inventory WHERE user_id = ?1")
      .all(memberRow.id);
  return { ctx, admin, memberRow, member, run, buyUnits, rename, stored, units };
}

const changedAt = (w: { ctx: ReturnType<typeof createTestContext> }, id: number) =>
  w.ctx.sqlite
    .prepare<{ at: number | null }, [number]>(
      "SELECT username_changed_at AS at FROM users WHERE id = ?1",
    )
    .get(id)!.at;

describe("users.changeUsername", () => {
  test("a unit pays for one change, and the forum and Better Auth both follow", async () => {
    const w = await world();
    await w.buyUnits(2);
    w.ctx.clock.advance(1000);
    expect(changedAt(w, w.memberRow.id)).toBeNull();
    expect(await w.rename("Fresh Name")).toEqual({ username: "Fresh Name", remaining: 1 });
    expect(changedAt(w, w.memberRow.id)).toBe(w.ctx.now());
    expect(w.stored()).toEqual({
      forum: { username: "Fresh Name", username_key: "fresh name" },
      identity: { username: "fresh name", display_username: "Fresh Name" },
    });
    expect(
      w.ctx.sqlite
        .prepare<{ content_updated_at: number }, [number]>(
          "SELECT content_updated_at FROM users WHERE id = ?1",
        )
        .get(w.memberRow.id)!.content_updated_at,
    ).toBe(w.ctx.now());
    expect(
      w.ctx.sqlite
        .prepare(
          "SELECT 1 FROM domain_events WHERE type = 'content.edited' AND target_type = 'profile' AND target_id = ?1 AND created_at = ?2",
        )
        .get(w.memberRow.id, w.ctx.now()),
    ).not.toBeNull();
    expect(w.units()).toEqual([{ quantity: 1, state: "unused" }]);
    const [card] = (await w.run("users.cards", GUEST, { userIds: [w.memberRow.id] })).items;
    expect(card.username).toBe("Fresh Name");
    expect(await w.rename("Last Name")).toEqual({ username: "Last Name", remaining: 0 });
    expect(w.units()).toEqual([{ quantity: 0, state: "used" }]);
    await expect(w.rename("One Too Many")).rejects.toBeInstanceOf(ConflictError);
    expect(w.stored().forum.username).toBe("Last Name");
  });

  test("a change in case only is allowed and costs a unit", async () => {
    const w = await world();
    await w.buyUnits(1);
    expect(await w.rename("MEMBER")).toEqual({ username: "MEMBER", remaining: 0 });
    expect(w.stored()).toEqual({
      forum: { username: "MEMBER", username_key: "member" },
      identity: { username: "member", display_username: "MEMBER" },
    });
  });

  test("the oldest row is spent first", async () => {
    const w = await world();
    await w.buyUnits(1);
    const second = await w.run("shopItems.create", userActor(w.admin), {
      categoryId: (await w.run("shopCategories.create", userActor(w.admin), { name: "More" })).id,
      name: "Rename again",
      price: 10,
      isConsumable: true,
      effect: { type: "usernameChange" },
    });
    w.ctx.clock.advance(1000);
    await w.run("shop.buy", w.member, { itemId: second.id, quantity: 3 });
    expect(await w.rename("Oldest First")).toMatchObject({ remaining: 3 });
    expect(w.units()).toEqual([
      { quantity: 0, state: "used" },
      { quantity: 3, state: "unused" },
    ]);
  });

  test("holders of profile.renameFree pay nothing", async () => {
    const w = await world();
    const staff = insertUser(w.ctx, { groupId: 3, username: "Mod One" });
    expect(await w.rename("Mod Two", userActor(staff))).toEqual({
      username: "Mod Two",
      remaining: null,
    });
    // A member granted the permission is free from then on.
    await w.run("permissions.set", userActor(w.admin), {
      userId: w.memberRow.id,
      entries: [{ permission: "profile.renameFree", value: "allow" }],
    });
    expect(await w.rename("Free Member")).toEqual({ username: "Free Member", remaining: null });
    expect(w.units()).toEqual([]);
  });

  test("a name is checked before anything is spent", async () => {
    const w = await world();
    await w.buyUnits(2);
    const before = w.units();
    const taken = insertUser(w.ctx, { username: "Taken Name" });
    for (const [name, error] of [
      ["TAKEN NAME", ConflictError],
      ["taken name", ConflictError],
      ["Member", ValidationError],
      ["ab", ValidationError],
      ["x".repeat(33), ValidationError],
      [".dotted", ValidationError],
      ["trailing.", ValidationError],
      ["bad/name", ValidationError],
      ["İpek", ValidationError],
    ] as const)
      await expect(w.rename(name), name).rejects.toBeInstanceOf(error);
    expect(w.units()).toEqual(before);
    expect(w.stored().forum.username).toBe("Member");
    expect(w.stored(taken.id).forum.username).toBe("Taken Name");
    expect(changedAt(w, w.memberRow.id)).toBeNull();
    // Unicode letters follow the registration rule.
    expect(await w.rename("Éloïse")).toMatchObject({ username: "Éloïse" });
  });

  test("without a unit it is a conflict, and a unit of another item does not count", async () => {
    const w = await world();
    await expect(w.rename("Nothing Owned")).rejects.toBeInstanceOf(ConflictError);
    const bump = await w.run("shopItems.create", userActor(w.admin), {
      categoryId: (await w.run("shopCategories.create", userActor(w.admin), { name: "Bumps" })).id,
      name: "Bump",
      price: 1,
      isConsumable: true,
      effect: { type: "bump" },
    });
    await w.run("shop.buy", w.member, { itemId: bump.id, quantity: 2 });
    await expect(w.rename("Nothing Owned")).rejects.toBeInstanceOf(ConflictError);
    expect(w.stored().forum.username).toBe("Member");
  });

  test("guests, unconfirmed members and members without a profile are refused", async () => {
    const w = await world();
    await expect(w.rename("Some Name", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    const unconfirmed = insertUser(w.ctx, { groupId: 5 });
    await expect(w.rename("Some Name", userActor(unconfirmed))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("two requests with one unit spend it once", async () => {
    const w = await world();
    await w.buyUnits(1);
    const results = await Promise.allSettled([w.rename("First Try"), w.rename("Second Try")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ConflictError);
    expect(w.units()).toEqual([{ quantity: 0, state: "used" }]);
    expect(["First Try", "Second Try"]).toContain(w.stored().forum.username);
  });

  test("a change Better Auth then refuses gives the unit back", async () => {
    const w = await world();
    await w.buyUnits(1);
    // The name was free when checked and taken by the time Better Auth looks.
    w.ctx.sqlite.run(
      "CREATE TRIGGER reject_forum_update BEFORE UPDATE OF username_key ON users WHEN NEW.username_key = 'raced name' BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: users.username_key'); END",
    );
    await expect(w.rename("Raced Name")).rejects.toBeInstanceOf(ConflictError);
    expect(w.units()).toEqual([{ quantity: 1, state: "unused" }]);
    w.ctx.sqlite.run("DROP TRIGGER reject_forum_update");
    w.ctx.sqlite.run(
      "CREATE TRIGGER reject_identity_update BEFORE UPDATE OF username ON auth_user BEGIN SELECT RAISE(ABORT, 'identity store is down'); END",
    );
    await expect(w.rename("Other Name")).rejects.toThrow(/identity store is down/);
    expect(w.units()).toEqual([{ quantity: 1, state: "unused" }]);
    w.ctx.sqlite.run("DROP TRIGGER reject_identity_update");
    expect(await w.rename("Other Name")).toMatchObject({ username: "Other Name", remaining: 0 });
  });
});

describe("a change that fails after Better Auth accepted the name", () => {
  test("Better Auth gets the old name back and the unit is returned", async () => {
    const w = await world();
    await w.buyUnits(1);
    w.ctx.sqlite.run(
      "CREATE TRIGGER reject_forum_update BEFORE UPDATE OF username_key ON users WHEN NEW.username_key = 'half done' BEGIN SELECT RAISE(ABORT, 'forum store is down'); END",
    );
    await expect(w.rename("Half Done")).rejects.toThrow(/forum store is down/);
    expect(w.stored()).toEqual({
      forum: { username: "Member", username_key: "member" },
      identity: { username: "member", display_username: "Member" },
    });
    expect(w.units()).toEqual([{ quantity: 1, state: "unused" }]);
  });

  test("when the old name cannot be put back, the unit stays spent and the mismatch is logged", async () => {
    const w = await world();
    await w.buyUnits(1);
    // The forum refuses every username write, so neither the change nor the restore can land.
    w.ctx.sqlite.run(
      "CREATE TRIGGER reject_forum_update BEFORE UPDATE OF username_key ON users BEGIN SELECT RAISE(ABORT, 'forum store is down'); END",
    );
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(w.rename("Half Done")).rejects.toThrow(/forum store is down/);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]![0]).toBe("[users.renameInconsistent]");
    } finally {
      logged.mockRestore();
    }
    expect(w.units()).toEqual([{ quantity: 0, state: "used" }]);
    expect(w.stored().forum.username).toBe("Member");
  });
});

describe("Better Auth's own update endpoint no longer renames", () => {
  async function signedIn() {
    const w = await world();
    const registered = await getAuth(w.ctx).api.signUpEmail({
      asResponse: true,
      body: {
        name: "Direct",
        username: "Direct_1",
        email: "direct@example.test",
        password: "password123",
      },
    });
    const cookie = registered.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const id = Number(((await registered.json()) as { user: { id: string } }).user.id);
    return {
      w,
      cookie,
      id,
      update: (body: object) =>
        getAuth(w.ctx).api.updateUser({ headers: new Headers({ cookie }), body }),
    };
  }

  test("a username or display username sent directly is refused, other fields still work", async () => {
    const { w, id, update } = await signedIn();
    for (const body of [
      { username: "Direct_2" },
      { displayUsername: "DIRECT_1" },
      { username: "Direct_2", displayUsername: "Direct_2" },
    ])
      await expect(update(body)).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "USERNAME_CHANGE_NOT_ALLOWED" },
      });
    expect(w.stored(id)).toEqual({
      forum: { username: "Direct_1", username_key: "direct_1" },
      identity: { username: "direct_1", display_username: "Direct_1" },
    });
    await expect(update({ name: "A new display name" })).resolves.toMatchObject({ status: true });
    expect(w.ctx.sqlite.prepare("SELECT name FROM auth_user WHERE id = ?1").get(id)).toEqual({
      name: "A new display name",
    });
  });

  test("only a call made as the member's username change is accepted", async () => {
    const { w, id, update } = await signedIn();
    await asUsernameChange(id, () => update({ username: "Direct_2" }));
    expect(w.stored(id).forum).toEqual({ username: "Direct_2", username_key: "direct_2" });
    await expect(update({ username: "Direct_3" })).rejects.toMatchObject({ statusCode: 403 });
    expect(w.stored(id).forum.username).toBe("Direct_2");
  });
});

describe("username change permissions", () => {
  const DAY = 86_400_000;
  const entry = (w: Awaited<ReturnType<typeof world>>, key: string, value: number) => {
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 2, 0, ?1 FROM permission_definitions WHERE key = ?2 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
      )
      .run(value, key);
    w.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
  };
  const recorded = (w: Awaited<ReturnType<typeof world>>) =>
    w.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM username_changes WHERE user_id = ?1",
      )
      .get(w.memberRow.id)!.n;

  test("a group that needs approval is told to ask staff and keeps its name and units", async () => {
    const w = await world();
    await w.buyUnits(1);
    entry(w, "profile.renameNeedsApproval", 1);
    const error = await w.rename("Another").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toContain("Ask a staff member");
    expect(w.stored().forum.username).toBe("Member");
    expect(w.units()).toEqual([{ quantity: 1, state: "unused" }]);
    expect(recorded(w)).toBe(0);
    const self = await w.run("profiles.self", w.member);
    expect(self.usernameChange).toEqual({ reason: "approval", availableAt: null });
    // Lifting the permission lets the change through.
    entry(w, "profile.renameNeedsApproval", 0);
    expect(await w.rename("Another")).toMatchObject({ username: "Another" });
  });

  test("N changes per X days: counted per change, freed by the window, refused with the date", async () => {
    const w = await world();
    await w.buyUnits(5);
    entry(w, "profile.renameLimit", 2);
    entry(w, "profile.renameWindowDays", 30);
    const start = w.ctx.now();
    await w.rename("First One");
    w.ctx.clock.advance(DAY);
    await w.rename("Second One");
    expect(recorded(w)).toBe(2);
    w.ctx.clock.advance(DAY);
    const error = await w.rename("Third One").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toContain(new Date(start + 30 * DAY).toISOString());
    expect(w.stored().forum.username).toBe("Second One");
    expect(w.units()).toEqual([{ quantity: 3, state: "unused" }]);
    const self = await w.run("profiles.self", w.member);
    expect(self.usernameChange).toEqual({
      reason: "limit",
      availableAt: new Date(start + 30 * DAY).toISOString(),
    });
    // The first change leaves the window; one slot is free again, not two.
    w.ctx.clock.set(start + 30 * DAY + 1);
    await w.rename("Third One");
    await expect(w.rename("Fourth One")).rejects.toThrow(ForbiddenError);
  });

  test("a failed rename is not counted, and 0 or -1 for the window counts every change; -1 limit is none", async () => {
    const w = await world();
    await w.buyUnits(5);
    entry(w, "profile.renameLimit", 1);
    entry(w, "profile.renameWindowDays", 0);
    insertUser(w.ctx, { username: "Taken Name" });
    await expect(w.rename("Taken Name")).rejects.toThrow(ConflictError);
    expect(recorded(w)).toBe(0);
    await w.rename("Free Name");
    w.ctx.clock.advance(3650 * DAY);
    const error = await w.rename("Later Name").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toContain("all the username changes");
    // -1 is unlimited; 0 allows none.
    entry(w, "profile.renameLimit", -1);
    await w.rename("Name B");
    entry(w, "profile.renameLimit", 0);
    await expect(w.rename("Name C")).rejects.toThrow(ForbiddenError);
  });

  test("of two windows the longer applies, 0 counting as unset", async () => {
    const w = await world();
    await w.buyUnits(5);
    w.ctx.sqlite.prepare("INSERT INTO groups (id, title, rank) VALUES (92, 'Windows', 10)").run();
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 92, 0)")
      .run(w.memberRow.id);
    const second = (value: number) => {
      w.ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 92, 0, ?1 FROM permission_definitions WHERE key = 'profile.renameWindowDays' ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
        )
        .run(value);
      w.ctx.sqlite
        .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
        .run();
    };
    entry(w, "profile.renameLimit", 1);
    // 0 alone counts every change ever.
    entry(w, "profile.renameWindowDays", 0);
    second(0);
    await w.rename("One");
    w.ctx.clock.advance(100 * DAY);
    await expect(w.rename("Two")).rejects.toThrow(ForbiddenError);
    // Another group's 30 days overrides the 0: the change 100 days ago is outside the window.
    second(30);
    await w.rename("Two");
    // -1 in either group counts every change ever.
    second(-1);
    await expect(w.rename("Three")).rejects.toThrow(ForbiddenError);
  });

  test("of a member's groups the highest limit wins, and a banned member can change nothing", async () => {
    const w = await world();
    await w.buyUnits(5);
    w.ctx.sqlite.prepare("INSERT INTO groups (id, title, rank) VALUES (91, 'Other', 10)").run();
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 91, 0)")
      .run(w.memberRow.id);
    const second = (key: string, value: number) => {
      w.ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 91, 0, ?1 FROM permission_definitions WHERE key = ?2 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
        )
        .run(value, key);
      w.ctx.sqlite
        .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
        .run();
    };
    entry(w, "profile.renameLimit", 0);
    second("profile.renameLimit", 0);
    await expect(w.rename("One")).rejects.toThrow(ForbiddenError);
    second("profile.renameLimit", 1);
    entry(w, "profile.renameWindowDays", 30);
    await w.rename("One");
    await expect(w.rename("Two")).rejects.toThrow(ForbiddenError);
    second("profile.renameLimit", -1);
    await w.rename("Two");
    await w.rename("Three");
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1")
      .run(w.memberRow.id);
    expect(renameStanding(w.ctx, w.member, w.memberRow.id).reason).toBe("limit");
  });
});
