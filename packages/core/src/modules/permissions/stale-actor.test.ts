import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import {
  groupsCreateOp,
  groupsDeleteOp,
  groupsUpdateOp,
  permissionsSetOp,
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
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, staff.id);
  expect(can(here, actor, "admin.permissions")).toBe(true);
  return { database, here, elsewhere, actor, founderActor, staff, staffGroup, spare, member };
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
