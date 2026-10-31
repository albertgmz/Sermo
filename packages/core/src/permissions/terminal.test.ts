import { afterEach, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser } from "@sermo/core/testing";
import { type Actor, isTerminalActor } from "../actor";
import { closeContext, invalidate } from "../context";
import { writeTx } from "../db/tx";
import { moderationOf, staffAccess } from "../modules/auth/staff";
import { execute } from "../operation";
import { getOperation } from "../operations";
import {
  can,
  isSuperAdmin,
  permissionsOf,
  resolvedPermissions,
  STAFF_POWERS,
  viewableNodeIds,
} from "./check";
import { grantPurchased } from "./grants";
import { resolvedActor } from "./test-contexts";

/*
 * A device login (a terminal client's token) acts as its member without any staff power: a
 * moderator or an administrator who signs in with sermo-cli is a plain member there.
 */

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const forum = insertNode(ctx, { title: "Forum" });
  invalidate(ctx, "node_tree");
  const admin = insertUser(ctx, { groupId: 4, username: "Boss" });
  ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(admin.id);
  const browser = resolvedActor(ctx, admin.id);
  const terminal = { ...browser, kind: "token", tokenId: 0, terminalSessionId: 7 } as Actor;
  return { ctx, forum, browser, terminal };
}

test("the staff powers are the moderation and admin flags and the flags only staff get", () => {
  const powers: readonly string[] = STAFF_POWERS;
  for (const id of ["admin.settings", "moderation.access", "member.ban", "forum.editAny"])
    expect(powers).toContain(id);
  for (const id of ["forum.viewDeleted", "profilePost.editAny", "conversation.moderate"])
    expect(powers).toContain(id);
  // A member's own powers, and the flags that restrict whoever holds them, are not powers.
  for (const id of ["forum.reply", "profile.editOwn", "conversation.start", "node.view"])
    expect(powers).not.toContain(id);
  expect(powers).not.toContain("antispam.externalMediaAsLinks");
  expect(powers).not.toContain("profile.renameNeedsApproval");
  // Perks a member holds or buys for their own profile and content are not powers either.
  for (const id of [
    "profile.signature",
    "profile.customTitle",
    "profile.coverPreset",
    "profile.renameFree",
    "forum.deleteOwnThread",
    "forum.lockOwn",
    "forum.hardDeleteOwn",
  ])
    expect(powers).not.toContain(id);
});

/** A forum only staff may open: closed to guests and members, open to the Moderator group. */
async function staffRoom(ctx: ReturnType<typeof createTestContext>) {
  const room = insertNode(ctx, { title: "Staff room" });
  invalidate(ctx, "node_tree");
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const set = (groupId: number, value: "no" | "allow") =>
    execute(ctx, getOperation("permissions.set"), resolvedActor(ctx, founder.id), {
      groupId,
      nodeId: room.id,
      entries: [{ permission: "node.view", value }],
    });
  await set(1, "no");
  await set(2, "no");
  await set(3, "allow");
  return room;
}

const asTerminal = (actor: Actor) =>
  ({ ...actor, kind: "token", tokenId: 0, terminalSessionId: 9 }) as Actor;

test("a moderator's device login cannot open a forum only staff may open, and keeps the others", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const lounge = insertNode(ctx, { title: "Lounge" });
  invalidate(ctx, "node_tree");
  const room = await staffRoom(ctx);
  // The moderator's only group is the Moderator group, as with most imported moderators.
  const moderator = insertUser(ctx, { groupId: 3, username: "Mod" });
  const browser = resolvedActor(ctx, moderator.id);
  const terminal = asTerminal(browser);
  expect(viewableNodeIds(ctx, terminal)).not.toContain(room.id);
  expect(can(ctx, terminal, "forum.createThread", { nodeId: room.id })).toBe(false);
  expect(viewableNodeIds(ctx, terminal)).toContain(lounge.id);
  expect(can(ctx, terminal, "forum.createThread", { nodeId: lounge.id })).toBe(true);
  expect(viewableNodeIds(ctx, browser)).toContain(room.id);
  expect(can(ctx, browser, "forum.createThread", { nodeId: room.id })).toBe(true);
  expect(can(ctx, browser, "forum.lock", { nodeId: lounge.id })).toBe(true);
  expect(can(ctx, terminal, "forum.lock", { nodeId: lounge.id })).toBe(false);
});

test("a member keeps a bought signature with the device login, but not a staff power given to them alone", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const lounge = insertNode(ctx, { title: "Lounge" });
  invalidate(ctx, "node_tree");
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const member = insertUser(ctx, { groupId: 2, username: "Ada" });
  writeTx(ctx, () =>
    grantPurchased(ctx, member.id, 1, { type: "permission", permission: "profile.signature" }),
  );
  await execute(ctx, getOperation("permissions.set"), resolvedActor(ctx, founder.id), {
    userId: member.id,
    nodeId: lounge.id,
    entries: [{ permission: "forum.editAny", value: "allow" }],
  });
  const browser = resolvedActor(ctx, member.id);
  const terminal = asTerminal(browser);
  expect(can(ctx, browser, "profile.signature")).toBe(true);
  expect(can(ctx, terminal, "profile.signature")).toBe(true);
  expect(can(ctx, browser, "forum.editAny", { nodeId: lounge.id })).toBe(true);
  expect(can(ctx, terminal, "forum.editAny", { nodeId: lounge.id })).toBe(false);
});

