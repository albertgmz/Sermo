import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { can, currentVersions } from "../../permissions";
import type { PermissionState } from "../../permissions/state";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import {
  groupsCreateOp,
  groupsDeleteOp,
  groupsGetOp,
  groupsListOp,
  groupsUpdateOp,
  permissionsDefinitionsOp,
  permissionsExplainOp,
  permissionsListNodeOp,
  permissionsListOp,
  permissionsSetOp,
  usersGetGroupsOp,
  usersSetGroupsOp,
} from "./index";

const ADMIN_PERMISSIONS = ["admin.permissions", "admin.groups", "admin.members"];

/**
 * A founder, and a staff member who administers through a custom group. `here` is the staff
 * member's process (actor resolved, permission state warm); `elsewhere` is another process.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = insertUser(fixture, { groupId: 4 });
  const founderActor = userActor(founder);
  const staffGroup = await execute(fixture, groupsCreateOp, founderActor, {
    title: "Staff",
    rank: 40,
  });
  await execute(fixture, permissionsSetOp, founderActor, {
    groupId: staffGroup.id,
    entries: ADMIN_PERMISSIONS.map((permission) => ({ permission, value: "allow" as const })),
  });
  const spare = await execute(fixture, groupsCreateOp, founderActor, { title: "Spare", rank: 5 });
  const staff = insertUser(fixture, { groupId: staffGroup.id });
  const member = insertUser(fixture);
  const node = insertNode(fixture, {});
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, staff.id);
  expect(can(here, actor, "admin.permissions")).toBe(true);
  return { database, here, elsewhere, actor, founderActor, staff, staffGroup, spare, member, node };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const revocations: Record<string, (s: Scenario) => Promise<unknown>> = {
  "their group is changed": (s) =>
    execute(s.elsewhere, usersSetGroupsOp, s.founderActor, {
      userId: s.staff.id,
      primaryGroupId: 2,
    }),
  "their group loses its permissions": (s) =>
    execute(s.elsewhere, permissionsSetOp, s.founderActor, {
      groupId: s.staffGroup.id,
      entries: ADMIN_PERMISSIONS.map((permission) => ({ permission, value: "unset" as const })),
    }),
};
const attempts: Record<string, (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>> = {
  "groups.list": (ctx, actor) => execute(ctx, groupsListOp, actor, {}),
  "groups.get": (ctx, actor, s) => execute(ctx, groupsGetOp, actor, { groupId: s.spare.id }),
  "users.getGroups": (ctx, actor, s) =>
    execute(ctx, usersGetGroupsOp, actor, { userId: s.member.id }),
  "permissions.definitions": (ctx, actor) => execute(ctx, permissionsDefinitionsOp, actor, {}),
  "permissions.list": (ctx, actor, s) =>
    execute(ctx, permissionsListOp, actor, { groupId: s.staffGroup.id }),
  "permissions.listNode": (ctx, actor, s) =>
    execute(ctx, permissionsListNodeOp, actor, { nodeId: s.node.id }),
  "permissions.explain": (ctx, actor, s) =>
    execute(ctx, permissionsExplainOp, actor, {
      userId: s.member.id,
      permission: "admin.permissions",
    }),
  "permissions.set": (ctx, actor, s) =>
    execute(ctx, permissionsSetOp, actor, {
      userId: s.staff.id,
      entries: [{ permission: "admin.permissions", value: "allow" }],
    }),
  "groups.create": (ctx, actor) => execute(ctx, groupsCreateOp, actor, { title: "New", rank: 1 }),
  "groups.update": (ctx, actor, s) =>
    execute(ctx, groupsUpdateOp, actor, { groupId: s.spare.id, title: "Renamed" }),
  "users.setGroups": (ctx, actor, s) =>
    execute(ctx, usersSetGroupsOp, actor, {
      userId: s.member.id,
      secondaryGroupIds: [s.spare.id],
    }),
  "groups.delete": (ctx, actor, s) => execute(ctx, groupsDeleteOp, actor, { groupId: s.spare.id }),
};

const snapshot = (ctx: Ctx) =>
  JSON.stringify([
    ctx.sqlite.prepare("SELECT id, title, rank FROM groups ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT user_id, group_id FROM user_groups ORDER BY id").all(),
    ctx.sqlite
      .prepare("SELECT group_id, user_id, permission_id, value FROM permission_entries ORDER BY id")
      .all(),
  ]);

for (const [revoked, revoke] of Object.entries(revocations))
  for (const [name, attempt] of Object.entries(attempts))
    test(`${name} is refused to an administrator revoked meanwhile (${revoked})`, async () => {
      const s = await scenario();
      try {
        await revoke(s);
        const before = snapshot(s.elsewhere);
        await expect(attempt(s.here, s.actor, s)).rejects.toThrow(ForbiddenError);
        expect(snapshot(s.elsewhere)).toBe(before);
        expect(can(s.elsewhere, resolvedActor(s.elsewhere, s.staff.id), "admin.permissions")).toBe(
          false,
        );
      } finally {
        s.database.close();
      }
    });

test("an administrator who was not revoked still acts from a second process", async () => {
  const s = await scenario();
  try {
    for (const attempt of Object.values(attempts)) await attempt(s.here, s.actor, s);
    expect(
      s.elsewhere.sqlite
        .prepare<{ title: string }, []>("SELECT title FROM groups WHERE title = 'New'")
        .get(),
    ).not.toBeNull();
  } finally {
    s.database.close();
  }
});

test("administrative reads reuse the permission cache across snapshots and refresh it after edits", async () => {
  const ctx = createTestContext();
  const founder = insertUser(ctx, { groupId: 4 });
  const actor = resolvedActor(ctx, founder.id);
  const cachedState = () =>
    ctx.caches.get("permission_state")?.value as PermissionState | undefined;
  expect(cachedState()).toBeUndefined();

  await execute(ctx, groupsListOp, actor, {});
  const first = cachedState();
  expect(first).toBeDefined();
  await execute(ctx, groupsListOp, actor, {});
  expect(cachedState()).toBe(first);

  const previousVersion = currentVersions(ctx).permissions;
  ctx.sqlite.run(
    "UPDATE permission_entries SET value = 0 WHERE group_id = 2 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'search.use')",
  );
  expect(currentVersions(ctx).permissions).toBeGreaterThan(previousVersion);
  await execute(ctx, groupsListOp, actor, {});
  expect(cachedState()?.versions.permissions).toBe(currentVersions(ctx).permissions);
});
