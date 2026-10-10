import { describe, expect, spyOn, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertNode, insertUser } from "@sermo/core/testing";
import { SMTPServer } from "smtp-server";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { phrase } from "../../i18n";
import type { CaptureMailer } from "../../mail";
import { execute } from "../../operation";
import { enqueueJob, MAX_ATTEMPTS, runDueJobs } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import {
  closeEmail,
  deliverEmail,
  type EmailItem,
  emailSql,
  enhancedStatus,
  registerEmailJobs,
  registerEmailTypes,
  runWeeklyDigest,
  unsubscribeOp,
} from "./index";
import * as token from "./token";
import { signUnsubscribe } from "./token";

const defaults = {
  "watch.thread": { inApp: true, email: true, push: false },
  "security.login": { inApp: true, email: true, push: false },
  "digest.weekly": { inApp: false, email: true, push: false },
};
const registry = { defaults, securityTypes: new Set(["security.login"]) };

function fixture() {
  const ctx = createTestContext();
  const author = insertUser(ctx, { username: "Author" });
  const reader = insertUser(ctx, { username: "Reader" });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const threadId = ctx.sqlite
    .prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, '<script>alert(1)</script>', ?3, ?3, ?2) RETURNING id",
    )
    .get(node.id, author.id, ctx.now())!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, 1, ?3)",
    )
    .run(reader.id, threadId, ctx.now());
  const id = ctx.sqlite
    .prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 'watch.thread', 'thread', ?2, ?2, ?3, ?3) RETURNING id",
    )
    .get(reader.id, threadId, ctx.now())!.id;
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    registry,
  )!;
  const item = {
    notificationId: id,
    userId: reader.id,
    type: "watch.thread",
    contentType: "thread",
    contentId: threadId,
    threadId,
    actorId: author.id,
    data: {},
  };
  return { ctx, author, reader, node, threadId, id, capture, item };
}