test("an administrator's device login holds no staff power, and the browser session keeps them", () => {
  const { ctx, forum, browser, terminal } = world();
  expect(isTerminalActor(terminal)).toBe(true);
  expect(isTerminalActor(browser)).toBe(false);
  // The device login is resolved first, so a cache it filled would show in the browser checks.
  expect(can(ctx, terminal, "admin.settings")).toBe(false);
  expect(can(ctx, terminal, "forum.editAny", { nodeId: forum.id })).toBe(false);
  expect(permissionsOf(ctx, terminal).can("moderation.access")).toBe(false);
  expect(isSuperAdmin(ctx, terminal)).toBe(false);
  const held = resolvedPermissions(ctx, terminal);
  for (const id of STAFF_POWERS)
    if (id in held) expect({ id, held: held[id] }).toEqual({ id, held: false });
  expect(resolvedPermissions(ctx, terminal, { nodeId: forum.id })["forum.viewDeleted"]).toBe(false);
  expect(staffAccess(ctx, terminal, held).panel).toBe(false);
  expect(moderationOf(ctx, terminal as Exclude<Actor, { kind: "guest" }>).nodeIds).toEqual([]);
  // A member's own powers stay.
  expect(can(ctx, terminal, "forum.createThread", { nodeId: forum.id })).toBe(true);
  expect(viewableNodeIds(ctx, terminal)).toContain(forum.id);

  expect(can(ctx, browser, "admin.settings")).toBe(true);
  expect(can(ctx, browser, "forum.editAny", { nodeId: forum.id })).toBe(true);
  expect(isSuperAdmin(ctx, browser)).toBe(true);
  const browserHeld = resolvedPermissions(ctx, browser);
  expect(browserHeld["admin.settings"]).toBe(true);
  expect(staffAccess(ctx, browser, browserHeld).panel).toBe(true);
  expect(
    moderationOf(ctx, browser as Exclude<Actor, { kind: "guest" }>).nodeIds.length +
      Number(moderationOf(ctx, browser as Exclude<Actor, { kind: "guest" }>).everywhere),
  ).toBeGreaterThan(0);
});

test("a group marked staff later is left out of its members' device logins at once", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const room = await staffRoom(ctx);
  const helpers = ctx.sqlite
    .query<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Helpers', 20) RETURNING id",
    )
    .get()!.id;
  const founder = ctx.sqlite
    .query<{ id: number }, []>("SELECT id FROM users WHERE username = 'Founder'")
    .get()!.id;
  await execute(ctx, getOperation("permissions.set"), resolvedActor(ctx, founder), {
    groupId: helpers,
    nodeId: room.id,
    entries: [{ permission: "node.view", value: "allow" }],
  });
  const helper = insertUser(ctx, { groupId: helpers, username: "Helper" });
  expect(viewableNodeIds(ctx, asTerminal(resolvedActor(ctx, helper.id)))).toContain(room.id);
  ctx.sqlite.run("UPDATE groups SET is_staff = 1 WHERE id = ?1", [helpers]);
  expect(viewableNodeIds(ctx, asTerminal(resolvedActor(ctx, helper.id)))).not.toContain(room.id);
});

test("a custom moderator group without the staff mark gives a device login no staff power", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const lounge = insertNode(ctx, { title: "Lounge" });
  invalidate(ctx, "node_tree");
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const mods = ctx.sqlite
    .query<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Global mods', 30) RETURNING id",
    )
    .get()!.id;
  await execute(ctx, getOperation("permissions.set"), resolvedActor(ctx, founder.id), {
    groupId: mods,
    entries: ["moderation.access", "member.ban", "forum.editAny", "forum.viewDeleted"].map(
      (permission) => ({ permission, value: "allow" as const }),
    ),
  });
  const member = insertUser(ctx, { groupId: 2, username: "Gmod" });
  ctx.sqlite.run("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 1)", [
    member.id,
    mods,
  ]);
  const browser = resolvedActor(ctx, member.id);
  const terminal = asTerminal(browser);
  const held = (actor: Actor) => ({
    access: can(ctx, actor, "moderation.access"),
    editAny: can(ctx, actor, "forum.editAny", { nodeId: lounge.id }),
    viewDeleted: can(ctx, actor, "forum.viewDeleted", { nodeId: lounge.id }),
    ban: resolvedPermissions(ctx, actor)["member.ban"],
  });
  expect(held(terminal)).toEqual({ access: false, editAny: false, viewDeleted: false, ban: false });
  expect(held(browser)).toEqual({ access: true, editAny: true, viewDeleted: true, ban: true });
});

test("a device login never holds what the browser session is refused: a staff group's never stays", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const appeals = insertNode(ctx, { title: "Appeals" });
  invalidate(ctx, "node_tree");
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  await execute(ctx, getOperation("permissions.set"), resolvedActor(ctx, founder.id), {
    groupId: 3,
    nodeId: appeals.id,
    entries: [
      { permission: "node.view", value: "never" },
      { permission: "forum.reply", value: "never" },
    ],
  });
  const member = insertUser(ctx, { groupId: 2, username: "Mod" });
  ctx.sqlite.run("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, 1)", [
    member.id,
  ]);
  const browser = resolvedActor(ctx, member.id);
  const terminal = asTerminal(browser);
  expect(viewableNodeIds(ctx, browser)).not.toContain(appeals.id);
  expect(viewableNodeIds(ctx, terminal)).not.toContain(appeals.id);
  expect(can(ctx, terminal, "forum.createThread", { nodeId: appeals.id })).toBe(false);
});
