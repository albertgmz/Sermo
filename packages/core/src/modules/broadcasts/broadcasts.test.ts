import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, tokenActor, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { runDueJobs } from "../jobs/queue";
import { ALERT_CHUNK, BROADCAST_JOB, MESSAGE_CHUNK, registerBroadcastJobs } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const call = (name: string, input: unknown = {}, actor = admin) =>
    execute(ctx, getOperation(`broadcasts.${name}`), actor, input);
  registerBroadcastJobs(ctx);
  const sql = (text: string, ...args: unknown[]) =>
    ctx.sqlite.prepare(text).all(...(args as never[]));
  const drain = async () => {
    while (await runDueJobs(ctx, { limit: 1 })) {}
  };
  // What a send is: count the audience, wait for the count, then send what was counted.
  const go = async (input: { content: unknown; rule: unknown }, actor = admin) => {
    await call("count", input, actor);
    await drain();
    return call("send", {}, actor);
  };
  return { ctx, adminUser, admin, call, sql, drain, go };
}
const everyone = { match: "all", conditions: [] };
const message = {
  kind: "message",
  title: "Welcome back",
  body: "Hello [b]everyone[/b]",
};
const alert = { kind: "alert", text: "The forum moves tonight", url: "/pages/moving" };

describe("messages to members", () => {
  test("every reachable member gets a conversation of their own, and the others none", async () => {
    const { ctx, adminUser, call, sql, drain, go } = setup();
    const a = insertUser(ctx);
    const b = insertUser(ctx);
    const banned = insertUser(ctx);
    const erased = insertUser(ctx);
    const unconfirmed = insertUser(ctx, { groupId: 5 });
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned.id);
    ctx.sqlite.prepare("UPDATE users SET erased_at = 1 WHERE id = ?1").run(erased.id);
    const waiting = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET signup_review = 'pending' WHERE id = ?1").run(waiting.id);

    expect(await go({ content: message, rule: everyone })).toEqual({ queued: true });
    await drain();

    const conversations = sql(
      "SELECT c.id, c.title, c.user_id, c.message_count, c.participant_count, c.is_locked, p.user_id AS member FROM conversations c JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id != c.user_id ORDER BY p.user_id",
    );
    // The administrator is in the audience as a member too; one conversation each, not one shared.
    expect(conversations.map((row) => (row as { member: number }).member)).toEqual([a.id, b.id]);
    expect(conversations[0]).toMatchObject({
      title: "Welcome back",
      user_id: adminUser.id,
      message_count: 1,
      participant_count: 2,
      is_locked: 0,
    });
    const own = sql(
      "SELECT conversation_id FROM conversation_participants WHERE user_id = ?1 AND state = 'active'",
      adminUser.id,
    );
    expect(own.length).toBe(3);
    expect(unconfirmed.id).not.toBe(banned.id);
    const body = sql("SELECT body_html FROM conversation_messages ORDER BY id LIMIT 1")[0] as {
      body_html: string;
    };
    expect(body.body_html).toContain("<strong>everyone</strong>");
    // Each member is alerted that they were added, from the sender.
    const alerts = sql(
      "SELECT user_id, actor_id, content_type FROM notifications WHERE type = 'conversation.added' ORDER BY user_id",
    );
    expect(alerts).toEqual([
      { user_id: a.id, actor_id: adminUser.id, content_type: "conversation" },
      { user_id: b.id, actor_id: adminUser.id, content_type: "conversation" },
    ]);
    expect(await call("status")).toMatchObject({
      state: "done",
      kind: "message",
      progress: 1,
      matched: 3,
      sent: 3,
      skipped: 0,
    });
  });

  test("locked conversations, another sender and the sender's list", async () => {
    const { ctx, sql, drain, go } = setup();
    const sender = insertUser(ctx, { groupId: 3 });
    const member = insertUser(ctx);
    await go({
      content: { ...message, senderId: sender.id, locked: true, removeFromSender: true },
      rule: { match: "all", conditions: [{ criterion: "is_member", ids: [member.id] }] },
    });
    await drain();
    expect(sql("SELECT user_id, is_locked, participant_count FROM conversations")).toEqual([
      { user_id: sender.id, is_locked: 1, participant_count: 1 },
    ]);
    expect(sql("SELECT user_id, state FROM conversation_participants ORDER BY user_id")).toEqual(
      [
        { user_id: sender.id, state: "left_ignored" },
        { user_id: member.id, state: "active" },
      ].sort((x, y) => x.user_id - y.user_id),
    );
  });

  test("a rule picks the audience, over several chunks", async () => {
    const { ctx, call, sql, drain, go } = setup();
    const inside: number[] = [];
    for (let i = 0; i < MESSAGE_CHUNK * 2 + 5; i++) {
      const member = insertUser(ctx, i % 2 === 0 ? { groupId: 3 } : {});
      if (i % 2 === 0) inside.push(member.id);
    }
    await go({
      content: message,
      rule: { match: "all", conditions: [{ criterion: "in_group", ids: [3] }] },
    });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    expect((await call("status")).progress).toBeGreaterThan(0);
    expect((await call("status")).state).toBe("running");
    await drain();
    const reached = sql(
      "SELECT user_id FROM conversation_participants WHERE state = 'active' AND user_id != (SELECT MIN(id) FROM users) ORDER BY user_id",
    ).map((row) => (row as { user_id: number }).user_id);
    expect(reached).toEqual(inside);
    expect(await call("status")).toMatchObject({ state: "done", sent: inside.length });
  });

  test("a count sends nothing and says how many would be reached", async () => {
    const { ctx, call, sql, drain } = setup();
    insertUser(ctx);
    insertUser(ctx);
    const noReceive = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(noReceive.id);
    await call("count", { content: message, rule: everyone });
    await drain();
    expect(await call("status")).toMatchObject({
      state: "done",
      dryRun: true,
      matched: 3,
      sent: 0,
    });
    expect(sql("SELECT id FROM conversations")).toEqual([]);
    expect(sql("SELECT id FROM notifications")).toEqual([]);
  });

  test("a send under way is not started twice", async () => {
    const { ctx, call, go } = setup();
    for (let i = 0; i < MESSAGE_CHUNK * 2; i++) insertUser(ctx);
    expect(await go({ content: message, rule: everyone })).toEqual({ queued: true });
    expect(await call("count", { content: message, rule: everyone })).toEqual({ queued: false });
    expect(await call("send", {})).toEqual({ queued: false });
  });
});

