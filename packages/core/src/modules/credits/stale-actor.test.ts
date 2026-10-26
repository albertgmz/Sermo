import { expect, setDefaultTimeout, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";

// These tests are slow only when the full suite shares the machine (disk and CPU): the 5 s default is too short.
setDefaultTimeout(30_000);

const op = (name: string) => getOperation(name);

/**
 * A founder, and a treasurer who gets `credits.adjust` from a custom group. `here` is the
 * treasurer's process (actor resolved, permission state warm); `elsewhere` is another process,
 * where the founder removes the treasurer from the group or bans them.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const group = (await execute(fixture, op("groups.create"), founder, {
    title: "Treasurers",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: group.id,
    entries: [{ permission: "credits.adjust", value: "allow" }],
  });
  const treasurer = insertUser(fixture, { groupId: group.id });
  const member = insertUser(fixture);
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, treasurer.id);
  expect(can(here, actor, "credits.adjust")).toBe(true);
  return { database, here, elsewhere, founder, treasurer, member, actor };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const revocations: Record<string, (s: Scenario) => Promise<unknown>> = {
  "their group is changed": (s) =>
    execute(s.elsewhere, op("users.setGroups"), s.founder, {
      userId: s.treasurer.id,
      primaryGroupId: 2,
    }),
  "they are banned": (s) =>
    execute(s.elsewhere, op("bans.create"), s.founder, {
      userId: s.treasurer.id,
      reason: "Fraud",
      expiresAt: null,
    }),
};

const adjust = (ctx: Ctx, s: Scenario) =>
  execute(ctx, op("credits.adjust"), s.actor, { userId: s.member.id, amount: 50, reason: "Gift" });
const snapshot = (ctx: Ctx) =>
  JSON.stringify([
    ctx.sqlite.prepare("SELECT id, credits FROM users ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT * FROM credit_transactions ORDER BY id").all(),
  ]);

for (const [revoked, revoke] of Object.entries(revocations))
  test(`credits.adjust is refused to a member revoked meanwhile (${revoked})`, async () => {
    const s = await scenario();
    try {
      await revoke(s);
      const before = snapshot(s.elsewhere);
      await expect(adjust(s.here, s)).rejects.toThrow(ForbiddenError);
      expect(snapshot(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

test("a member who was not revoked still adjusts credits from a second process", async () => {
  const s = await scenario();
  try {
    await adjust(s.here, s);
    expect(
      s.elsewhere.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(s.member.id)!.credits,
    ).toBe(50);
  } finally {
    s.database.close();
  }
});

const preview = (ctx: Ctx, s: Scenario) => execute(ctx, op("credits.taxPreview"), s.actor, {});
const runs = (ctx: Ctx) => ctx.sqlite.prepare("SELECT id FROM credit_tax_runs").all();

for (const [revoked, revoke] of Object.entries(revocations))
  test(`credits.taxPreview is refused to a member revoked meanwhile (${revoked})`, async () => {
    const s = await scenario();
    try {
      await revoke(s);
      await expect(preview(s.here, s)).rejects.toThrow(ForbiddenError);
      expect(runs(s.elsewhere)).toEqual([]);
    } finally {
      s.database.close();
    }
  });

test("a member who was not revoked still starts a tax preview from a second process", async () => {
  const s = await scenario();
  try {
    await preview(s.here, s);
    expect(runs(s.elsewhere)).toHaveLength(1);
  } finally {
    s.database.close();
  }
});