describe("email channel", () => {
  test("notification delivery can enqueue inside the creator's transaction", async () => {
    const f = fixture();
    writeTx(f.ctx, () => deliverEmail(f.ctx, [f.item], registry));
    deliverEmail(f.ctx, [f.item], registry);
    expect(
      f.ctx.sqlite
        .prepare<{ email_window_count: number }, [number]>(
          "SELECT email_window_count FROM users WHERE id = ?1",
        )
        .get(f.reader.id)?.email_window_count,
    ).toBe(1);
    expect(await runDueJobs(f.ctx)).toBe(1);
    expect(f.capture.messages).toHaveLength(1);
    deliverEmail(f.ctx, [f.item], registry);
    expect(await runDueJobs(f.ctx)).toBe(0);
  });
  test("English and Spanish ICU plurals and hot lookups", () => {
    expect(phrase("en", "email.digest.body", { count: 1 })).toContain("1 active discussion");
    expect(phrase("en", "email.digest.body", { count: 2 })).toContain("2 active discussions");
    expect(phrase("es", "email.digest.body", { count: 1 })).toContain("1 tema activo");
    expect(phrase("es", "email.digest.body", { count: 2 })).toContain("2 temas activos");
    const f = fixture();
    expectNoTableScan(f.ctx, "SELECT id FROM undeliverable_emails WHERE email = ?1", [
      "reader@example.test",
    ]);
    expectNoTableScan(
      f.ctx,
      "SELECT email FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2",
      [f.threadId, f.reader.id],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT id, title, node_id, state, reply_count, last_post_at FROM threads WHERE state = 'visible' AND last_post_at >= ?1 ORDER BY last_post_at DESC, id DESC LIMIT 2000",
      [f.ctx.now() - 7 * 86_400_000],
    );
  });

  test("queues a localized multipart message with safe title, thread headers, and unsubscribe links", async () => {
    const f = fixture();
    f.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(f.reader.id);
    deliverEmail(f.ctx, [f.item], registry);
    expect(await runDueJobs(f.ctx)).toBe(1);
    expect(f.capture.messages).toHaveLength(1);
    const message = f.capture.messages[0]!;
    expect(message.text).toContain("<script>alert(1)</script>");
    expect(message.html).not.toContain("<script>alert(1)</script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.messageId).toContain(`thread-${f.threadId}`);
    expect(message.inReplyTo).toContain(`thread-${f.threadId}`);
    expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(message.text).toContain("Dejar de recibir");
    const stored = f.ctx.sqlite
      .prepare<{ email_sent_at: number | null; data: string }, [number]>(
        "SELECT email_sent_at, data FROM notifications WHERE id = ?1",
      )
      .get(f.id)!;
    expect(stored.email_sent_at).not.toBeNull();
    expect(stored.data).not.toContain("_emailSentAt");
  });

  test("signed links unsubscribe without a session and reject tampering; security mail stays enabled", async () => {
    const f = fixture();
    const token = await signUnsubscribe(f.ctx, f.reader.id, "watch.thread");
    expect(await execute(f.ctx, unsubscribeOp, GUEST, { token })).toEqual({
      scope: "watch.thread",
    });
    const pref = f.ctx.sqlite
      .prepare<{ email: number }, [number]>(
        "SELECT email FROM notification_preferences WHERE user_id = ?1 AND type = 'watch.thread'",
      )
      .get(f.reader.id);
    expect(pref?.email).toBe(0);
    await expect(
      execute(f.ctx, unsubscribeOp, GUEST, { token: `${token.slice(0, -1)}x` }),
    ).rejects.toBeInstanceOf(ValidationError);
    f.ctx.clock.advance(366 * 86_400_000);
    await expect(execute(f.ctx, unsubscribeOp, GUEST, { token })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const all = await signUnsubscribe(f.ctx, f.reader.id, "all");
    expect(await execute(f.ctx, unsubscribeOp, GUEST, { token: all })).toEqual({ scope: "all" });
    expect(
      f.ctx.sqlite
        .prepare<{ email: number }, [number]>(
          "SELECT email FROM notification_preferences WHERE user_id = ?1 AND type = 'digest.weekly'",
        )
        .get(f.reader.id)?.email,
    ).toBe(0);
    expect(
      f.ctx.sqlite
        .prepare(
          "SELECT id FROM notification_preferences WHERE user_id = ?1 AND type = 'security.login'",
        )
        .get(f.reader.id),
    ).toBeNull();
    await expect(
      execute(f.ctx, unsubscribeOp, GUEST, {
        token: await signUnsubscribe(f.ctx, f.reader.id, "security.login"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const stale = await signUnsubscribe(f.ctx, f.reader.id, "watch.thread");
    f.ctx.sqlite
      .prepare("UPDATE auth_user SET email = 'changed@example.test' WHERE id = ?1")
      .run(f.reader.id);
    await expect(execute(f.ctx, unsubscribeOp, GUEST, { token: stale })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("suppresses content hidden after queueing and enforces the hourly cap", async () => {
    const f = fixture();
    deliverEmail(f.ctx, [f.item], registry);
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(f.threadId);
    expect(await runDueJobs(f.ctx)).toBe(1);
    expect(f.capture.messages).toHaveLength(0);
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(f.threadId);
    f.ctx.sqlite
      .prepare("UPDATE users SET email_window_start = ?1, email_window_count = 20 WHERE id = ?2")
      .run(f.ctx.now(), f.reader.id);
    const second = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 'watch.thread', 'thread', ?2, ?2, ?3, ?3) RETURNING id",
      )
      .get(f.reader.id, f.threadId, f.ctx.now())!.id;
    deliverEmail(f.ctx, [{ ...f.item, notificationId: second }], registry);
    expect(await runDueJobs(f.ctx)).toBe(0);
  });

  test("a node hidden after queueing cannot appear in email", async () => {
    const f = fixture();
    deliverEmail(f.ctx, [f.item], registry);
    const permissionId = f.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_definitions WHERE key = 'node.view'")
      .get()!.id;
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 0, ?3, -1)",
      )
      .run(permissionId, f.node.id, f.reader.id);
    invalidate(f.ctx, "permissions");
    await runDueJobs(f.ctx);
    expect(f.capture.messages).toHaveLength(0);
  });

  test("weekly digest queues visible active threads once", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2")
      .run(f.ctx.now() - 5 * 86_400_000, f.reader.id);
    expect(await runWeeklyDigest(f.ctx, registry)).toBeGreaterThan(0);
    expect(await runWeeklyDigest(f.ctx, registry)).toBe(0);
    await runDueJobs(f.ctx);
    expect(f.capture.messages.some((message) => message.subject.includes("weekly digest"))).toBe(
      true,
    );
  });

  test("weekly digest remains eligible when the next sweep starts slightly early", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2")
      .run(f.ctx.now() - 5 * 86_400_000, f.reader.id);
    expect(await runWeeklyDigest(f.ctx, registry)).toBeGreaterThan(0);
    f.ctx.clock.advance(7 * 86_400_000 - 5_000);
    f.ctx.sqlite
      .prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2")
      .run(f.ctx.now(), f.threadId);
    expect(await runWeeklyDigest(f.ctx, registry)).toBeGreaterThan(0);
  });

  test("an unknown pending email type retries until its registry is available", async () => {
    const f = fixture();
    f.ctx.sqlite.prepare("UPDATE notifications SET type = 'later.added' WHERE id = ?1").run(f.id);
    deliverEmail(f.ctx, [f.item], registry);
    await runDueJobs(f.ctx);
    expect(
      f.ctx.sqlite
        .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.send'")
        .get()?.status,
    ).toBe("pending");
    expect(f.capture.messages).toHaveLength(0);
  });

  test("a missing signing secret records a permanent failure after the final retry", async () => {
    const f = fixture();
    deliverEmail(f.ctx, [f.item], registry);
    f.ctx.config.auth!.secret = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      await runDueJobs(f.ctx);
      const next = f.ctx.sqlite
        .prepare<{ run_at: number }, []>("SELECT run_at FROM jobs WHERE type = 'email.send'")
        .get()!.run_at;
      f.ctx.clock.set(next);
    }
    expect(
      f.ctx.sqlite
        .prepare<{ permanent: number }, []>(
          "SELECT permanent FROM email_failures ORDER BY id DESC LIMIT 1",
        )
        .get()?.permanent,
    ).toBe(1);
    expect(
      f.ctx.sqlite
        .prepare<{ email_sent_at: number | null }, [number]>(
          "SELECT email_sent_at FROM notifications WHERE id = ?1",
        )
        .get(f.id)?.email_sent_at,
    ).toBeNull();
  });

  test("conversation message text follows the privacy setting", async () => {
    const f = fixture();
    const registryWithConversation = {
      ...registry,
      defaults: {
        ...defaults,
        "conversation.new": { inApp: true, email: true, push: false },
      },
    };
    const conversationId = f.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('Private', ?1, ?2, ?2, ?1) RETURNING id",
      )
      .get(f.author.id, f.ctx.now())!.id;
    f.ctx.sqlite
      .prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_message_at) VALUES (?1, ?2, ?3, ?3)",
      )
      .run(conversationId, f.reader.id, f.ctx.now());
    const messageId = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'secret phrase', '<p>secret phrase</p>') RETURNING id",
      )
      .get(conversationId, f.author.id, f.ctx.now())!.id;
    const notify = () =>
      f.ctx.sqlite
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'conversation.new', 'conversation_message', ?2, ?3, ?3) RETURNING id",
        )
        .get(f.reader.id, messageId, f.ctx.now())!.id;
    deliverEmail(
      f.ctx,
      [
        {
          ...f.item,
          notificationId: notify(),
          type: "conversation.new",
          contentType: "conversation_message",
          contentId: messageId,
          threadId: null,
        },
      ],
      registryWithConversation,
    );
    await runDueJobs(f.ctx);
    expect(f.capture.messages.at(-1)?.text).not.toContain("secret phrase");
    const settings = readSiteSettings(f.ctx);
    f.ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify({ ...settings, conversationEmailIncludesBody: true }), f.ctx.now());
    deliverEmail(
      f.ctx,
      [
        {
          ...f.item,
          notificationId: notify(),
          type: "conversation.new",
          contentType: "conversation_message",
          contentId: messageId,
          threadId: null,
        },
      ],
      registryWithConversation,
    );
    await runDueJobs(f.ctx);
    expect(f.capture.messages.at(-1)?.text).toContain("secret phrase");
  });

  test("security email bypasses opt-out and cap and has no unsubscribe headers", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO notification_preferences (user_id, type, email) VALUES (?1, 'security.login', 0)",
      )
      .run(f.reader.id);
    f.ctx.sqlite
      .prepare("UPDATE users SET email_window_start = ?1, email_window_count = 20 WHERE id = ?2")
      .run(f.ctx.now(), f.reader.id);
    const id = f.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'security.login', 'security', ?1, ?2, ?2) RETURNING id",
      )
      .get(f.reader.id, f.ctx.now())!.id;
    f.ctx.sqlite
      .prepare("UPDATE notifications SET read_at = ?1, epoch = 0 WHERE id = ?2")
      .run(f.ctx.now(), id);
    f.ctx.sqlite.prepare("UPDATE users SET notification_epoch = 1 WHERE id = ?1").run(f.reader.id);
    deliverEmail(
      f.ctx,
      [
        {
          ...f.item,
          notificationId: id,
          type: "security.login",
          contentType: "security",
          contentId: f.reader.id,
          threadId: null,
        },
      ],
      registry,
    );
    await runDueJobs(f.ctx);
    expect(f.capture.messages).toHaveLength(1);
    expect(f.capture.messages[0]?.headers).toBeUndefined();
  });

  test("digest filters a node denied to the recipient", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2")
      .run(f.ctx.now(), f.author.id);
    const permissionId = f.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_definitions WHERE key = 'node.view'")
      .get()!.id;
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 0, ?3, -1)",
      )
      .run(permissionId, f.node.id, f.reader.id);
    invalidate(f.ctx, "permissions");
    expect(await runWeeklyDigest(f.ctx, registry)).toBe(0);
  });

  for (const [code, enhanced, expectedStatus] of [
    [550, "5.1.1", "done"],
    [450, "4.2.0", "pending"],
    [554, "5.7.1", "pending"],
  ] as const) {
    test(`SMTP RCPT ${code} ${code === 550 ? "suppresses address" : "retries"}`, async () => {
      const f = fixture();
      const server = new SMTPServer({
        authOptional: true,
        disabledCommands: ["STARTTLS"],
        onRcptTo(_address, _session, callback) {
          const error = Object.assign(new Error(`${enhanced} Rejected for test`), {
            responseCode: code,
          });
          callback(error);
        },
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.server.address();
        if (!address || typeof address === "string") throw new Error("No SMTP port.");
        registerEmailJobs(
          f.ctx,
          {
            driver: "smtp",
            sender: "forum@example.test",
            host: "127.0.0.1",
            port: address.port,
            secure: false,
          },
          registry,
        );
        deliverEmail(f.ctx, [f.item], registry);
        await runDueJobs(f.ctx);
        const job = f.ctx.sqlite
          .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.send'")
          .get();
        expect(job?.status).toBe(expectedStatus);
        const undeliverable = f.ctx.sqlite
          .prepare<{ email: string }, []>("SELECT email FROM undeliverable_emails")
          .get();
        expect(Boolean(undeliverable)).toBe(code === 550);
        if (expectedStatus === "pending") {
          for (let attempt = 2; attempt <= 5; attempt++) {
            const next = f.ctx.sqlite
              .prepare<{ run_at: number }, []>("SELECT run_at FROM jobs WHERE type = 'email.send'")
              .get()!.run_at;
            f.ctx.clock.set(next);
            await runDueJobs(f.ctx);
          }
          expect(
            f.ctx.sqlite
              .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.send'")
              .get()?.status,
          ).toBe("failed");
          expect(
            f.ctx.sqlite
              .prepare<{ permanent: number }, []>(
                "SELECT permanent FROM email_failures ORDER BY id DESC LIMIT 1",
              )
              .get()?.permanent,
          ).toBe(1);
          expect(f.ctx.sqlite.prepare("SELECT id FROM undeliverable_emails").get()).toBeNull();
        }
      } finally {
        await new Promise<void>((resolve) => server.close(resolve));
      }
    });
  }
});