describe("a stopped run", () => {
  async function stopped() {
    const world = setup();
    for (let i = 0; i < MESSAGE_CHUNK * 2; i++) insertUser(world.ctx);
    await world.go({ content: message, rule: everyone });
    expect(await runDueJobs(world.ctx, { limit: 1 })).toBe(1);
    expect(await world.call("stop")).toEqual({ stopped: true });
    await world.drain();
    expect((await world.call("status")).state).toBe("stopped");
    expect(world.sql("SELECT id FROM conversations").length).toBe(MESSAGE_CHUNK);
    return world;
  }
  const fixed = { content: { ...message, title: "Fixed" }, rule: everyone };

  test("new content while it is stopped is refused, never taken for the old run", async () => {
    const { call, sql, drain } = await stopped();
    await expect(call("count", fixed)).rejects.toThrow(ConflictError);
    await expect(call("send", {})).rejects.toThrow(ValidationError);
    await drain();
    expect(sql("SELECT id FROM conversations WHERE title = 'Fixed'")).toEqual([]);
    expect((await call("status")).state).toBe("stopped");
  });

  test("resuming continues the old run with its own content", async () => {
    const { call, sql, drain } = await stopped();
    expect(await call("resume", {})).toEqual({ queued: true });
    await drain();
    expect(await call("status")).toMatchObject({ state: "done", sent: MESSAGE_CHUNK * 2 + 1 });
    expect(sql("SELECT DISTINCT title FROM conversations")).toEqual([{ title: "Welcome back" }]);
  });

  test("discarding it frees the slot, and the corrected content goes out", async () => {
    const { call, sql, drain, go } = await stopped();
    expect(await call("discard", {})).toEqual({ discarded: true });
    expect((await call("status")).state).toBe("discarded");
    expect(await call("discard", {})).toEqual({ discarded: false });
    await expect(call("resume", {})).rejects.toThrow(ValidationError);
    await go(fixed);
    await drain();
    expect(sql("SELECT count(*) AS n FROM conversations WHERE title = 'Fixed'")).toEqual([
      { n: MESSAGE_CHUNK * 2 + 1 },
    ]);
    expect(sql("SELECT action FROM moderator_log WHERE action LIKE '%discarded'")).toEqual([
      { action: "broadcast.discarded" },
    ]);
  });

  test("resuming or discarding a send needs the password, and a key cannot", async () => {
    const { adminUser, call } = await stopped();
    const session = { ...userActor(adminUser), interactive: true } as never;
    await expect(call("resume", {}, session)).rejects.toThrow(ValidationError);
    await expect(call("discard", {}, session)).rejects.toThrow(ValidationError);
    await expect(call("resume", {}, tokenActor(adminUser))).rejects.toThrow(ForbiddenError);
  });
});

