import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";
import { countStatements } from "../feed/fixtures.test";
import { GLOBAL_STAFF, NODE_MODERATION, NON_ACTING_STAFF } from "./staff";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
type Run = (name: string, actor: object, input?: object) => Promise<any>;

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const run: Run = (name, actor, input = {}) =>
    execute(ctx, getOperation(name), actor as never, input);
  const founder = userActor(insertUser(ctx, { groupId: 4, username: "Founder" }));
  const node = (title: string, parentId: number | null, type: "category" | "forum") => {
    const row = insertNode(ctx, { title, parentId, type });
    invalidate(ctx, "node_tree");
    return row.id;
  };
  const category = (title: string) => node(title, null, "category");
  const forum = (title: string, parentId: number | null = null) => node(title, parentId, "forum");
  const me = (userId: number) => run("auth.me", resolvedActor(ctx, userId));
  const group = async (title: string, rank: number) =>
    (await run("groups.create", founder, { title, rank })).id as number;
  return { ctx, run, founder, category, forum, me, group };
}

const NOBODY = {
  panel: false,
  moderatesEverywhere: false,
  moderatedNodeIds: [],
  moderatedNodesTruncated: false,
};

describe("auth.me staff", () => {
  test("the sets come from the registry", () => {
    expect(NODE_MODERATION).toContain("forum.lock");
    expect(NODE_MODERATION).toContain("forum.threadBan");
    expect(NODE_MODERATION).not.toContain("forum.reply");
    expect(NODE_MODERATION).not.toContain("node.view");
    expect(GLOBAL_STAFF).toContain("moderation.access");
    expect(GLOBAL_STAFF).toContain("admin.members");
    expect(GLOBAL_STAFF).not.toContain("profile.view");
  });

  test("a guest and an ordinary member have nothing", async () => {
    const w = world();
    w.forum("Lounge");
    const member = insertUser(w.ctx);
    expect((await w.run("auth.me", GUEST)).staff).toEqual(NOBODY);
    expect((await w.me(member.id)).staff).toEqual(NOBODY);
    expect((await w.run("auth.me", userActor(member))).staff).toEqual(NOBODY);
  });

  test("a moderator of one forum through a node entry on a group", async () => {
    const w = world();
    const category = w.category("Category");
    const one = w.forum("One", category);
    const two = w.forum("Two", category);
    const groupId = await w.group("Helpers", 20);
    await w.run("permissions.set", w.founder, {
      groupId,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    await w.run("permissions.set", w.founder, {
      groupId,
      nodeId: one,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    const helper = insertUser(w.ctx, { groupId });
    expect((await w.me(helper.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: false,
      moderatedNodeIds: [one],
      moderatedNodesTruncated: false,
    });
    // The same entry on the category covers its forums.
    await w.run("permissions.set", w.founder, {
      groupId,
      nodeId: category,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    expect((await w.me(helper.id)).staff).toMatchObject({
      panel: true,
      moderatedNodeIds: [one, two],
      moderatedNodesTruncated: false,
    });
  });

  test("a moderator of one forum through a member entry", async () => {
    const w = world();
    const category = w.category("Category");
    const one = w.forum("One", category);
    w.forum("Two", category);
    const member = insertUser(w.ctx);
    await w.run("permissions.set", w.founder, {
      userId: member.id,
      nodeId: one,
      entries: [{ permission: "forum.approve", value: "allow" }],
    });
    expect((await w.me(member.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: false,
      moderatedNodeIds: [one],
      moderatedNodesTruncated: false,
    });
    const other = insertUser(w.ctx);
    expect((await w.me(other.id)).staff).toEqual(NOBODY);
  });

  test("a forum taken away with a never is left out and the member no longer moderates everywhere", async () => {
    const w = world();
    const category = w.category("Category");
    const one = w.forum("One", category);
    const two = w.forum("Two", category);
    const mod = insertUser(w.ctx, { groupId: 3 });
    expect((await w.me(mod.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: true,
      moderatedNodeIds: [],
      moderatedNodesTruncated: false,
    });
    await w.run("permissions.set", w.founder, {
      groupId: 3,
      nodeId: one,
      entries: NODE_MODERATION.map((permission) => ({ permission, value: "never" })),
    });
    expect((await w.me(mod.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: false,
      moderatedNodeIds: [two],
      moderatedNodesTruncated: false,
    });
  });

  test("a global moderator moderates everywhere and an administrator too", async () => {
    const w = world();
    w.forum("Lounge");
    const mod = insertUser(w.ctx, { groupId: 3 });
    expect((await w.me(mod.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: true,
      moderatedNodeIds: [],
      moderatedNodesTruncated: false,
    });
    expect((await w.me((w.founder as { userId: number }).userId)).staff).toEqual({
      panel: true,
      moderatesEverywhere: true,
      moderatedNodeIds: [],
      moderatedNodesTruncated: false,
    });
  });

  test("a member with only some administration permissions has a panel but moderates nothing", async () => {
    const w = world();
    w.forum("Lounge");
    const member = insertUser(w.ctx);
    await w.run("permissions.set", w.founder, {
      userId: member.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    expect((await w.me(member.id)).staff).toEqual({
      panel: true,
      moderatesEverywhere: false,
      moderatedNodeIds: [],
      moderatedNodesTruncated: false,
    });
    // Moderation-category permissions held globally open the panel too.
    const warner = insertUser(w.ctx);
    await w.run("permissions.set", w.founder, {
      userId: warner.id,
      entries: [{ permission: "warning.view", value: "allow" }],
    });
    expect((await w.me(warner.id)).staff.panel).toBe(true);
  });

  test("a banned moderator is not one", async () => {
    const w = world();
    w.forum("Lounge");
    const mod = insertUser(w.ctx, { groupId: 3 });
    await w.run("bans.create", w.founder, { userId: mod.id, reason: "Rule", expiresAt: null });
    expect((await w.me(mod.id)).staff).toEqual(NOBODY);
  });

  test("an actor without a stored principal gets the same answer", async () => {
    const w = world();
    const category = w.category("Category");
    const one = w.forum("One", category);
    w.forum("Two", category);
    const member = insertUser(w.ctx);
    await w.run("permissions.set", w.founder, {
      userId: member.id,
      nodeId: one,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    expect((await w.run("auth.me", userActor(member))).staff).toEqual({
      panel: true,
      moderatesEverywhere: false,
      moderatedNodeIds: [one],
      moderatedNodesTruncated: false,
    });
    const plain = insertUser(w.ctx);
    expect((await w.run("auth.me", userActor(plain))).staff).toEqual(NOBODY);
  });

  test("costs no query: the same statements for a member and a moderator, whatever the forums", async () => {
    const small = world();
    const large = world();
    const count = async (w: ReturnType<typeof world>, forums: number, moderator: boolean) => {
      const category = w.category("Category");
      const ids = Array.from({ length: forums }, (_, i) => w.forum(`Forum ${i}`, category));
      const member = insertUser(w.ctx);
      if (moderator)
        await w.run("permissions.set", w.founder, {
          userId: member.id,
          nodeId: ids[0],
          entries: [{ permission: "forum.lock", value: "allow" }],
        });
      const actor = resolvedActor(w.ctx, member.id);
      await w.run("auth.me", actor);
      return countStatements(w.ctx, () => w.run("auth.me", actor));
    };
    const plain = await count(small, 3, false);
    expect(await count(small, 3, true)).toBe(plain);
    expect(await count(large, 60, true)).toBe(plain);
  });
});

describe("auth.me staff, review fixes", () => {
  test("a permission that only exempts the member does not make them staff", async () => {
    const w = world();
    w.forum("Lounge");
    const exempt = insertUser(w.ctx, { username: "Exempt" });
    await w.run("permissions.set", w.founder, {
      userId: exempt.id,
      entries: [{ permission: "member.immuneToAutoBan", value: "allow" }],
    });
    expect((await w.me(exempt.id)).staff).toEqual(NOBODY);
    // The panel of the administration home is closed to them too.
    await expect(w.run("admin.staffOnline", resolvedActor(w.ctx, exempt.id))).rejects.toBeDefined();
    // Together with a permission that does let them act, they are staff.
    await w.run("permissions.set", w.founder, {
      userId: exempt.id,
      entries: [{ permission: "wordFilter.view", value: "allow" }],
    });
    expect((await w.me(exempt.id)).staff.panel).toBe(true);
    expect(GLOBAL_STAFF).not.toContain("member.immuneToAutoBan");
    expect(NON_ACTING_STAFF.has("member.immuneToAutoBan")).toBe(true);
  });

  test("with no forum at all, a global never on every moderation permission is not moderating everywhere", async () => {
    const w = world();
    const groupId = await w.group("Helpers", 20);
    await w.run("permissions.set", w.founder, {
      groupId,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    const allowed = insertUser(w.ctx, { groupId, username: "Allowed" });
    const denied = insertUser(w.ctx, { groupId, username: "Denied" });
    await w.run("permissions.set", w.founder, {
      userId: denied.id,
      entries: NODE_MODERATION.map((permission) => ({ permission, value: "never" })),
    });
    expect((await w.me(allowed.id)).staff).toMatchObject({ moderatesEverywhere: true });
    expect((await w.me(denied.id)).staff).toMatchObject({
      moderatesEverywhere: false,
      moderatedNodeIds: [],
    });
  });

  test("says when the forums moderated were cut at 500", async () => {
    const w = world();
    const category = w.category("Big");
    for (let i = 0; i < 501; i++) w.forum(`Forum ${i}`, category);
    const groupId = await w.group("Helpers", 20);
    await w.run("permissions.set", w.founder, {
      groupId,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    await w.run("permissions.set", w.founder, {
      groupId,
      nodeId: category,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    const helper = insertUser(w.ctx, { groupId, username: "Helper" });
    const { staff } = await w.me(helper.id);
    expect(staff.moderatedNodeIds).toHaveLength(500);
    expect(staff.moderatedNodesTruncated).toBe(true);
    const few = insertUser(w.ctx, { username: "Few" });
    await w.run("permissions.set", w.founder, {
      userId: few.id,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    await w.run("permissions.set", w.founder, {
      userId: few.id,
      nodeId: category + 1,
      entries: [{ permission: "forum.lock", value: "allow" }],
    });
    expect((await w.me(few.id)).staff).toMatchObject({
      moderatedNodeIds: [category + 1],
      moderatedNodesTruncated: false,
    });
  });
});
