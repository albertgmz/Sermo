import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser } from "@sermo/core/testing";
import { dispatchEvents } from "../../events";
import { runDueJobs } from "../jobs/queue";
import { queueAccountEmail, registerAccountEmailJobs } from "./account";
import { registerEmailJobs } from "./index";

test("account mail bypasses the cap, uses member language, and honors suppression", async () => {
  const ctx = createTestContext();
  const member = insertUser(ctx, { username: "Reader" });
  const email = ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(member.id)!.email;
  ctx.sqlite
    .prepare("UPDATE users SET language = 'es', email_window_count = 999 WHERE id = ?1")
    .run(member.id);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  registerAccountEmailJobs(ctx);
  expectNoTableScan(ctx, "SELECT language FROM users WHERE id = ?1", [member.id]);
  expectNoTableScan(ctx, "SELECT id FROM undeliverable_emails WHERE email = ?1", [email]);
  queueAccountEmail(ctx, { kind: "passwordChanged", userId: member.id, email });
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(1);
  expect(capture.messages[0]?.subject).toContain("contraseña");
  expect(capture.messages[0]?.headers).toBeUndefined();
  expect(
    ctx.sqlite
      .prepare<{ email_window_count: number }, [number]>(
        "SELECT email_window_count FROM users WHERE id = ?1",
      )
      .get(member.id)?.email_window_count,
  ).toBe(999);

  ctx.sqlite
    .prepare(
      "INSERT INTO undeliverable_emails (email, reason, created_at) VALUES (?1, 'bad address', ?2)",
    )
    .run(email.toLowerCase(), ctx.now());
  queueAccountEmail(ctx, { kind: "welcome", userId: member.id, email: email.toUpperCase() });
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(1);
});

test("ban mail ignores history, silence, lifted and expired bans, and localizes the active notice", async () => {
  const ctx = createTestContext();
  const member = insertUser(ctx, { username: "Banned" });
  ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(member.id);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  const insertBan = (expiresAt: number | null) =>
    Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?1, 'reason', ?2, ?3)",
        )
        .run(member.id, ctx.now(), expiresAt).lastInsertRowid,
    );
  const publishBan = (banId: number, notify: boolean, message = "") => {
    ctx.sqlite
      .prepare(
        "INSERT INTO domain_events (type, target_type, target_id, payload, created_at) VALUES ('member.banned', 'user', ?1, ?2, ?3)",
      )
      .run(
        member.id,
        JSON.stringify({
          banId,
          reason: "reason",
          message,
          notify,
          expiresAt: new Date(ctx.now() + 86_400_000).toISOString(),
          lifted: false,
        }),
        ctx.now(),
      );
  };
  const historical = insertBan(ctx.now() + 86_400_000);
  publishBan(historical, true);
  registerAccountEmailJobs(ctx);
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(0);

  const silent = insertBan(ctx.now() + 86_400_000);
  publishBan(silent, false);
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(0);

  const lifted = insertBan(ctx.now() + 86_400_000);
  publishBan(lifted, true);
  await dispatchEvents(ctx);
  ctx.sqlite.prepare("UPDATE bans SET lifted_at = ?1 WHERE id = ?2").run(ctx.now(), lifted);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(0);

  const expired = insertBan(ctx.now() - 1);
  publishBan(expired, true);
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(0);

  const expiry = ctx.now() + 86_400_000;
  const active = insertBan(expiry);
  publishBan(active, true, "Nota del moderador");
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(1);
  const text = capture.messages[0]!.text;
  expect(text).toContain("Nota del moderador");
  expect(text).not.toContain("reason");
  expect(text).toContain(
    new Intl.DateTimeFormat("es", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(expiry)),
  );
  expect(text).not.toContain(new Date(expiry).toISOString());
  expect(text).toContain("UTC");
  publishBan(active, true, "Replay of the same ban");
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(1);
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [string]>("SELECT name FROM event_subscribers WHERE name = ?1")
      .get(`email.account.ban.${active}`)?.name,
  ).toBe(`email.account.ban.${active}`);
});

test("account send failures are recorded and retried", async () => {
  const ctx = createTestContext();
  const member = insertUser(ctx, { username: "Reader" });
  const email = ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(member.id)!.email;
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  registerAccountEmailJobs(ctx);
  capture.send = async () => {
    throw new Error("temporary failure");
  };
  queueAccountEmail(ctx, { kind: "welcome", userId: member.id, email });
  await runDueJobs(ctx);
  expect(
    ctx.sqlite
      .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.account'")
      .get()?.status,
  ).toBe("pending");
  expect(
    ctx.sqlite.prepare<{ permanent: number }, []>("SELECT permanent FROM email_failures").get()
      ?.permanent,
  ).toBe(0);
});
