import { afterEach, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser } from "@sermo/core/testing";
import { type Actor, isTerminalActor } from "../actor";
import { closeContext, invalidate } from "../context";
import { moderationOf, staffAccess } from "../modules/auth/staff";
import {
  can,
  isSuperAdmin,
  permissionsOf,
  resolvedPermissions,
  STAFF_POWERS,
  viewableNodeIds,
} from "./check";
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
