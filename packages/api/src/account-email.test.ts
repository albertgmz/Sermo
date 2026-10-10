import { expect, test } from "bun:test";
import {
  closeContext,
  dispatchEvents,
  registerAccountEmailJobs,
  registerEmailJobs,
} from "@sermo/core";
import { createTestContext, insertNode } from "@sermo/core/testing";
import { resolveActor } from "../../core/src/modules/auth";
import { runDueJobs } from "../../core/src/modules/jobs/queue";
import { can } from "../../core/src/permissions";
import { createApp } from "./app";

test("account security email flow through the HTTP app", async () => {
  const ctx = createTestContext();
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  registerAccountEmailJobs(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = { requestIP: () => ({ address: "192.0.2.10", family: "IPv4" as const, port: 1 }) };
  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const follow = (message: { text: string }, cookie?: string) => {
    const link = message.text.match(/https?:\/\/[^\s]+/)?.[0];
    if (!link) throw new Error("Missing account link");
    const url = new URL(link);
    return app.request(`${url.pathname}${url.search}`, { headers: cookie ? { cookie } : {} }, env);
  };
  try {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Alice",
      username: "Alice",
      email: "alice@example.test",
      password: "Password123!",
    });
    expect(signup.status).toBe(200);
    const userId = Number(((await signup.json()) as { user: { id: string } }).user.id);
    const cookie = cookieOf(signup);
    expect(
      ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(userId)?.group_id,
    ).toBe(5);
    const node = insertNode(ctx, {});
    const unconfirmed = (await resolveActor(ctx, new Headers({ cookie }))).actor;
    expect(can(ctx, unconfirmed, "forum.createThread", { nodeId: node.id })).toBe(false);
    await runDueJobs(ctx);
    expect(capture.messages[0]?.subject).toContain("Verify");
    expect(capture.messages[0]?.headers?.["List-Unsubscribe"]).toBeUndefined();
    expect([200, 302]).toContain((await follow(capture.messages[0]!)).status);
    expect(
      ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(userId)?.group_id,
    ).toBe(2);
    const groupEvent = ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1",
      )
      .get(userId);
    expect(JSON.parse(groupEvent!.payload)).toMatchObject({
      source: "verification",
      added: [2],
      removed: [5],
    });
    const verified = (await resolveActor(ctx, new Headers({ cookie }))).actor;
    expect(can(ctx, verified, "forum.createThread", { nodeId: node.id })).toBe(true);
    await runDueJobs(ctx);
    expect(capture.messages.some((message) => message.subject.includes("Welcome"))).toBe(true);

    const resetRequest = await post("/api/auth/request-password-reset", {
      email: "alice@example.test",
      redirectTo: "http://localhost:3000/reset-password",
    });
    expect(resetRequest.status).toBe(200);
    await runDueJobs(ctx);
    const reset = capture.messages.find((message) => message.subject.includes("Reset"))!;
    const token = new URL(reset.text.match(/https?:\/\/[^\s]+/)![0]).pathname.split("/").at(-1)!;
    const resetResponse = await post("/api/auth/reset-password", {
      token,
      newPassword: "NewPassword123!",
    });
    expect(resetResponse.status).toBe(200);
    await runDueJobs(ctx);
    expect(capture.messages.some((message) => message.subject.includes("password changed"))).toBe(
      true,
    );
    expect(
      (
        await post("/api/auth/sign-in/email", {
          email: "alice@example.test",
          password: "Password123!",
        })
      ).status,
    ).not.toBe(200);
    const afterResetSignin = await post("/api/auth/sign-in/email", {
      email: "alice@example.test",
      password: "NewPassword123!",
    });
    expect(afterResetSignin.status).toBe(200);
    const afterResetCookie = cookieOf(afterResetSignin);
    await expect(resolveActor(ctx, new Headers({ cookie }))).rejects.toThrow();

    const change = await post(
      "/api/auth/change-email",
      { newEmail: "new@example.test" },
      afterResetCookie,
    );
    expect(change.status).toBe(200);
    await runDueJobs(ctx);
    const confirmation = capture.messages.find(
      (message) => message.to === "new@example.test" && message.subject.includes("Confirm"),
    )!;
    expect([200, 302]).toContain((await follow(confirmation, afterResetCookie)).status);
    await runDueJobs(ctx);
    expect(
      capture.messages
        .filter((message) => message.subject.includes("email address changed"))
        .map((message) => message.to)
        .sort(),
    ).toEqual(["alice@example.test", "new@example.test"]);
    const newSignin = await post("/api/auth/sign-in/email", {
      email: "new@example.test",
      password: "NewPassword123!",
    });
    expect(newSignin.status).toBe(200);
    const newCookie = cookieOf(newSignin);
    const key = await post("/api/auth/api-key/create", { name: "test key" }, newCookie);
    expect(key.status).toBe(200);
    await runDueJobs(ctx);
    expect(capture.messages.some((message) => message.subject.includes("API key"))).toBe(true);
    const passwordChange = await post(
      "/api/auth/change-password",
      {
        currentPassword: "NewPassword123!",
        newPassword: "NewestPassword123!",
      },
      newCookie,
    );
    expect(passwordChange.status).toBe(200);
    await runDueJobs(ctx);
    expect(
      capture.messages.filter((message) => message.subject.includes("password changed")),
    ).toHaveLength(2);
    const failedChange = await post(
      "/api/auth/change-password",
      { currentPassword: "wrong-password", newPassword: "AnotherPassword123!" },
      newCookie,
    );
    expect(failedChange.status).not.toBe(200);
    await runDueJobs(ctx);
    expect(
      capture.messages.filter((message) => message.subject.includes("password changed")),
    ).toHaveLength(2);

    const expiry = ctx.now() + 86_400_000;
    const banId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?1, 'abuse', ?2, ?3)",
        )
        .run(userId, ctx.now(), expiry).lastInsertRowid,
    );
    const banEvent = ctx.sqlite
      .prepare(
        "INSERT INTO domain_events (type, target_type, target_id, payload, created_at) VALUES ('member.banned', 'user', ?1, ?2, ?3)",
      )
      .run(
        userId,
        JSON.stringify({
          reason: "abuse",
          message: "Moderator note",
          notify: true,
          banId,
          expiresAt: new Date(expiry).toISOString(),
          lifted: false,
        }),
        ctx.now(),
      );
    expect(banEvent.changes).toBe(1);
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(
      capture.messages.some(
        (message) =>
          message.subject.includes("banned") &&
          message.text.includes("Moderator note") &&
          !message.text.includes("abuse"),
      ),
    ).toBe(true);
    const banCount = capture.messages.filter((message) =>
      message.subject.includes("banned"),
    ).length;
    ctx.sqlite
      .prepare("UPDATE event_subscribers SET last_event_id = 0 WHERE name = 'email.account.bans'")
      .run();
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(capture.messages.filter((message) => message.subject.includes("banned"))).toHaveLength(
      banCount,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO domain_events (type, target_type, target_id, payload, created_at) VALUES ('member.banned', 'user', ?1, '{\"lifted\":true}', ?2)",
      )
      .run(userId, ctx.now());
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
    expect(capture.messages.filter((message) => message.subject.includes("banned"))).toHaveLength(
      banCount,
    );
    expect(capture.messages.every((message) => !message.headers?.["List-Unsubscribe"])).toBe(true);
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        post("/api/auth/request-password-reset", { email: "new@example.test" }),
      ),
    );
    expect(attempts.at(-1)?.status).toBe(429);
    const verifications = await Promise.all(
      Array.from({ length: 6 }, () =>
        post("/api/auth/send-verification-email", { email: "new@example.test" }),
      ),
    );
    expect(verifications.at(-1)?.status).toBe(429);
    const changes = await Promise.all(
      Array.from({ length: 6 }, () =>
        post("/api/auth/change-email", { newEmail: "third@example.test" }, newCookie),
      ),
    );
    expect(changes.at(-1)?.status).toBe(429);
  } finally {
    closeContext(ctx);
  }
});

