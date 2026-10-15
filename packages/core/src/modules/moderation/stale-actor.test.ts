import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { threadsCreateOp } from "../forums";
import { resumeSpamCleanup } from ".";

const op = (name: string) => getOperation(name);
const STAFF = [
  "member.ban",
  "member.warn",
  "member.spamCleanup",
  "forum.threadBan",
  "member.restrict",
];
const entries = (permissions: string[], value: "allow" | "unset") =>
  permissions.map((permission) => ({ permission, value }));

/**
 * A founder, and a moderator who gets every ban-related permission from a custom group. `here`
 * is the moderator's process (actor resolved, permission state warm); `elsewhere` is another
 * process, where the founder revokes the moderator.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const staffGroup = (await execute(fixture, op("groups.create"), founder, {
    title: "Moderators",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: staffGroup.id,
    entries: [
      ...entries([...STAFF, "node.view"], "allow"),
      // The limits a warning and a ban are held to: none for this group.
      { permission: "warning.maxPoints", value: -1 },
      { permission: "warning.perDay", value: -1 },
      { permission: "member.banMaxDays", value: -1 },
    ],
  });
  const staff = insertUser(fixture, { groupId: staffGroup.id });
  const member = insertUser(fixture);
  const banned = insertUser(fixture);
  const threadBanned = insertUser(fixture);
  const node = insertNode(fixture, {});
  invalidate(fixture, "node_tree");
  const author = userActor(member);
  const created = (await execute(fixture, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Thread",
    body: "Body",
  })) as { thread: { id: number } };
  const threadId = created.thread.id;
  const ban = (await execute(fixture, op("bans.create"), founder, {
    userId: banned.id,
    reason: "Earlier",
    expiresAt: null,
  })) as { id: number };
  await execute(fixture, op("threadBans.create"), founder, {
    threadId,
    userId: threadBanned.id,
    reason: "Earlier",
  });
  const restricted = insertUser(fixture);
  const restriction = (await execute(fixture, op("restrictions.create"), founder, {
    userId: restricted.id,
    kind: "posting",
    reason: "Earlier",
    expiresAt: null,
    notify: false,
  })) as { id: number };
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, staff.id);
  expect(can(here, actor, "member.ban", { target: userActor(member) })).toBe(true);
  return {
    database,
    here,
    elsewhere,
    actor,
    founder,
    staff,
    staffGroup,
    member,
    threadBanned,
    node,
    threadId,
    banId: ban.id,
    restrictionId: restriction.id,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const revocations: Record<string, (s: Scenario) => Promise<unknown>> = {
  "their group is changed": (s) =>
    execute(s.elsewhere, op("users.setGroups"), s.founder, {
      userId: s.staff.id,
      primaryGroupId: 2,
    }),
  "their group loses its permissions": (s) =>
    execute(s.elsewhere, op("permissions.set"), s.founder, {
      groupId: s.staffGroup.id,
      entries: entries(STAFF, "unset"),
    }),
};
const attempts: Record<string, (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>> = {
  "bans.create": (ctx, actor, s) =>
    execute(ctx, op("bans.create"), actor, {
      userId: s.member.id,
      reason: "Rude",
      expiresAt: null,
    }),
  "bans.lift": (ctx, actor, s) =>
    execute(ctx, op("bans.lift"), actor, { banId: s.banId, reason: "Sorry" }),
  "warnings.create": (ctx, actor, s) =>
    execute(ctx, op("warnings.create"), actor, {
      userId: s.member.id,
      points: 1000,
      reason: "Rude",
    }),
  "restrictions.create": (ctx, actor, s) =>
    execute(ctx, op("restrictions.create"), actor, {
      userId: s.member.id,
      kind: "posting",
      reason: "Rude",
      expiresAt: null,
      notify: false,
    }),
  "restrictions.lift": (ctx, actor, s) =>
    execute(ctx, op("restrictions.lift"), actor, {
      restrictionId: s.restrictionId,
      reason: "Sorry",
      notify: false,
    }),
  "spamCleanup.start": (ctx, actor, s) =>
    execute(ctx, op("spamCleanup.start"), actor, { userId: s.member.id, reason: "Spam" }),
  "resumeSpamCleanup (queued run)": async (ctx, actor, s) =>
    resumeSpamCleanup(ctx, actor, s.member.id, null),
  "threadBans.create": (ctx, actor, s) =>
    execute(ctx, op("threadBans.create"), actor, {
      threadId: s.threadId,
      userId: s.member.id,
      reason: "Off topic",
    }),
  "threadBans.lift": (ctx, actor, s) =>
    execute(ctx, op("threadBans.lift"), actor, { threadId: s.threadId, userId: s.threadBanned.id }),
};

const snapshot = (ctx: Ctx) =>
  JSON.stringify([
    ctx.sqlite.prepare("SELECT id, user_id, lifted_at FROM bans ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT id, user_id, points FROM warnings ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT id, user_id FROM thread_bans ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT id, banned_until, banned_permanently FROM users ORDER BY id").all(),
    ctx.sqlite
      .prepare("SELECT id, user_id, kind, lifted_at FROM user_restrictions ORDER BY id")
      .all(),
    ctx.sqlite.prepare("SELECT id, type FROM jobs ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT id, action FROM moderator_log ORDER BY id").all(),
  ]);

for (const [revoked, revoke] of Object.entries(revocations))
  for (const [name, attempt] of Object.entries(attempts))
    test(`${name} is refused to a moderator revoked meanwhile (${revoked})`, async () => {
      const s = await scenario();
      try {
        await revoke(s);
        const before = snapshot(s.elsewhere);
        await expect(attempt(s.here, s.actor, s)).rejects.toThrow(ForbiddenError);
        expect(snapshot(s.elsewhere)).toBe(before);
      } finally {
        s.database.close();
      }
    });

// A banned member also loses sight of the forum, so thread bans answer not found.
for (const [name, attempt] of Object.entries(attempts))
  test(`${name} is refused to a moderator banned meanwhile`, async () => {
    const s = await scenario();
    try {
      await execute(s.elsewhere, op("bans.create"), s.founder, {
        userId: s.staff.id,
        reason: "Abuse",
        expiresAt: null,
      });
      const before = snapshot(s.elsewhere);
      await expect(attempt(s.here, s.actor, s)).rejects.toThrow(
        name.startsWith("threadBans") ? NotFoundError : ForbiddenError,
      );
      expect(snapshot(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

test("thread bans answer not found to a moderator who lost sight of the forum meanwhile", async () => {
  const s = await scenario();
  try {
    await execute(s.elsewhere, op("permissions.set"), s.founder, {
      groupId: s.staffGroup.id,
      nodeId: s.node.id,
      entries: [{ permission: "node.view", value: "never" }],
    });
    for (const name of ["threadBans.create", "threadBans.lift"]) {
      const before = snapshot(s.elsewhere);
      await expect(attempts[name]!(s.here, s.actor, s)).rejects.toThrow(NotFoundError);
      expect(snapshot(s.elsewhere)).toBe(before);
    }
  } finally {
    s.database.close();
  }
});

test("a moderator who was not revoked still acts from a second process", async () => {
  const s = await scenario();
  try {
    for (const [name, attempt] of Object.entries(attempts)) {
      // The queued run needs the cleanup to have started first, and a second start would clash.
      if (name === "resumeSpamCleanup (queued run)") continue;
      await attempt(s.here, s.actor, s);
    }
    expect(
      s.elsewhere.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM bans WHERE user_id = ?1")
        .get(s.member.id)!.n,
    ).toBeGreaterThan(0);
    expect(
      s.elsewhere.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM user_restrictions WHERE user_id = ?1 AND lifted_at IS NULL",
        )
        .get(s.member.id)!.n,
    ).toBe(1);
    resumeSpamCleanup(s.here, s.actor, s.member.id, null);
  } finally {
    s.database.close();
  }
});
