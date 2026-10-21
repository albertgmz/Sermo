import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { writeTx } from "../../db/tx";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsLeaveOp,
  conversationsMarkReadOp,
  conversationsReplyOp,
  conversationsUpdateMessageOp,
} from "../conversations";
import { registerEmailJobs } from "../email";
import { runDueJobs } from "../jobs";
import { configurePush, pushSubscribeOp, registerPushJobs } from "../push";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { usersIgnoreOp } from "../social";
import {
  notificationChannels,
  notificationPushPhrase,
  notificationsListOp,
  notificationsSetPreferencesOp,
  registerNotificationJobs,
} from "./index";

const cert = readFileSync(new URL("../push/fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("../push/fixtures/test-key.pem", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

type Member = ReturnType<typeof insertUser>;

/** A conversation of a sender and four other members, each with a registered device. */
async function fixture() {
  const received: string[] = [];
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    async fetch(request) {
      received.push(new URL(request.url).pathname);
      await request.arrayBuffer();
      return new Response(null, { status: 201 });
    },
  });
  const ctx = createTestContext();
  cleanup.push(() => {
    server.stop(true);
    ctx.sqlite.close(true);
  });
  const origin = `https://localhost:${server.port}`;
  registerNotificationJobs(ctx);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    notificationChannels,
  )!;
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
    testAllowedEndpointOrigin: origin,
    testCa: cert,
  });
  registerPushJobs(ctx, { renderPhrase: notificationPushPhrase(ctx) });
  const sender = insertUser(ctx);
  const members = [insertUser(ctx), insertUser(ctx), insertUser(ctx), insertUser(ctx)] as const;
  for (const member of [sender, ...members])
    await execute(ctx, pushSubscribeOp, userActor(member), {
      endpoint: `${origin}/push/${member.id}`,
      keys: {
        p256dh: webPush.generateVAPIDKeys().publicKey,
        auth: randomBytes(16).toString("base64url"),
      },
      userAgent: "Bun test",
    });
  const settle = async () => {
    await dispatchEvents(ctx);
    while (await runDueJobs(ctx)) await dispatchEvents(ctx);
  };
  const made = await execute(ctx, conversationsCreateOp, userActor(sender), {
    title: "Plans",
    recipientIds: members.map((member) => member.id),
    body: "First message",
  });
  await settle();
  // Only the messages that follow the first one are under test.
  ctx.sqlite.prepare("UPDATE notifications SET read_at = ?1").run(ctx.now());
  ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 0").run();
  ctx.sqlite.prepare("DELETE FROM jobs").run();
  received.length = 0;
  capture.messages.length = 0;
  const conversationId = made.conversation.id;
  const say = async (user: Member, body: string) => {
    const message = await execute(ctx, conversationsReplyOp, userActor(user), {
      conversationId,
      body,
    });
    await settle();
    return message.id;
  };
  const rows = (user: Member) =>
    ctx.sqlite
      .prepare<
        {
          id: number;
          type: string;
          content_id: number;
          actor_count: number;
          group_key: string | null;
          read_at: number | null;
        },
        [number]
      >(
        "SELECT id, type, content_id, actor_count, group_key, read_at FROM notifications WHERE user_id = ?1 AND type = 'conversation.message' ORDER BY id",
      )
      .all(user.id);
  const unread = async (user: Member) =>
    (await execute(ctx, notificationsListOp, userActor(user), { unreadOnly: true, limit: 50 }))
      .items;
  return { ctx, capture, received, sender, members, conversationId, settle, say, rows, unread };
}

