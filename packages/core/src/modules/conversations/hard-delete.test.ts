import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsHardDeleteMessageOp,
  conversationsListMessagesOp,
  conversationsReplyOp,
} from "./index";

/** a starts the conversation with b, c and an administrator, who all take part. */
async function setup() {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const cUser = insertUser(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const [a, b, c, admin] = [aUser, bUser, cUser, adminUser].map((user) => userActor(user));
  const made = await execute(ctx, conversationsCreateOp, a!, {
    title: "Private",
    recipientIds: [bUser.id, cUser.id, adminUser.id],
    body: "first",
  });
  const id = made.conversation.id;
  const reply = (actor: NonNullable<typeof a>, body: string) =>
    execute(ctx, conversationsReplyOp, actor, { conversationId: id, body });
  const hardDelete = (actor: NonNullable<typeof a>, messageId: number, reason = "") =>
    execute(ctx, conversationsHardDeleteMessageOp, actor, { messageId, reason });
  const count = (sql: string, ...params: number[]) =>
    ctx.sqlite.prepare<{ n: number }, number[]>(sql).get(...params)!.n;
  const conversation = () =>
    ctx.sqlite
      .prepare<
        { message_count: number; last_message_id: number; last_message_user_id: number },
        [number]
      >(
        "SELECT message_count, last_message_id, last_message_user_id FROM conversations WHERE id = ?1",
      )
      .get(id)!;
  const member = (userId: number) =>
    ctx.sqlite
      .prepare<{ reaction_score: number; unread_notification_count: number }, [number]>(
        "SELECT reaction_score, unread_notification_count FROM users WHERE id = ?1",
      )
      .get(userId)!;
  return {
    ctx,
    aUser,
    bUser,
    cUser,
    adminUser,
    a: a!,
    b: b!,
    c: c!,
    admin: admin!,
    id,
    first: made.message.id,
    reply,
    hardDelete,
    count,
    conversation,
    member,
  };
}

/** Everything that hangs off the message, in the tables the removal must reach. */
async function furnished(s: Awaited<ReturnType<typeof setup>>) {
  const message = await s.reply(s.b, "Deserves to go");
  await execute(s.ctx, getOperation("reactions.set"), s.c, {
    contentType: "conversation_message",
    contentId: message.id,
    reactionTypeId: 1,
  });
  await execute(s.ctx, getOperation("reports.create"), s.c, {
    target: { type: "conversation_message", id: message.id },
    reason: "rude",
  });
  const sql = s.ctx.sqlite;
  sql
    .prepare(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('local', 'k', 1, 'image/png', 'x', ?1, 'attachment', 'private', 1)",
    )
    .run(s.bUser.id);
  sql
    .prepare(
      "INSERT INTO attachments (file_id, content_type, content_id, created_at) VALUES (1, 'conversation_message', ?1, 1)",
    )
    .run(message.id);
  const alert = sql.prepare(
    "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at, read_at) VALUES (?1, 0, 'mention', 'conversation_message', ?2, 1, 1, ?3)",
  );
  alert.run(s.cUser.id, message.id, null);
  alert.run(s.aUser.id, message.id, 5);
  sql.prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1").run(s.cUser.id);
  return message.id;
}

const leftovers = (s: Awaited<ReturnType<typeof setup>>, messageId: number) => ({
  message: s.count("SELECT count(*) AS n FROM conversation_messages WHERE id = ?1", messageId),
  reactions: s.count(
    "SELECT count(*) AS n FROM reactions WHERE content_type = 'conversation_message' AND content_id = ?1",
    messageId,
  ),
  attachments: s.count(
    "SELECT count(*) AS n FROM attachments WHERE content_type = 'conversation_message' AND content_id = ?1",
    messageId,
  ),
  alerts: s.count(
    "SELECT count(*) AS n FROM notifications WHERE content_type = 'conversation_message' AND content_id = ?1",
    messageId,
  ),
  reports: s.count(
    "SELECT count(*) AS n FROM report_groups WHERE target_type = 'conversation_message' AND target_id = ?1",
    messageId,
  ),
});

describe("conversations.hardDeleteMessage", () => {
  test("removes a visible message with its reactions, attachments, alerts and reports, and keeps the counters right", async () => {
    const s = await setup();
    const earlier = await s.reply(s.c, "Earlier");
    const messageId = await furnished(s);
    expect(s.conversation().message_count).toBe(3);
    expect(s.member(s.bUser.id).reaction_score).toBe(1);
    expect(s.member(s.cUser.id).unread_notification_count).toBe(1);
    expect(leftovers(s, messageId)).toEqual({
      message: 1,
      reactions: 1,
      attachments: 1,
      alerts: 2,
      reports: 1,
    });

    await s.hardDelete(s.admin, messageId, "spam");

    expect(Object.values(leftovers(s, messageId))).toEqual([0, 0, 0, 0, 0]);
    expect(s.member(s.bUser.id).reaction_score).toBe(0);
    expect(s.member(s.cUser.id).unread_notification_count).toBe(0);
    expect(s.conversation()).toMatchObject({
      message_count: 2,
      last_message_id: earlier.id,
      last_message_user_id: s.cUser.id,
    });
    const logged = s.ctx.sqlite
      .prepare<{ reason: string; details: string }, []>(
        "SELECT reason, details FROM moderator_log WHERE action = 'conversation_message.hardDelete'",
      )
      .all();
    expect(logged).toHaveLength(1);
    expect(logged[0]!.reason).toBe("spam");
    expect(JSON.parse(logged[0]!.details)).toMatchObject({
      authorId: s.bUser.id,
      conversationId: s.id,
    });
  });

  test("a message that was soft-deleted first goes too, without counting it out twice", async () => {
    const s = await setup();
    const messageId = await furnished(s);
    await execute(s.ctx, conversationsDeleteMessageOp, s.admin, { messageId });
    expect(s.conversation().message_count).toBe(1);

    await s.hardDelete(s.admin, messageId);

    expect(Object.values(leftovers(s, messageId))).toEqual([0, 0, 0, 0, 0]);
    expect(s.conversation().message_count).toBe(1);
    expect(s.conversation().last_message_id).toBe(s.first);
  });

  test("a read marker never points past what is left, so the id given to the next message is unread", async () => {
    const s = await setup();
    const messageId = await s.reply(s.b, "Newest").then((m) => m.id);
    await execute(s.ctx, getOperation("conversations.markRead"), s.c, { conversationId: s.id });
    const marker = () =>
      s.ctx.sqlite
        .prepare<{ last_read_message_id: number }, [number, number]>(
          "SELECT last_read_message_id FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
        )
        .get(s.id, s.cUser.id)!.last_read_message_id;
    expect(marker()).toBe(messageId);

    await s.hardDelete(s.admin, messageId);

    expect(marker()).toBe(s.first);
    const next = await s.reply(s.a, "Next");
    const unread = (await execute(s.ctx, getOperation("conversations.list"), s.c, { limit: 10 }))
      .items[0]!;
    expect(next.id).toBe(messageId);
    expect(unread.isUnread).toBe(true);
  });

  test("is for holders of conversation.hardDelete who take part, and never for the first message", async () => {
    const s = await setup();
    const messageId = await furnished(s);
    // The message's own author, another participant, and a guest.
    await expect(s.hardDelete(s.b, messageId)).rejects.toThrow(ForbiddenError);
    await expect(s.hardDelete(s.c, messageId)).rejects.toThrow(ForbiddenError);
    await expect(s.hardDelete(GUEST, messageId)).rejects.toThrow(UnauthenticatedError);
    // An administrator with no seat in the conversation finds nothing.
    const stranger = userActor(insertUser(s.ctx, { groupId: 4 }));
    await expect(s.hardDelete(stranger, messageId)).rejects.toThrow(NotFoundError);
    await expect(s.hardDelete(s.admin, s.first)).rejects.toThrow(ValidationError);
    expect(leftovers(s, messageId).message).toBe(1);
  });

  test("the list tells who may: administrators on every message but the first", async () => {
    const s = await setup();
    const messageId = await s.reply(s.b, "Reply").then((m) => m.id);
    const flags = async (actor: typeof s.a) =>
      (
        await execute(s.ctx, conversationsListMessagesOp, actor, {
          conversationId: s.id,
          limit: 50,
        })
      ).items.map((m) => [m.id, m.canHardDelete]);
    expect(await flags(s.admin)).toEqual([
      [s.first, false],
      [messageId, true],
    ]);
    expect(await flags(s.b)).toEqual([
      [s.first, false],
      [messageId, false],
    ]);
    expect(actorUserId(s.admin)).toBe(s.adminUser.id);
  });
});

describe("conversations.deleteMessage with a reason", () => {
  test("the reason reaches the deletion event for the author", async () => {
    const s = await setup();
    const messageId = await s.reply(s.b, "Reply").then((m) => m.id);
    await execute(s.ctx, conversationsDeleteMessageOp, s.admin, { messageId, reason: "off topic" });
    const event = s.ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'content.deleted' AND target_type = 'conversation_message' AND target_id = ?1",
      )
      .get(messageId)!;
    expect(JSON.parse(event.payload)).toMatchObject({ reason: "off topic", notify: true });
  });
});
