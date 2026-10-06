import { expect, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { runDueJobs } from "../jobs/queue";
import { getAuth, resolveActor } from "./index";

test("getAuth rebuilds when mail is registered after its first use", async () => {
  const ctx = createTestContext();
  const before = getAuth(ctx);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  registerAccountEmailJobs(ctx);
  const after = getAuth(ctx);
  expect(after).not.toBe(before);
  expect(getAuth(ctx)).toBe(after);
  const signup = await after.api.signUpEmail({
    body: {
      name: "Late Mail",
      username: "LateMail",
      email: "late@example.test",
      password: "Password123!",
    },
  });
  const userId = Number(signup.user.id);
  expect(
    ctx.sqlite
      .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
      .get(userId)?.group_id,
  ).toBe(5);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(1);
});

test("a missing forum profile is repaired according to mail and verification state", async () => {
  const ctx = createTestContext();
  registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  );
  registerAccountEmailJobs(ctx);
  for (const verified of [false, true]) {
    const signup = await getAuth(ctx).api.signUpEmail({
      body: {
        name: verified ? "Verified" : "Unverified",
        username: verified ? "Verified" : "Unverified",
        email: verified ? "verified@example.test" : "unverified@example.test",
        password: "Password123!",
      },
      asResponse: true,
    });
    const userId = Number(((await signup.json()) as { user: { id: string } }).user.id);
    if (verified)
      ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(userId);
    ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(userId);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const actor = (await resolveActor(ctx, new Headers({ cookie }))).actor;
    expect(actor).toMatchObject({ groupId: verified ? 2 : 5 });
    expect(
      ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(userId)?.group_id,
    ).toBe(verified ? 2 : 5);
  }
});