type TestCtx = ReturnType<typeof createTestContext>;

function smtpError(message: string, fields: { code: string; command: string; response?: string }) {
  const error = Object.assign(new Error(message), fields);
  if (fields.response) Object.assign(error, { responseCode: Number(fields.response.slice(0, 3)) });
  return error;
}

function digestFixture(members: number) {
  const ctx = createTestContext();
  const author = insertUser(ctx, { username: "Author" });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  ctx.sqlite
    .prepare(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Recent', ?3, ?3, ?2)",
    )
    .run(node.id, author.id, ctx.now());
  const users = Array.from({ length: members }, (_, i) => insertUser(ctx, { username: `M${i}` }));
  ctx.sqlite.prepare("UPDATE users SET last_activity_at = ?1").run(ctx.now() - 30 * 86_400_000);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    registry,
  )!;
  const emailOf = (id: number) =>
    ctx.sqlite
      .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
      .get(id)!.email;
  return { ctx, author, node, users, capture, emailOf };
}

/** Runs due jobs, moving the clock to each next pending job, until none is left. */
async function drain(ctx: TestCtx) {
  for (let i = 0; i < 50; i++) {
    await runDueJobs(ctx);
    const next = ctx.sqlite
      .prepare<{ at: number | null }, []>(
        "SELECT min(run_at) AS at FROM jobs WHERE status = 'pending'",
      )
      .get()?.at;
    if (!next) return;
    if (next > ctx.now()) ctx.clock.set(next);
  }
  throw new Error("Jobs did not settle.");
}