test("email changes promote only members unverified before the change", async () => {
  for (const initiallyVerified of [false, true]) {
    const ctx = createTestContext();
    const capture = registerEmailJobs(
      ctx,
      { driver: "capture", sender: "forum@example.test" },
      {
        defaults: {},
        securityTypes: new Set(),
      },
    )!;
    registerAccountEmailJobs(ctx);
    const app = createApp(ctx, { trustedProxyHeader: null });
    const env = {
      requestIP: () => ({
        address: initiallyVerified ? "192.0.2.21" : "192.0.2.20",
        family: "IPv4" as const,
        port: 1,
      }),
    };
    const post = (path: string, body: unknown, cookie?: string) =>
      app.request(
        path,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        },
        env,
      );
    const follow = (text: string, cookie: string) => {
      const url = new URL(text.match(/https?:\/\/[^\s]+/)![0]);
      return app.request(`${url.pathname}${url.search}`, { headers: { cookie } }, env);
    };
    try {
      const signup = await post("/api/auth/sign-up/email", {
        name: "Changing",
        username: "Changing",
        email: "old@example.test",
        password: "Password123!",
      });
      expect(signup.status).toBe(200);
      const userId = Number(((await signup.json()) as { user: { id: string } }).user.id);
      const cookie = signup.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      await runDueJobs(ctx);
      if (initiallyVerified) {
        expect([200, 302]).toContain((await follow(capture.messages[0]!.text, cookie)).status);
        ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(userId);
      }
      const before = ctx.sqlite
        .prepare<{ email_verified: number }, [number]>(
          "SELECT email_verified FROM auth_user WHERE id = ?1",
        )
        .get(userId)!.email_verified;
      expect(before).toBe(initiallyVerified ? 1 : 0);
      const eventsBefore = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1",
        )
        .get(userId)!.n;
      const changed = await post(
        "/api/auth/change-email",
        { newEmail: "new@example.test" },
        cookie,
      );
      expect(changed.status).toBe(200);
      await runDueJobs(ctx);
      const confirmation = capture.messages.find((message) => message.to === "new@example.test")!;
      expect([200, 302]).toContain((await follow(confirmation.text, cookie)).status);
      expect(
        ctx.sqlite
          .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
          .get(userId)?.group_id,
      ).toBe(initiallyVerified ? 5 : 2);
      const eventsAfter = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1",
        )
        .get(userId)!.n;
      expect(eventsAfter - eventsBefore).toBe(initiallyVerified ? 0 : 1);
    } finally {
      closeContext(ctx);
    }
  }
});
