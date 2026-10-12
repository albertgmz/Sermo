import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { ADMIN_PERMISSIONS } from "../auth/staff";
import { rosterSql } from "./rosters";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
type Run = (name: string, actor: object, input?: object) => Promise<any>;

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const run: Run = (name, actor, input = {}) =>
    execute(ctx, getOperation(name), actor as never, input);
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const root = insertNode(ctx, { title: "Root", type: "category" });
  const one = insertNode(ctx, { title: "One", type: "forum", parentId: root.id });
  const two = insertNode(ctx, { title: "Two", type: "forum", parentId: root.id });
  invalidate(ctx, "node_tree");
  const group = async (title: string, rank = 20) => {
    const created = await run("groups.create", userActor(founder), { title, rank });
    await run("permissions.set", userActor(founder), {
      groupId: created.id,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    return created.id as number;
  };
  const grant = (
    target: { groupId: number } | { userId: number },
    permission: string,
    nodeId?: number,
  ) =>
    run("permissions.set", userActor(founder), {
      ...target,
      ...(nodeId === undefined ? {} : { nodeId }),
      entries: [{ permission, value: "allow" }],
    });
  return { ctx, run, founder, root, one, two, group, grant };
}

describe("staff.moderators", () => {
  test("lists who moderates what, by username, from groups and from members", async () => {
    const w = await world();
    const helpers = await w.group("Helpers");
    await w.grant({ groupId: helpers }, "forum.lock", w.one.id);
    insertUser(w.ctx, { groupId: helpers, username: "Zed" });
    const secondary = insertUser(w.ctx, { username: "Amy" });
    await w.run("users.setGroups", userActor(w.founder), {
      userId: secondary.id,
      secondaryGroupIds: [helpers],
    });
    const own = insertUser(w.ctx, { username: "Bob" });
    await w.grant({ userId: own.id }, "forum.approve", w.two.id);
    insertUser(w.ctx, { groupId: 3, username: "Global" });
    insertUser(w.ctx, { username: "Nobody" });

    const { items } = await w.run("staff.moderators", userActor(w.founder));
    const summary = items.map(
      (item: { card: { username: string }; everywhere: boolean; nodes: { id: number }[] }) => [
        item.card.username,
        item.everywhere,
        item.nodes.map((node) => node.id),
      ],
    );
    // The administrator moderates everywhere by default, like the global moderator.
    expect(summary).toEqual([
      ["Amy", false, [w.one.id]],
      ["Bob", false, [w.two.id]],
      ["Founder", true, []],
      ["Global", true, []],
      ["Zed", false, [w.one.id]],
    ]);
    expect(items[0].nodes[0].title).toBe("One");
  });

  test("a member whose grant is taken back, or who is banned, is not listed", async () => {
    const w = await world();
    const helpers = await w.group("Helpers");
    await w.grant({ groupId: helpers }, "forum.lock", w.one.id);
    const kept = insertUser(w.ctx, { groupId: helpers, username: "Kept" });
    const denied = insertUser(w.ctx, { groupId: helpers, username: "Denied" });
    const banned = insertUser(w.ctx, { groupId: helpers, username: "Banned" });
    await w.run("permissions.set", userActor(w.founder), {
      userId: denied.id,
      nodeId: w.one.id,
      entries: [{ permission: "forum.lock", value: "never" }],
    });
    await w.run("bans.create", userActor(w.founder), {
      userId: banned.id,
      reason: "Rule",
      expiresAt: null,
    });
    const names = (await w.run("staff.moderators", userActor(w.founder))).items.map(
      (item: { card: { username: string } }) => item.card.username,
    );
    expect(names).toContain(userNameOf(w, kept.id));
    expect(names).not.toContain("Denied");
    expect(names).not.toContain("Banned");
  });

  test("lists at most 200", async () => {
    const w = await world();
    for (let i = 0; i < 205; i++)
      insertUser(w.ctx, { groupId: 3, username: `Mod ${String(i).padStart(3, "0")}` });
    const { items } = await w.run("staff.moderators", userActor(w.founder));
    expect(items).toHaveLength(200);
    expect(items[0].card.username).toBe("Founder");
  });

  test("requires admin.permissions", async () => {
    const w = await world();
    const moderator = insertUser(w.ctx, { groupId: 3 });
    await expect(w.run("staff.moderators", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(w.run("staff.moderators", userActor(insertUser(w.ctx)))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(w.run("staff.moderators", userActor(moderator))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const partial = insertUser(w.ctx);
    await w.grant({ userId: partial.id }, "admin.groups");
    await expect(w.run("staff.moderators", userActor(partial))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await w.grant({ userId: partial.id }, "admin.permissions");
    await w.run("staff.moderators", userActor(partial));
    await w.run("staff.moderators", tokenActor(w.founder));
  });
});

const userNameOf = (w: { ctx: ReturnType<typeof createTestContext> }, id: number) =>
  w.ctx.sqlite
    .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
    .get(id)!.username;

describe("staff.administrators", () => {
  test("lists who holds administration permissions and which, by username", async () => {
    const w = await world();
    const partial = insertUser(w.ctx, { username: "Announcer" });
    await w.grant({ userId: partial.id }, "admin.announcements");
    await w.grant({ userId: partial.id }, "admin.shop");
    const groupId = await w.group("Settings staff");
    await w.grant({ groupId }, "admin.settings");
    insertUser(w.ctx, { groupId, username: "Configurer" });
    insertUser(w.ctx, { groupId: 3, username: "Moderator" });
    insertUser(w.ctx, { username: "Plain" });

    const { items } = await w.run("staff.administrators", userActor(w.founder));
    expect(items.map((item: { card: { username: string } }) => item.card.username)).toEqual([
      "Announcer",
      "Configurer",
      "Founder",
    ]);
    expect(items[0].permissions.sort()).toEqual(["admin.announcements", "admin.shop"]);
    expect(items[1].permissions).toEqual(["admin.settings"]);
    expect(items[2].permissions.sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });

  test("a banned administrator is not listed; requires admin.permissions", async () => {
    const w = await world();
    const second = insertUser(w.ctx, { groupId: 4, username: "Second" });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(second.id);
    expect(
      (await w.run("staff.administrators", userActor(w.founder))).items.map(
        (item: { card: { username: string } }) => item.card.username,
      ),
    ).toEqual(["Founder"]);
    await expect(w.run("staff.administrators", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      w.run("staff.administrators", userActor(insertUser(w.ctx, { groupId: 3 }))),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.run("staff.administrators", tokenActor(w.founder));
  });
});

describe("rosters and large groups", () => {
  test("a large group does not crowd out a small one, and the cut is reported", async () => {
    const w = await world();
    const big = await w.group("Big");
    const small = await w.group("Small");
    await w.grant({ groupId: big }, "forum.lock", w.one.id);
    await w.grant({ groupId: small }, "forum.lock", w.two.id);
    for (let i = 0; i < 230; i++)
      insertUser(w.ctx, { groupId: big, username: `Big ${String(i).padStart(3, "0")}` });
    insertUser(w.ctx, { groupId: small, username: "Aaa Small" });
    const result = await w.run("staff.moderators", userActor(w.founder));
    const names = result.items.map((item: { card: { username: string } }) => item.card.username);
    expect(names).toContain("Aaa Small");
    expect(names).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  test("says so when a group was read only in part, even if few of those read hold the permission", async () => {
    const w = await world();
    const big = await w.group("Big");
    await w.grant({ groupId: big }, "forum.lock", w.one.id);
    for (let i = 0; i < 230; i++) insertUser(w.ctx, { groupId: big, username: `Gone ${i}` });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE group_id = ?1").run(big);
    const result = await w.run("staff.moderators", userActor(w.founder));
    expect(result.items.map((item: { card: { username: string } }) => item.card.username)).toEqual([
      "Founder",
    ]);
    expect(result.truncated).toBe(true);
  });

  test("reports nothing cut when every holder is listed", async () => {
    const w = await world();
    const helpers = await w.group("Helpers");
    await w.grant({ groupId: helpers }, "forum.lock", w.one.id);
    insertUser(w.ctx, { groupId: helpers, username: "Only" });
    expect((await w.run("staff.moderators", userActor(w.founder))).truncated).toBe(false);
    expect((await w.run("staff.administrators", userActor(w.founder))).truncated).toBe(false);
  });

  test("the administrator roster is cut by username too, and says so", async () => {
    const w = await world();
    const stewards = await w.group("Stewards");
    await w.grant({ groupId: stewards }, "admin.announcements");
    for (let i = 0; i < 205; i++)
      insertUser(w.ctx, { groupId: stewards, username: `Steward ${String(i).padStart(3, "0")}` });
    const result = await w.run("staff.administrators", userActor(w.founder));
    expect(result.items).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  test("each group is read through its membership index", async () => {
    const w = await world();
    const sources = [
      ["users", "id"],
      ["user_groups", "user_id"],
      ["user_group_grants", "user_id"],
      ["shop_group_grants", "user_id"],
    ] as const;
    for (const [table, column] of sources)
      expectNoTableScan(w.ctx, rosterSql.members(table, column), [1]);
  });
});