function failingFor(
  capture: CaptureMailer,
  address: string,
  error: () => Error,
  times = Number.POSITIVE_INFINITY,
) {
  const send = capture.send.bind(capture);
  let failures = 0;
  capture.send = async (message) => {
    if (message.to === address && failures < times) {
      failures++;
      throw error();
    }
    return send(message);
  };
}

describe("weekly digest delivery failures", () => {
  test("a recipient refused by the server is recorded and the run goes on", async () => {
    const f = digestFixture(60);
    const bad = f.emailOf(f.users[3]!.id);
    failingFor(f.capture, bad, () =>
      smtpError("Can't send mail - all recipients were rejected: 552 5.2.2 Mailbox full", {
        code: "EENVELOPE",
        command: "RCPT TO",
        response: "552 5.2.2 Mailbox full",
      }),
    );
    enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
    await drain(f.ctx);
    const recipients = f.capture.messages.map((message) => message.to);
    expect(recipients).toHaveLength(60);
    expect(new Set(recipients).size).toBe(60);
    expect(recipients).not.toContain(bad);
    expect(
      f.ctx.sqlite
        .prepare<{ email: string; permanent: number }, []>(
          "SELECT email, permanent FROM email_failures",
        )
        .all(),
    ).toEqual([{ email: bad, permanent: 1 }]);
    expect(f.ctx.sqlite.prepare("SELECT id FROM undeliverable_emails").get()).toBeNull();
    expect(f.ctx.sqlite.prepare("SELECT id FROM jobs WHERE status = 'failed'").get()).toBeNull();
  });

  test("a connection failure queues the rest of the run from the failing member", async () => {
    const f = digestFixture(10);
    const bad = f.emailOf(f.users[3]!.id);
    failingFor(
      f.capture,
      bad,
      () => smtpError("Connection closed unexpectedly", { code: "ECONNECTION", command: "CONN" }),
      1,
    );
    enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
    await runDueJobs(f.ctx);
    expect(f.capture.messages.map((message) => message.to)).not.toContain(bad);
    const pending = f.ctx.sqlite
      .prepare<{ run_at: number }, []>(
        "SELECT run_at FROM jobs WHERE type = 'email.digest.sweep' AND status = 'pending'",
      )
      .all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.run_at).toBeGreaterThan(f.ctx.now());
    await drain(f.ctx);
    const recipients = f.capture.messages.map((message) => message.to);
    expect(recipients).toHaveLength(11);
    expect(new Set(recipients).size).toBe(11);
    expect(f.ctx.sqlite.prepare("SELECT id FROM jobs WHERE status = 'failed'").get()).toBeNull();
  });

  test("a temporary refusal is retried later instead of skipping the member", async () => {
    const f = digestFixture(10);
    const bad = f.emailOf(f.users[3]!.id);
    failingFor(
      f.capture,
      bad,
      () =>
        smtpError("Can't send mail - all recipients were rejected: 451 4.7.1 Rate limited", {
          code: "EENVELOPE",
          command: "RCPT TO",
          response: "451 4.7.1 Rate limited",
        }),
      1,
    );
    enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
    await drain(f.ctx);
    const recipients = f.capture.messages.map((message) => message.to);
    expect(recipients).toHaveLength(11);
    expect(recipients).toContain(bad);
    expect(
      f.ctx.sqlite.prepare<{ permanent: number }, []>("SELECT permanent FROM email_failures").all(),
    ).toEqual([{ permanent: 0 }]);
  });

  test("a member whose delivery keeps timing out is skipped after the last retry", async () => {
    const f = digestFixture(10);
    const bad = f.emailOf(f.users[3]!.id);
    failingFor(f.capture, bad, () => smtpError("Timeout", { code: "ETIMEDOUT", command: "CONN" }));
    enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
    await drain(f.ctx);
    const recipients = f.capture.messages.map((message) => message.to);
    expect(recipients).toHaveLength(10);
    expect(recipients).not.toContain(bad);
    const failures = f.ctx.sqlite
      .prepare<{ permanent: number }, []>("SELECT permanent FROM email_failures ORDER BY id")
      .all();
    expect(failures).toHaveLength(MAX_ATTEMPTS + 1);
    expect(failures.at(-1)?.permanent).toBe(1);
    expect(f.ctx.sqlite.prepare("SELECT id FROM jobs WHERE status = 'failed'").get()).toBeNull();
  });

  test("a released claim restores the member's previous digest time", async () => {
    const f = digestFixture(2);
    const earlier = f.ctx.now() - 8 * 86_400_000;
    f.ctx.sqlite
      .prepare("UPDATE users SET last_digest_at = ?1 WHERE id = ?2")
      .run(earlier, f.users[0]!.id);
    for (const user of f.users)
      failingFor(f.capture, f.emailOf(user.id), () =>
        smtpError("Message failed: 552 5.2.2 Mailbox full", {
          code: "EMESSAGE",
          command: "DATA",
          response: "552 5.2.2 Mailbox full",
        }),
      );
    await runWeeklyDigest(f.ctx, registry);
    const lastDigest = (id: number) =>
      f.ctx.sqlite
        .prepare<{ at: number | null }, [number]>(
          "SELECT last_digest_at AS at FROM users WHERE id = ?1",
        )
        .get(id)!.at;
    expect(lastDigest(f.users[0]!.id)).toBe(earlier);
    expect(lastDigest(f.users[1]!.id)).toBeNull();
  });

  test("digests are exempt from the hourly cap", async () => {
    const f = digestFixture(1);
    f.ctx.sqlite
      .prepare("UPDATE users SET email_window_start = ?1, email_window_count = 999 WHERE id = ?2")
      .run(f.ctx.now(), f.users[0]!.id);
    expect(await runWeeklyDigest(f.ctx, registry)).toBe(2);
  });

  test("visibility is resolved per permission combination within one run", async () => {
    const f = digestFixture(2);
    const hidden = insertNode(f.ctx, {});
    invalidate(f.ctx, "node_tree");
    f.ctx.sqlite
      .prepare(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Private', ?3, ?3, ?2)",
      )
      .run(hidden.id, f.author.id, f.ctx.now());
    const permissionId = f.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_definitions WHERE key = 'node.view'")
      .get()!.id;
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 0, ?3, -1)",
      )
      .run(permissionId, hidden.id, f.users[0]!.id);
    invalidate(f.ctx, "permissions");
    await runWeeklyDigest(f.ctx, registry);
    const textFor = (id: number) =>
      f.capture.messages.find((message) => message.to === f.emailOf(id))!.text;
    expect(textFor(f.users[0]!.id)).not.toContain("Private");
    expect(textFor(f.users[0]!.id)).toContain("Recent");
    expect(textFor(f.users[1]!.id)).toContain("Private");
  });
});

