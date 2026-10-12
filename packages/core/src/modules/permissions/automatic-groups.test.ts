import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GROUP_IDS } from "../../db/schema";
import { ConflictError } from "../../errors";
import { execute } from "../../operation";
import { can } from "../../permissions";
import { resolvedActor } from "../../permissions/test-contexts";
import { getAuth } from "../auth";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { runDueJobs } from "../jobs/queue";
import { permissionsSetOp } from "./index";

async function scenario() {
  const ctx = createTestContext();
  const founderUser = insertUser(ctx, { groupId: GROUP_IDS.admin });
  const founder = userActor(founderUser);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    { defaults: {}, securityTypes: new Set() },
  )!;
  registerAccountEmailJobs(ctx);
  const signup = await getAuth(ctx).api.signUpEmail({
    body: {
      name: "Verifying",
      username: "Verifying",
      email: "verifying@example.test",
      password: "Password123!",
    },
  });
  const userId = Number(signup.user.id);
  expect(resolvedActor(ctx, userId)).toMatchObject({ groupId: GROUP_IDS.unconfirmed });
  const administrators = () =>
    [founderUser.id, userId].filter((id) => can(ctx, resolvedActor(ctx, id), "admin.permissions"));
  const set = (groupId: number, value: "allow" | "never" | "unset") =>
    execute(ctx, permissionsSetOp, founder, {
      groupId,
      entries: [{ permission: "admin.permissions", value }],
    });
  const verify = async () => {
    await runDueJobs(ctx);
    const mail = capture.messages.find((message) => /verify-email/.test(message.text))!;
    const url = mail.text.match(/https?:\/\/[^\s]+/)![0];
    expect([200, 302]).toContain((await getAuth(ctx).handler(new Request(url))).status);
    expect(resolvedActor(ctx, userId)).toMatchObject({ groupId: GROUP_IDS.member });
    expect(
      ctx.sqlite
        .prepare<{ email_verified: number }, [number]>(
          "SELECT email_verified FROM auth_user WHERE id = ?1",
        )
        .get(userId)?.email_verified,
    ).toBe(1);
  };
  return { ctx, founder, userId, administrators, set, verify };
}

test("verification cannot remove administration supplied by Unconfirmed", async () => {
  const s = await scenario();
  const refused: number[] = [];
  for (const [index, action] of [
    () => s.set(GROUP_IDS.unconfirmed, "allow"),
    () => s.set(GROUP_IDS.admin, "unset"),
  ].entries()) {
    try {
      await action();
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      refused.push(index);
    }
  }
  const before = s.administrators();
  await s.verify();
  expect(s.administrators()).toEqual(before);
  expect(s.administrators().length).toBeGreaterThan(0);
  expect(refused).toEqual([0, 1]);
});

for (const denyFirst of [true, false])
  test(`verification cannot introduce Member's never (deny first: ${denyFirst})`, async () => {
    const s = await scenario();
    let refused = false;
    const deny = async () => {
      try {
        await s.set(GROUP_IDS.member, "never");
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        refused = true;
      }
    };
    if (denyFirst) await deny();
    await execute(s.ctx, permissionsSetOp, s.founder, {
      userId: s.userId,
      entries: [{ permission: "admin.permissions", value: "allow" }],
    });
    if (!denyFirst) await deny();
    await s.set(GROUP_IDS.admin, "unset");
    expect(s.administrators()).toEqual([s.userId]);
    await s.verify();
    expect(s.administrators()).toEqual([s.userId]);
    expect(refused).toBe(true);
  });

test("Unconfirmed rejects never too, and a rejected batch rolls back its other entries", async () => {
  const ctx = createTestContext();
  const founder = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
  const before = ctx.sqlite.prepare("SELECT * FROM permission_entries ORDER BY id").all();
  await expect(
    execute(ctx, permissionsSetOp, founder, {
      groupId: GROUP_IDS.unconfirmed,
      entries: [
        { permission: "search.use", value: "never" },
        { permission: "admin.permissions", value: "never" },
      ],
    }),
  ).rejects.toThrow(ConflictError);
  expect(ctx.sqlite.prepare("SELECT * FROM permission_entries ORDER BY id").all()).toEqual(before);
});

test("Member may allow administration, and either automatic group may unset an entry", async () => {
  const s = await scenario();
  await s.set(GROUP_IDS.member, "allow");
  await s.verify();
  expect(s.administrators()).toContain(s.userId);
  await s.set(GROUP_IDS.member, "unset");
  await s.set(GROUP_IDS.unconfirmed, "unset");
  expect(s.administrators()).not.toContain(s.userId);
});
