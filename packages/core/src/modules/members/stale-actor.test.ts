import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";

const op = (name: string) => getOperation(name);

/**
 * A member in a process that resolved them before another process banned them, or took
 * `profile.editOwn` from their group.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const member = insertUser(fixture);
  const referrer = insertUser(fixture);
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, member.id);
  return { database, here, elsewhere, founder, actor, member, referrer };
}

const state = (ctx: Ctx) =>
  JSON.stringify(
    ctx.sqlite.prepare("SELECT id, referred_by, referral_count FROM users ORDER BY id").all(),
  );

for (const [revoked, revoke] of [
  [
    "banned",
    (s: Awaited<ReturnType<typeof scenario>>) =>
      execute(s.elsewhere, op("bans.create"), s.founder, {
        userId: s.member.id,
        reason: "Abuse",
        expiresAt: null,
      }),
  ],
  [
    "their group loses profile.editOwn",
    (s: Awaited<ReturnType<typeof scenario>>) =>
      execute(s.elsewhere, op("permissions.set"), s.founder, {
        groupId: 2,
        entries: [{ permission: "profile.editOwn", value: "never" }],
      }),
  ],
] as const)
  test(`users.setReferrer is refused to a member ${revoked} meanwhile`, async () => {
    const s = await scenario();
    try {
      await revoke(s);
      const before = state(s.elsewhere);
      await expect(
        execute(s.here, op("users.setReferrer"), s.actor, { userId: s.referrer.id }),
      ).rejects.toThrow(ForbiddenError);
      expect(state(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

test("a member who was not revoked names a referrer from a second process", async () => {
  const s = await scenario();
  try {
    await execute(s.here, op("users.setReferrer"), s.actor, { userId: s.referrer.id });
    expect(
      s.elsewhere.sqlite
        .prepare<{ referral_count: number }, [number]>(
          "SELECT referral_count FROM users WHERE id = ?1",
        )
        .get(s.referrer.id)!.referral_count,
    ).toBe(1);
  } finally {
    s.database.close();
  }
});