describe("email registration and links", () => {
  test("registered types belong to their context", async () => {
    const later = {
      defaults: { "later.added": { inApp: true, email: true, push: false } },
      securityTypes: new Set<string>(),
    };
    const results: string[] = [];
    for (const register of [true, false]) {
      const f = fixture();
      if (register) registerEmailTypes(f.ctx, later);
      f.ctx.sqlite.prepare("UPDATE notifications SET type = 'later.added' WHERE id = ?1").run(f.id);
      deliverEmail(f.ctx, [f.item], registry);
      await runDueJobs(f.ctx);
      results.push(
        f.ctx.sqlite
          .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.send'")
          .get()!.status,
      );
    }
    expect(results).toEqual(["done", "pending"]);
  });

  test("replacing the transport closes the previous one", async () => {
    const f = fixture();
    const closed = Promise.withResolvers<void>();
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        stream.on("data", () => {});
        stream.on("end", () => callback());
      },
      onClose() {
        closed.resolve();
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.server.address();
      if (!address || typeof address === "string") throw new Error("No SMTP port.");
      registerEmailJobs(
        f.ctx,
        {
          driver: "smtp",
          sender: "forum@example.test",
          host: "127.0.0.1",
          port: address.port,
          secure: false,
        },
        registry,
      );
      deliverEmail(f.ctx, [f.item], registry);
      await runDueJobs(f.ctx);
      registerEmailJobs(f.ctx, { driver: "capture", sender: "forum@example.test" }, registry);
      await Promise.race([
        closed.promise,
        Bun.sleep(2_000).then(() => {
          throw new Error("The pooled connection stayed open.");
        }),
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  test("unsubscribe links sign the current address without carrying it", async () => {
    const f = fixture();
    const token = await signUnsubscribe(f.ctx, f.reader.id, "watch.thread");
    const [payload, signature] = token.split(".") as [string, string];
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(["expiresAt", "scope", "userId"]);
    expect(decoded).not.toContain("@");
    const encoder = new TextEncoder();
    const source = await crypto.subtle.importKey(
      "raw",
      encoder.encode(f.ctx.config.auth!.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const derived = await crypto.subtle.sign(
      "HMAC",
      source,
      encoder.encode("sermo:unsubscribe:v1"),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      derived,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${payload}.reader@example.test`),
    );
    expect(Buffer.from(expected).toString("base64url")).toBe(signature);
  });
});

describe("notification email cost", () => {
  test("100 queued emails take well under 5 ms inside the batch transaction", () => {
    const f = fixture();
    const items: EmailItem[] = [];
    for (let i = 0; i < 100; i++) {
      const user = insertUser(f.ctx, { username: `Watcher${i}` });
      f.ctx.sqlite
        .prepare(
          "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, 1, ?3)",
        )
        .run(user.id, f.threadId, f.ctx.now());
      const id = f.ctx.sqlite
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 'watch.thread', 'thread', ?2, ?2, ?3, ?3) RETURNING id",
        )
        .get(user.id, f.threadId, f.ctx.now())!.id;
      items.push({ ...f.item, notificationId: id, userId: user.id });
    }
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      f.ctx.sqlite.exec("DELETE FROM jobs; UPDATE users SET email_window_count = 0");
      const start = performance.now();
      writeTx(f.ctx, () => deliverEmail(f.ctx, items, registry));
      times.push(performance.now() - start);
      expect(
        f.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()!.n,
      ).toBe(100);
    }
    console.info(`deliverEmail, 100 items: best ${Math.min(...times).toFixed(2)} ms`);
    expect(Math.min(...times)).toBeLessThan(5);
  });

  test("batch lookups use indexes", () => {
    const f = fixture();
    expectNoTableScan(f.ctx, emailSql.preferences, [`[${f.reader.id}]`, '["watch.thread"]']);
    expectNoTableScan(f.ctx, emailSql.watches, [`[[${f.threadId},${f.reader.id}]]`]);
    expectNoTableScan(f.ctx, emailSql.sent, [`[${f.id}]`]);
  });
});

/** An SMTP server that answers every RCPT TO with a scripted (possibly multi-line) reply. */
function scriptedServer(rcptReply: string) {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write("220 test ESMTP\r\n");
      },
      data(socket, data) {
        for (const line of data.toString().split("\r\n").filter(Boolean)) {
          const command = line.toUpperCase();
          if (command.startsWith("EHLO")) socket.write("250-test\r\n250 8BITMIME\r\n");
          else if (command.startsWith("RCPT TO")) socket.write(`${rcptReply}\r\n`);
          else if (command.startsWith("QUIT")) {
            socket.write("221 bye\r\n");
            socket.end();
          } else socket.write("250 ok\r\n");
        }
      },
    },
  });
}

describe("SMTP rejection classification", () => {
  for (const [name, reply, suppressed] of [
    ["550 5.1.1 unknown user", "550 5.1.1 <r@x>: Recipient address rejected: User unknown", true],
    ["550 5.7.1 policy refusal", "550 5.7.1 <r@x>: Relay access denied", false],
    ["553 5.7.1 sender refusal", "553 5.7.1 Sender not authorized", false],
    [
      "multi-line 5.1.1",
      "550-5.1.1 The email account that you tried to reach does not exist.\r\n550 5.1.1 Please check the address",
      true,
    ],
    [
      "multi-line 5.7.26",
      "550-5.7.26 Unauthenticated email is not accepted\r\n550 5.7.26 See the sender guidelines",
      false,
    ],
    ["bare 550 relaying refusal", "550 Relaying denied", false],
    [
      "bare 550 without an enhanced code",
      "550 Requested action not taken: mailbox unavailable",
      false,
    ],
    ["552 5.2.2 mailbox full", "552 5.2.2 Mailbox full", false],
  ] as const) {
    test(`${name} ${suppressed ? "suppresses" : "keeps"} the address`, async () => {
      const server = scriptedServer(reply);
      try {
        const f = fixture();
        registerEmailJobs(
          f.ctx,
          {
            driver: "smtp",
            sender: "forum@example.test",
            host: "127.0.0.1",
            port: server.port,
            secure: false,
          },
          registry,
        );
        deliverEmail(f.ctx, [f.item], registry);
        await runDueJobs(f.ctx);
        closeEmail(f.ctx);
        expect(Boolean(f.ctx.sqlite.prepare("SELECT id FROM undeliverable_emails").get())).toBe(
          suppressed,
        );
        expect(f.ctx.sqlite.prepare("SELECT id FROM email_failures").get()).not.toBeNull();
        // A kept address is retried later; a suppressed one is finished.
        expect(
          f.ctx.sqlite
            .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'email.send'")
            .get()?.status,
        ).toBe(suppressed ? "done" : "pending");
      } finally {
        server.stop(true);
      }
    });
  }

  test("the enhanced status is read only right after a reply code", () => {
    expect(enhancedStatus("550 5.7.1 Relay denied")).toBe("5.7.1");
    expect(enhancedStatus("550-5.1.1 First\r\n550 5.1.1 Last")).toBe("5.1.1");
    expect(enhancedStatus("550 mailbox unavailable (5.7.1 policy)")).toBeNull();
    expect(enhancedStatus("550 User 5.1.1 unknown")).toBeNull();
  });
});

describe("weekly digest members and batches", () => {
  const lastDigest = (ctx: TestCtx, id: number) =>
    ctx.sqlite
      .prepare<{ at: number | null }, [number]>(
        "SELECT last_digest_at AS at FROM users WHERE id = ?1",
      )
      .get(id)!.at;
  const dataError = (response: string) =>
    smtpError(`Message failed: ${response}`, { code: "EMESSAGE", command: "DATA", response });

  test("a member whose message cannot be built is recorded and skipped", async () => {
    const f = digestFixture(4);
    const bad = f.users[1]!.id;
    const real = token.signUnsubscribe;
    const sign = spyOn(token, "signUnsubscribe");
    sign.mockImplementation(async (ctx, userId, scope) => {
      if (userId === bad) throw new Error("Broken template data");
      return real(ctx, userId, scope);
    });
    try {
      enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
      await drain(f.ctx);
    } finally {
      sign.mockRestore();
    }
    expect(f.capture.messages.map((message) => message.to)).not.toContain(f.emailOf(bad));
    expect(f.capture.messages).toHaveLength(4);
    expect(
      f.ctx.sqlite
        .prepare<{ user_id: number; permanent: number }, []>(
          "SELECT user_id, permanent FROM email_failures",
        )
        .all(),
    ).toEqual([{ user_id: bad, permanent: 1 }]);
    expect(lastDigest(f.ctx, bad)).toBeNull();
    expect(f.ctx.sqlite.prepare("SELECT id FROM jobs WHERE status <> 'done'").get()).toBeNull();
  });

  test("a mailbox status is the member's own failure; a policy refusal defers the run", async () => {
    const one = digestFixture(4);
    failingFor(one.capture, one.emailOf(one.users[1]!.id), () =>
      dataError("552 5.2.3 Message exceeds the mailbox limit"),
    );
    await runWeeklyDigest(one.ctx, registry);
    expect(one.capture.messages).toHaveLength(4);
    expect(one.ctx.sqlite.prepare("SELECT id FROM jobs").get()).toBeNull();

    const policy = digestFixture(4);
    failingFor(policy.capture, policy.emailOf(policy.users[1]!.id), () =>
      smtpError("Can't send mail - all recipients were rejected: 550 5.7.1 Relaying denied", {
        code: "EENVELOPE",
        command: "RCPT TO",
        response: "550 5.7.1 Relaying denied",
      }),
    );
    await runWeeklyDigest(policy.ctx, registry);
    expect(policy.capture.messages).toHaveLength(2);
    const continuation = policy.ctx.sqlite
      .prepare<{ payload: string; run_at: number }, []>("SELECT payload, run_at FROM jobs")
      .get()!;
    expect(JSON.parse(continuation.payload).after).toBe(policy.users[0]!.id);
    expect(continuation.run_at).toBeGreaterThan(policy.ctx.now());
    expect(
      policy.ctx.sqlite.prepare("SELECT id FROM email_failures WHERE permanent = 1").get(),
    ).toBeNull();
  });

  test("a message too large at MAIL FROM is the member's own failure", async () => {
    const f = digestFixture(4);
    failingFor(f.capture, f.emailOf(f.users[1]!.id), () =>
      smtpError("Message size larger than allowed 1000", {
        code: "EMESSAGE",
        command: "MAIL FROM",
      }),
    );
    await runWeeklyDigest(f.ctx, registry);
    expect(f.capture.messages).toHaveLength(4);
    expect(f.ctx.sqlite.prepare("SELECT id FROM jobs").get()).toBeNull();
  });

  test("an account-wide refusal backs the whole run off without marking anyone", async () => {
    const f = digestFixture(30);
    f.capture.send = async () => {
      throw dataError("550 5.7.26 Unauthenticated email is not accepted");
    };
    enqueueJob(f.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
    await drain(f.ctx);
    expect(f.capture.messages).toHaveLength(0);
    expect(
      f.ctx.sqlite
        .prepare<{ permanent: number; n: number }, []>(
          "SELECT permanent, count(*) AS n FROM email_failures GROUP BY permanent",
        )
        .all(),
    ).toEqual([{ permanent: 0, n: MAX_ATTEMPTS }]);
    expect(
      f.ctx.sqlite
        .prepare<{ status: string; attempts: number }, []>("SELECT status, attempts FROM jobs")
        .all(),
    ).toEqual([{ status: "failed", attempts: MAX_ATTEMPTS }]);
    expect(f.ctx.sqlite.prepare("SELECT id FROM undeliverable_emails").get()).toBeNull();
    expect(
      f.ctx.sqlite.prepare("SELECT id FROM users WHERE last_digest_at IS NOT NULL").get(),
    ).toBeNull();
  });

  test("each member is re-read when their digest is built", async () => {
    const f = digestFixture(4);
    const [first, , banned, moved] = f.users as [
      (typeof f.users)[0],
      (typeof f.users)[0],
      (typeof f.users)[0],
      (typeof f.users)[0],
    ];
    const send = f.capture.send.bind(f.capture);
    f.capture.send = async (message) => {
      if (message.to === f.emailOf(first.id)) {
        f.ctx.sqlite
          .prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1")
          .run(banned.id);
        f.ctx.sqlite
          .prepare("UPDATE auth_user SET email = 'moved@example.test' WHERE id = ?1")
          .run(moved.id);
      }
      return send(message);
    };
    await runWeeklyDigest(f.ctx, registry);
    const recipients = f.capture.messages.map((message) => message.to);
    expect(recipients).not.toContain(f.emailOf(banned.id));
    expect(recipients).toContain("moved@example.test");
    expect(lastDigest(f.ctx, banned.id)).toBeNull();
  });

  test("members with no visible thread left or an undeliverable address keep no claim", async () => {
    const f = digestFixture(3);
    f.ctx.sqlite
      .prepare("INSERT INTO undeliverable_emails (email, reason, created_at) VALUES (?1, 'x', ?2)")
      .run(f.emailOf(f.users[2]!.id), f.ctx.now());
    const send = f.capture.send.bind(f.capture);
    f.capture.send = async (message) => {
      f.ctx.sqlite.exec("UPDATE threads SET state = 'deleted'");
      return send(message);
    };
    await runWeeklyDigest(f.ctx, registry);
    expect(f.capture.messages).toHaveLength(1);
    expect(lastDigest(f.ctx, f.users[0]!.id)).toBeNull();
    expect(lastDigest(f.ctx, f.users[2]!.id)).toBeNull();
  });

  test("a batch claims members a few at a time, so its time box strands no claim", async () => {
    const f = digestFixture(12);
    const send = f.capture.send.bind(f.capture);
    f.capture.send = async (message) => {
      await Bun.sleep(60);
      return send(message);
    };
    const sent = await runWeeklyDigest(f.ctx, registry);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(13);
    expect(
      f.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM users WHERE last_digest_at = ?1",
        )
        .get(f.ctx.now())!.n,
    ).toBe(sent);
  });

  test("two runs keep their own candidate caches", async () => {
    const f = digestFixture(30);
    const first = f.ctx.now();
    await runWeeklyDigest(f.ctx, registry, 0, first);
    const cursor = f.users[23]!.id;
    f.ctx.sqlite
      .prepare(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Later', ?3, ?3, ?2)",
      )
      .run(f.node.id, f.author.id, f.ctx.now());
    f.capture.messages.length = 0;
    await runWeeklyDigest(f.ctx, registry, cursor, first + 1);
    expect(f.capture.messages.every((message) => message.text.includes("Later"))).toBe(true);
    f.ctx.sqlite.prepare("UPDATE users SET last_digest_at = NULL WHERE id > ?1").run(cursor);
    f.capture.messages.length = 0;
    await runWeeklyDigest(f.ctx, registry, cursor, first);
    expect(f.capture.messages.length).toBeGreaterThan(0);
    expect(f.capture.messages.some((message) => message.text.includes("Later"))).toBe(false);
  });
});