describe("a count comes before a send", () => {
  test("a send needs a finished count, and sends what was counted", async () => {
    const { ctx, call, drain } = setup();
    insertUser(ctx);
    await expect(call("send", {})).rejects.toThrow(ValidationError);
    await call("count", { content: alert, rule: everyone });
    expect(await call("send", {})).toEqual({ queued: false });
    await drain();
    expect(await call("status")).toMatchObject({ state: "done", dryRun: true, reachable: 2 });
    expect(await call("send", {})).toEqual({ queued: true });
    await drain();
    expect(await call("status")).toMatchObject({ kind: "alert", dryRun: false, sent: 2 });
    // The send is done: another needs a new count.
    await expect(call("send", {})).rejects.toThrow(ValidationError);
  });

  test("attachments cannot go in a mass message", async () => {
    const { call } = setup();
    await expect(
      call("count", { content: { ...message, body: "see [ATTACH]1[/ATTACH]" }, rule: everyone }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("alerts to members", () => {
  test("an alert is written to each reachable member, honouring their preference", async () => {
    const { ctx, adminUser, call, sql, drain, go } = setup();
    const a = insertUser(ctx);
    const off = insertUser(ctx);
    const banned = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO notification_preferences (user_id, type, in_app) VALUES (?1, 'admin.alert', 0)",
      )
      .run(off.id);

    await go({ content: alert, rule: everyone });
    await drain();

    const rows = sql(
      "SELECT user_id, type, content_type, actor_id, data FROM notifications ORDER BY user_id",
    ) as {
      user_id: number;
      type: string;
      content_type: string;
      actor_id: number | null;
      data: string;
    }[];
    expect(rows.map((row) => row.user_id)).toEqual([adminUser.id, a.id]);
    expect(rows[1]).toMatchObject({
      type: "admin.alert",
      content_type: "admin_alert",
      actor_id: null,
    });
    expect(JSON.parse(rows[1]!.data)).toEqual({
      message: "The forum moves tonight",
      url: "/pages/moving",
    });
    expect(sql("SELECT unread_notification_count AS n FROM users WHERE id = ?1", a.id)).toEqual([
      { n: 1 },
    ]);
    expect(await call("status")).toMatchObject({
      state: "done",
      kind: "alert",
      matched: 3,
      sent: 2,
      skipped: 1,
    });
  });

  test("an alert reaches every member over several chunks, in a handful of statements each", async () => {
    const { ctx, sql, drain, go } = setup();
    for (let i = 0; i < ALERT_CHUNK + 5; i++) insertUser(ctx);
    await go({ content: alert, rule: everyone });
    await drain();
    expect(sql("SELECT count(*) AS n FROM notifications WHERE type = 'admin.alert'")).toEqual([
      { n: ALERT_CHUNK + 6 },
    ]);
    // One event per chunk, not one per member.
    expect(
      sql("SELECT count(*) AS n FROM domain_events WHERE type = 'notification.created'"),
    ).toEqual([{ n: 2 }]);
  });

  test("the alert reaches the notification list with its text and address", async () => {
    const { ctx, drain, go } = setup();
    const member = insertUser(ctx);
    await go({ content: alert, rule: everyone });
    await drain();
    const list = await execute(ctx, getOperation("notifications.list"), userActor(member), {});
    expect(list.items[0]).toMatchObject({
      type: "admin.alert",
      url: "/pages/moving",
      data: { message: "The forum moves tonight" },
    });
  });
});

describe("test sends", () => {
  test("a test goes to the administrator or the chosen member, at once", async () => {
    const { ctx, adminUser, call, sql } = setup();
    const member = insertUser(ctx);
    const own = await call("test", { content: message });
    expect(own).toMatchObject({ delivered: true, recipient: { id: adminUser.id } });
    // Alone in the conversation, so it is not hidden by "remove from the sender's list".
    const mine = await call("test", { content: { ...message, removeFromSender: true } });
    expect(mine.delivered).toBe(true);
    expect(
      sql(
        "SELECT user_id, state FROM conversation_participants WHERE conversation_id = ?1",
        mine.conversationId,
      ),
    ).toEqual([{ user_id: adminUser.id, state: "active" }]);
    const other = await call("test", { content: message, recipientId: member.id });
    expect(other.conversationId).not.toBeNull();
    expect(
      sql(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1 ORDER BY user_id",
        other.conversationId,
      ),
    ).toEqual([{ user_id: adminUser.id }, { user_id: member.id }]);
    const flash = await call("test", { content: alert });
    expect(flash).toMatchObject({ delivered: true, conversationId: null });
    expect(sql("SELECT user_id FROM notifications WHERE type = 'admin.alert'")).toEqual([
      { user_id: adminUser.id },
    ]);
    expect(sql("SELECT action FROM moderator_log WHERE action LIKE 'broadcast.%'").length).toBe(4);
    // A test is not a run.
    expect(await call("status")).toMatchObject({ state: "idle" });
  });

  test("a member who cannot receive conversations is told so", async () => {
    const { ctx, call, sql } = setup();
    const unconfirmed = insertUser(ctx, { groupId: 5 });
    const result = await call("test", { content: message, recipientId: unconfirmed.id });
    expect(result).toMatchObject({ delivered: false, conversationId: null });
    expect(result.reason).not.toBeNull();
    expect(sql("SELECT id FROM conversations")).toEqual([]);
  });
});

describe("who may send", () => {
  test("guests, members and moderators are refused before the input is read; a key cannot start a send", async () => {
    const { ctx, call, sql, adminUser, drain } = setup();
    const member = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const bad = { content: 12 };
    for (const actor of [member, moderator])
      for (const name of ["count", "send", "resume", "discard", "test", "status", "stop"])
        await expect(call(name, bad, actor)).rejects.toThrow(ForbiddenError);
    for (const name of ["count", "send", "resume", "discard", "test", "status", "stop"])
      await expect(call(name, bad, GUEST)).rejects.toThrow(UnauthenticatedError);
    // A browser session confirms a send with its password; a key cannot send at all; a count needs none.
    const input = { content: message, rule: everyone };
    const session = { ...userActor(adminUser), interactive: true } as never;
    expect(await call("count", input, session)).toEqual({ queued: true });
    await drain();
    await expect(call("send", {}, session)).rejects.toThrow(ValidationError);
    await expect(call("send", {}, tokenActor(adminUser))).rejects.toThrow(ForbiddenError);
    expect(sql("SELECT id FROM conversations")).toEqual([]);
    expect(BROADCAST_JOB).toBe("broadcasts.run");
  });

  test("sending as another member needs authority over that member", async () => {
    const { ctx, call } = setup();
    const peer = insertUser(ctx, { groupId: 4 });
    await expect(call("test", { content: { ...message, senderId: peer.id } })).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("a run ends as failed when the administrator who started it can no longer send", async () => {
    const { ctx, adminUser, sql, drain, go } = setup();
    for (let i = 0; i < MESSAGE_CHUNK * 2; i++) insertUser(ctx);
    await go({ content: message, rule: everyone });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(adminUser.id);
    await drain();
    expect(
      JSON.parse(
        (
          sql("SELECT value FROM site_settings WHERE key = 'broadcasts.run'")[0] as {
            value: string;
          }
        ).value,
      ),
    ).toMatchObject({
      state: "failed",
      sent: MESSAGE_CHUNK,
    });
  });

  test("the moderator log keeps the start and the end of a run", async () => {
    const { ctx, sql, drain, go } = setup();
    insertUser(ctx);
    await go({ content: alert, rule: everyone });
    await drain();
    expect(
      sql("SELECT action FROM moderator_log WHERE action LIKE 'broadcast.%' ORDER BY id"),
    ).toEqual([
      { action: "broadcast.count.start" },
      { action: "broadcast.count.done" },
      { action: "broadcast.start" },
      { action: "broadcast.done" },
    ]);
  });
});
