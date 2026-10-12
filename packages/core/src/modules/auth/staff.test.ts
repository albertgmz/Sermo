import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";
import { countStatements } from "../feed/fixtures.test";
import { GLOBAL_STAFF, NODE_MODERATION } from "./staff";

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

const NOBODY = { panel: false, moderatesEverywhere: false, moderatedNodeIds: [] };

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
    });
    expect((await w.me((w.founder as { userId: number }).userId)).staff).toEqual({
      panel: true,
      moderatesEverywhere: true,
      moderatedNodeIds: [],
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