describe("conversation message alerts and pushes", () => {
  test("every active participant except the sender gets one, with the message permalink", async () => {
    const f = await fixture();
    const id = await f.say(f.sender, "Anyone for Friday?");
    for (const member of f.members) {
      const [alert] = await f.unread(member);
      expect(alert).toMatchObject({
        type: "conversation.message",
        contentType: "conversation_message",
        contentId: id,
        contentTitle: "Plans",
        url: `/conversations/messages/${id}`,
      });
      expect(alert!.actors.map((actor) => actor.id)).toEqual([f.sender.id]);
    }
    expect(f.rows(f.sender)).toEqual([]);
    expect([...f.received].sort()).toEqual(f.members.map((member) => `/push/${member.id}`).sort());
  });

  test("the push opens the message in the app and replaces the conversation's earlier push", async () => {
    const f = await fixture();
    const payloads: Array<{ title: string; body: string; url: string; tag: string }> = [];
    const generate = webPush.generateRequestDetails;
    const spy = spyOn(webPush, "generateRequestDetails").mockImplementation(((
      subscription: Parameters<typeof generate>[0],
      payload: Parameters<typeof generate>[1],
      options: Parameters<typeof generate>[2],
    ) => {
      payloads.push(JSON.parse(String(payload)));
      return generate(subscription, payload, options);
    }) as typeof generate);
    cleanup.push(() => spy.mockRestore());
    const id = await f.say(f.sender, "Anyone for Friday?");
    expect(payloads).toHaveLength(f.members.length);
    for (const payload of payloads) {
      expect(new URL(payload.url).pathname).toBe(`/conversations/messages/${id}`);
      expect(payload.tag).toBe(`conversation:${f.conversationId}`);
      expect(payload.title).toBe("New direct message");
      // A private message's text never travels in a push.
      expect(payload.body).not.toContain("Friday");
    }
  });

  test("a burst is one unread alert and one push per member until it is read", async () => {
    const f = await fixture();
    const [first, second, third] = f.members;
    await f.say(f.sender, "One");
    await f.say(f.sender, "Two");
    const last = await f.say(f.members[1]!, "Three");
    const rows = f.rows(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      content_id: last,
      actor_count: 2,
      group_key: `conversation:${f.conversationId}`,
      read_at: null,
    });
    const [alert] = await f.unread(first);
    expect(alert!.url).toBe(`/conversations/messages/${last}`);
    expect(alert!.actors.map((actor) => actor.id)).toEqual([second.id, f.sender.id]);
    expect(
      (await execute(f.ctx, notificationsListOp, userActor(first), { limit: 1 })).unreadCount,
    ).toBe(1);
    // The author of the third message keeps the alert for the first two; the sender is told of it.
    expect(f.rows(second)).toHaveLength(1);
    expect(f.rows(third)).toHaveLength(1);
    expect(f.received.filter((path) => path === `/push/${first.id}`)).toHaveLength(1);
    expect(f.received.filter((path) => path === `/push/${second.id}`)).toHaveLength(1);
    expect(f.received.filter((path) => path === `/push/${f.sender.id}`)).toHaveLength(1);
    // Opening the conversation clears the alert; the next message starts a new one.
    await execute(f.ctx, conversationsMarkReadOp, userActor(first), {
      conversationId: f.conversationId,
    });
    expect(await f.unread(first)).toEqual([]);
    await f.say(f.sender, "Four");
    expect(f.rows(first)).toHaveLength(2);
    expect(f.received.filter((path) => path === `/push/${first.id}`)).toHaveLength(2);
  });

  test("members who left ignoring future messages and members who ignore the sender are skipped", async () => {
    const f = await fixture();
    const [stays, , leaves, ignores] = f.members;
    await execute(f.ctx, conversationsLeaveOp, userActor(leaves), {
      conversationId: f.conversationId,
      futureMessages: "ignore",
    });
    await execute(f.ctx, usersIgnoreOp, userActor(ignores), { userId: f.sender.id });
    await f.say(f.sender, "Anyone for Friday?");
    expect(f.rows(stays)).toHaveLength(1);
    expect(f.rows(leaves)).toEqual([]);
    expect(f.rows(ignores)).toEqual([]);
    expect(f.received).not.toContain(`/push/${leaves.id}`);
    expect(f.received).not.toContain(`/push/${ignores.id}`);
    expect(f.received).toContain(`/push/${stays.id}`);
  });

  test("a member who left accepting future messages is alerted again by the next reply, and not before", async () => {
    const f = await fixture();
    const [stays, , leaves] = f.members;
    await execute(f.ctx, conversationsLeaveOp, userActor(leaves), {
      conversationId: f.conversationId,
      futureMessages: "accept",
    });
    expect(f.rows(leaves)).toEqual([]);
    await f.say(stays, "Anyone for Friday?");
    expect(f.rows(leaves)).toHaveLength(1);
    expect(f.rows(leaves)[0]!.read_at).toBeNull();
    expect(f.received).toContain(`/push/${leaves.id}`);
  });

  test("a participant who already read the message gets nothing", async () => {
    const f = await fixture();
    const [reader, other] = f.members;
    const message = await execute(f.ctx, conversationsReplyOp, userActor(f.sender), {
      conversationId: f.conversationId,
      body: "Read before the fan-out ran",
    });
    f.ctx.sqlite
      .prepare(
        "UPDATE conversation_participants SET last_read_message_id = ?1 WHERE conversation_id = ?2 AND user_id = ?3",
      )
      .run(message.id, f.conversationId, reader.id);
    await f.settle();
    expect(f.rows(reader)).toEqual([]);
    expect(f.rows(other)).toHaveLength(1);
  });

  test("the member's preferences decide: in-app off sends nothing, push off keeps the alert", async () => {
    const f = await fixture();
    const [alertOnly, silent, pushOnly] = f.members;
    await execute(f.ctx, notificationsSetPreferencesOp, userActor(alertOnly), {
      items: [{ type: "conversation.message", push: false }],
    });
    await execute(f.ctx, notificationsSetPreferencesOp, userActor(silent), {
      items: [{ type: "conversation.message", inApp: false }],
    });
    await f.say(f.sender, "Anyone for Friday?");
    expect(f.rows(alertOnly)).toHaveLength(1);
    expect(f.rows(silent)).toEqual([]);
    expect(f.rows(pushOnly)).toHaveLength(1);
    expect(f.received).not.toContain(`/push/${alertOnly.id}`);
    expect(f.received).not.toContain(`/push/${silent.id}`);
    expect(f.received).toContain(`/push/${pushOnly.id}`);
  });

  test("the site default decides when a member has chosen nothing", async () => {
    const f = await fixture();
    const [chosen] = f.members;
    storeSiteSettings(f.ctx, {
      ...readSiteSettings(f.ctx),
      notificationDefaults: { "conversation.message": { inApp: true, email: false, push: false } },
    });
    await execute(f.ctx, notificationsSetPreferencesOp, userActor(chosen), {
      items: [{ type: "conversation.message", push: true }],
    });
    await f.say(f.sender, "Anyone for Friday?");
    for (const member of f.members) expect(f.rows(member)).toHaveLength(1);
    expect(f.received).toEqual([`/push/${chosen.id}`]);
  });

  test("email, when a member asks for it, goes once per burst", async () => {
    const f = await fixture();
    const [member] = f.members;
    await execute(f.ctx, notificationsSetPreferencesOp, userActor(member), {
      items: [{ type: "conversation.message", email: true }],
    });
    await f.say(f.sender, "One");
    await f.say(f.sender, "Two");
    const mails = f.capture.messages.filter(
      (mail) => mail.to === `${member.username.toLowerCase()}@example.test`,
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("New direct message");
    expect(f.capture.messages).toHaveLength(1);
  });

  test("leaving clears the leaver's alert and lowers their counter, and nobody else's", async () => {
    const f = await fixture();
    const [leaves, stays] = f.members;
    await f.say(f.sender, "Anyone for Friday?");
    const counter = (user: Member) =>
      f.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT unread_notification_count AS n FROM users WHERE id = ?1",
        )
        .get(user.id)!.n;
    expect(counter(leaves)).toBe(1);
    await execute(f.ctx, conversationsLeaveOp, userActor(leaves), {
      conversationId: f.conversationId,
    });
    expect(await f.unread(leaves)).toEqual([]);
    expect(counter(leaves)).toBe(0);
    expect(await f.unread(stays)).toHaveLength(1);
    expect(counter(stays)).toBe(1);
  });

  test("deleting the newest message of a burst removes the alert, and the next message starts one", async () => {
    const f = await fixture();
    const [member] = f.members;
    await f.say(f.sender, "One");
    const second = await f.say(f.sender, "Two");
    expect(f.rows(member)).toHaveLength(1);
    await execute(f.ctx, conversationsDeleteMessageOp, userActor(f.sender), { messageId: second });
    await f.settle();
    expect(await f.unread(member)).toEqual([]);
    await f.say(f.sender, "Three");
    expect(await f.unread(member)).toHaveLength(1);
  });

  test("a banned member gets nothing", async () => {
    const f = await fixture();
    const [banned, other] = f.members;
    f.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned.id);
    await f.say(f.sender, "Anyone for Friday?");
    expect(f.rows(banned)).toEqual([]);
    expect(f.rows(other)).toHaveLength(1);
  });

  test("a message held for approval alerts once it is approved, not before", async () => {
    const f = await fixture();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO word_filters (term, action, is_active, created_at, updated_at) VALUES ('holdme', 'moderate', 1, ?1, ?1)",
      )
      .run(f.ctx.now());
    const id = await f.say(f.sender, "holdme please");
    expect(f.rows(f.members[0])).toEqual([]);
    expect(f.received).toEqual([]);
    f.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'visible' WHERE id = ?1")
      .run(id);
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, {
        type: "content.state_changed",
        targetType: "conversation_message",
        targetId: id,
        payload: { conversationId: f.conversationId, previousState: "moderated" },
      }),
    );
    await f.settle();
    for (const member of f.members) expect(f.rows(member)).toHaveLength(1);
    expect(f.received).toHaveLength(f.members.length);
  });

  test("editing a message does not alert again", async () => {
    const f = await fixture();
    const [member] = f.members;
    const id = await f.say(f.sender, "Anyone for Friday?");
    await execute(f.ctx, conversationsMarkReadOp, userActor(member), {
      conversationId: f.conversationId,
    });
    await execute(f.ctx, conversationsUpdateMessageOp, userActor(f.sender), {
      messageId: id,
      body: "Anyone for Saturday?",
    });
    await f.settle();
    expect(await f.unread(member)).toEqual([]);
    expect(f.rows(member)).toHaveLength(1);
    expect(f.received.filter((path) => path === `/push/${member.id}`)).toHaveLength(1);
  });

  test("a member mentioned in the message gets the mention only", async () => {
    const f = await fixture();
    const [mentioned, other] = f.members;
    await f.say(f.sender, `Anyone for Friday, @${mentioned.username}?`);
    expect((await f.unread(mentioned)).map((alert) => alert.type)).toEqual(["content.mentioned"]);
    expect((await f.unread(other)).map((alert) => alert.type)).toEqual(["conversation.message"]);
  });

  test("the lookups of a message's fan-out read indexes", async () => {
    const f = await fixture();
    expectNoTableScan(
      f.ctx,
      "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1 AND state = 'active' AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      [f.conversationId, 0, 40],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1 AND last_read_message_id >= ?2 AND user_id IN (SELECT value FROM json_each(?3))",
      [f.conversationId, 1, JSON.stringify([f.sender.id])],
    );
    expectNoTableScan(
      f.ctx,
      "SELECT id FROM conversation_messages WHERE conversation_id = ?1 ORDER BY id LIMIT 1",
      [f.conversationId],
    );
  });
});
