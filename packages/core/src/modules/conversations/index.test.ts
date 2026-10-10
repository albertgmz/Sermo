import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { encodeCursor } from "../../pagination";
import {
  activeSql,
  conversationsCreateOp,
  conversationsGetOp,
  conversationsLeaveOp,
  conversationsListMessagesOp,
  conversationsListOp,
  conversationsMarkReadOp,
  conversationsReplyOp,
  inboxSql,
  messagesSql,
  participantsSql,
  reactableConversationMessage,
  reactableSql,
} from "./index";

function fixture() {
  const ctx = createTestContext();
  const a = insertUser(ctx);
  const b = insertUser(ctx);
  const c = insertUser(ctx);
  const moderator = insertUser(ctx, { groupId: 3 });
  const admin = insertUser(ctx, { groupId: 4 });
  return {
    ctx,
    a: userActor(a),
    b: userActor(b),
    c: userActor(c),
    moderator: userActor(moderator),
    admin: userActor(admin),
  };
}
const start = (recipientIds: number[]) => ({
  title: "Private thread",
  recipientIds,
  body: "**hello**",
});

function setGroupPermission(
  ctx: ReturnType<typeof createTestContext>,
  groupId: number,
  key: string,
  value: number,
) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = ?1), 0, ?2, 0, ?3)",
    )
    .run(key, groupId, value);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

describe("conversations", () => {
  test("recipient limit applies to a custom group", async () => {
    const { ctx, b, c } = fixture();
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Two recipients', 10) RETURNING id",
      )
      .get()!.id;
    const a = insertUser(ctx, { groupId });
    const d = insertUser(ctx);
    setGroupPermission(ctx, groupId, "conversation.start", 1);
    setGroupPermission(ctx, groupId, "conversation.maxRecipients", 2);
    const recipients = [b.kind === "guest" ? 0 : b.userId, c.kind === "guest" ? 0 : c.userId, d.id];
    const error = await execute(ctx, conversationsCreateOp, userActor(a), start(recipients)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("You can add at most 2 recipients.");
    expect((error as ValidationError).issues?.[0]?.path).toEqual(["recipientIds"]);
    expect(
      (await execute(ctx, conversationsCreateOp, b, start([a.id, recipients[1]!, d.id])))
        .conversation.participantCount,
    ).toBe(4);
    expect(
      (
        await execute(
          ctx,
          conversationsCreateOp,
          userActor(a),
          start([recipients[0]!, recipients[0]!, recipients[1]!, a.id]),
        )
      ).conversation.participantCount,
    ).toBe(3);
  });

  test("an unset recipient limit of zero reports its limit", async () => {
    const { ctx, b } = fixture();
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('No recipients', 10) RETURNING id",
      )
      .get()!.id;
    const starter = insertUser(ctx, { groupId });
    setGroupPermission(ctx, groupId, "conversation.start", 1);
    const bId = b.kind === "guest" ? 0 : b.userId;
    const error = await execute(ctx, conversationsCreateOp, userActor(starter), start([bId])).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("You can add at most 0 recipients.");
    expect((error as ValidationError).issues?.[0]?.path).toEqual(["recipientIds"]);
  });

  test("custom group grants hidden message visibility only to participants", async () => {
    const { ctx, a, b, c } = fixture();
    const idOf = (actor: typeof a) => (actor.kind === "guest" ? 0 : actor.userId);
    const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    const reply = await execute(ctx, conversationsReplyOp, b, {
      conversationId: made.conversation.id,
      body: "hidden",
    });
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(reply.id);
    expect(reactableConversationMessage(ctx, a, reply.id)).toEqual({
      authorId: idOf(b),
      isVisible: false,
    });
    expect(reactableConversationMessage(ctx, b, reply.id)).toEqual({
      authorId: idOf(b),
      isVisible: false,
    });
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'deleted' WHERE id = ?1")
      .run(reply.id);
    const input = { conversationId: made.conversation.id, limit: 10 };
    expect(
      (await execute(ctx, conversationsListMessagesOp, a, input)).items.map((r) => r.id),
    ).toEqual([made.message.id]);
    expect(() => reactableConversationMessage(ctx, a, reply.id)).toThrow(NotFoundError);
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Hidden messages', 10) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(idOf(a), groupId);
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(idOf(c), groupId);
    setGroupPermission(ctx, groupId, "conversation.viewHidden", 1);
    expect(
      (await execute(ctx, conversationsListMessagesOp, a, input)).items.map((r) => r.id),
    ).toEqual([made.message.id, reply.id]);
    expect(reactableConversationMessage(ctx, a, reply.id)).toEqual({
      authorId: idOf(b),
      isVisible: false,
    });
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(reply.id);
    expect(
      (await execute(ctx, conversationsListMessagesOp, a, input)).items.map((r) => r.id),
    ).toEqual([made.message.id, reply.id]);
    await expect(execute(ctx, conversationsListMessagesOp, c, input)).rejects.toThrow(
      NotFoundError,
    );
    expect(() => reactableConversationMessage(ctx, c, reply.id)).toThrow(NotFoundError);
  });

  test("reply permission can deny an active participant", async () => {
    const { ctx, a, b, c } = fixture();
    const bId = b.kind === "guest" ? 0 : b.userId;
    const cId = c.kind === "guest" ? 0 : c.userId;
    const made = await execute(ctx, conversationsCreateOp, a, start([bId]));
    const input = { conversationId: made.conversation.id, body: "reply" };
    expect((await execute(ctx, conversationsReplyOp, b, input)).state).toBe("visible");
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('No replies', 10) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(bId, groupId);
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(cId, groupId);
    setGroupPermission(ctx, groupId, "conversation.reply", -1);
    expect(
      (await execute(ctx, conversationsGetOp, b, { conversationId: made.conversation.id }))
        .canReply,
    ).toBe(false);
    expect(
      (await execute(ctx, conversationsGetOp, a, { conversationId: made.conversation.id }))
        .canReply,
    ).toBe(true);
    await expect(execute(ctx, conversationsReplyOp, b, input)).rejects.toThrow(ForbiddenError);
    await expect(execute(ctx, conversationsReplyOp, c, input)).rejects.toThrow(NotFoundError);
    const created = await execute(
      ctx,
      conversationsCreateOp,
      b,
      start([a.kind === "guest" ? 0 : a.userId]),
    );
    expect(created.conversation.canReply).toBe(false);
  });
  test("create validates recipients, permissions, rendering and initial read state", async () => {
    const { ctx, a, b, c } = fixture();
    const bId = b.kind === "guest" ? 0 : b.userId;
    const aId = a.kind === "guest" ? 0 : a.userId;
    await expect(execute(ctx, conversationsCreateOp, GUEST, start([bId]))).rejects.toThrow(
      UnauthenticatedError,
    );
    ctx.sqlite.prepare("UPDATE groups SET can_start_conversations = 0 WHERE id = 2").run();
    ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    await expect(execute(ctx, conversationsCreateOp, a, start([bId]))).rejects.toThrow(
      ForbiddenError,
    );
    ctx.sqlite.prepare("UPDATE groups SET can_start_conversations = 1 WHERE id = 2").run();
    ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    for (const recipients of [[aId], [aId, aId]]) {
      const error = await execute(ctx, conversationsCreateOp, a, start(recipients)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toBe("At least one other recipient is required.");
    }
    await expect(execute(ctx, conversationsCreateOp, a, start([]))).rejects.toThrow(
      ValidationError,
    );
    for (const recipientIds of [[999999], [bId, 999999]]) {
      try {
        await execute(ctx, conversationsCreateOp, a, start(recipientIds));
        throw new Error("Expected recipient validation.");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validation = error as ValidationError;
        expect(validation.message).toContain("999999");
        expect(validation.issues?.[0]?.path).toEqual(["recipientIds"]);
      }
    }
    const made = await execute(
      ctx,
      conversationsCreateOp,
      a,
      start([aId, bId, bId, c.kind === "guest" ? 0 : c.userId]),
    );
    expect(made.conversation.participantCount).toBe(3);
    expect(made.conversation.participants).toHaveLength(3);
    expect(made.conversation.isUnread).toBe(false);
    expect(made.message.bodyHtml).toContain("<strong>hello</strong>");
    expect(
      (await execute(ctx, conversationsGetOp, b, { conversationId: made.conversation.id }))
        .isUnread,
    ).toBe(true);
  });

  test("reply, unread, mark read and leave update every participant", async () => {
    const { ctx, a, b, c, moderator, admin } = fixture();
    const idOf = (actor: typeof a) => (actor.kind === "guest" ? 0 : actor.userId);
    const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    const id = made.conversation.id;
    const outsider = [c, moderator, admin];
    for (const who of outsider) {
      expect((await execute(ctx, conversationsListOp, who, { limit: 2 })).items).toHaveLength(0);
      await expect(execute(ctx, conversationsGetOp, who, { conversationId: id })).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        execute(ctx, conversationsReplyOp, who, { conversationId: id, body: "x" }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(ctx, conversationsListMessagesOp, who, { conversationId: id, limit: 2 }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(ctx, conversationsMarkReadOp, who, { conversationId: id }),
      ).rejects.toThrow(NotFoundError);
      await expect(execute(ctx, conversationsLeaveOp, who, { conversationId: id })).rejects.toThrow(
        NotFoundError,
      );
    }
    for (const op of [
      conversationsGetOp,
      conversationsListMessagesOp,
      conversationsMarkReadOp,
      conversationsLeaveOp,
    ]) {
      await expect(
        execute(ctx, op as typeof conversationsGetOp, GUEST, { conversationId: id, limit: 2 }),
      ).rejects.toThrow(UnauthenticatedError);
    }
    await expect(
      execute(ctx, conversationsReplyOp, GUEST, { conversationId: id, body: "x" }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(execute(ctx, conversationsListOp, GUEST, { limit: 2 })).rejects.toThrow(
      UnauthenticatedError,
    );
    ctx.clock.advance(500);
    const reply = await execute(
      ctx,
      conversationsReplyOp,
      tokenActor({ id: idOf(b), groupId: 2 }),
      { conversationId: id, body: "reply" },
    );
    expect(reply.state).toBe("visible");
    const rows = ctx.sqlite
      .prepare<{ last_message_at: number; last_read_message_id: number }, [number]>(
        "SELECT last_message_at, last_read_message_id FROM conversation_participants WHERE conversation_id = ?1 ORDER BY id",
      )
      .all(id);
    expect(rows.map((r) => r.last_message_at)).toEqual([ctx.now(), ctx.now()]);
    expect(rows.map((r) => r.last_read_message_id)).toEqual([made.message.id, reply.id]);
    expect((await execute(ctx, conversationsGetOp, a, { conversationId: id })).isUnread).toBe(true);
    expect((await execute(ctx, conversationsGetOp, b, { conversationId: id })).isUnread).toBe(
      false,
    );
    await execute(ctx, conversationsMarkReadOp, a, { conversationId: id });
    expect((await execute(ctx, conversationsGetOp, a, { conversationId: id })).isUnread).toBe(
      false,
    );
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id });
    expect((await execute(ctx, conversationsListOp, b, { limit: 20 })).items).toHaveLength(0);
    expect(
      (await execute(ctx, conversationsGetOp, a, { conversationId: id })).participantCount,
    ).toBe(1);
    await expect(execute(ctx, conversationsGetOp, b, { conversationId: id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, conversationsReplyOp, b, { conversationId: id, body: "again" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, conversationsListMessagesOp, b, { conversationId: id, limit: 2 }),
    ).rejects.toThrow(NotFoundError);
    await expect(execute(ctx, conversationsMarkReadOp, b, { conversationId: id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(execute(ctx, conversationsLeaveOp, b, { conversationId: id })).rejects.toThrow(
      NotFoundError,
    );
    expect(() => reactableConversationMessage(ctx, b, reply.id)).toThrow(NotFoundError);
    expect(() => reactableConversationMessage(ctx, GUEST, reply.id)).toThrow(NotFoundError);
    expect(reactableConversationMessage(ctx, a, reply.id)).toEqual({
      authorId: idOf(b),
      isVisible: true,
    });
    await execute(ctx, conversationsLeaveOp, a, { conversationId: id });
    expect(
      ctx.sqlite
        .prepare<{ participant_count: number }, [number]>(
          "SELECT participant_count FROM conversations WHERE id = ?1",
        )
        .get(id)?.participant_count,
    ).toBe(0);
  });

  test("inbox and message keysets have no gaps or duplicates across ties", async () => {
    const { ctx, a, b } = fixture();
    const bId = b.kind === "guest" ? 0 : b.userId;
    const ids: number[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await execute(ctx, conversationsCreateOp, a, start([bId]))).conversation.id);
    const listed: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await execute(ctx, conversationsListOp, a, { limit: 2, cursor });
      listed.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(listed).toEqual(ids.reverse());
    const id = listed[0]!;
    for (let i = 0; i < 5; i++)
      await execute(ctx, conversationsReplyOp, a, { conversationId: id, body: `message ${i}` });
    const messageIds: number[] = [];
    cursor = undefined;
    do {
      const page: { items: { id: number }[]; nextCursor: string | null } = await execute(
        ctx,
        conversationsListMessagesOp,
        a,
        {
          conversationId: id,
          limit: 2,
          cursor,
        },
      );
      messageIds.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(messageIds).toHaveLength(6);
    expect(messageIds).toEqual([...new Set(messageIds)].sort((x, y) => x - y));
    expectNoTableScan(ctx, inboxSql, [1, 9999999999999, 999999, 21]);
    expectNoTableScan(ctx, participantsSql, [id]);
    expectNoTableScan(ctx, messagesSql, [id, 0, 21]);
  });

  test("three readers retain independent unread state and left rows keep their activity time", async () => {
    const { ctx, a, b, c } = fixture();
    const idOf = (actor: typeof a) => (actor.kind === "guest" ? 0 : actor.userId);
    const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b), idOf(c)]));
    const id = made.conversation.id;
    const unread = async () =>
      Promise.all(
        [a, b, c].map(
          async (actor) =>
            (await execute(ctx, conversationsGetOp, actor, { conversationId: id })).isUnread,
        ),
      );
    expect(await unread()).toEqual([false, true, true]);
    ctx.clock.advance(1000);
    const bReply = await execute(ctx, conversationsReplyOp, b, {
      conversationId: id,
      body: "from b",
    });
    expect(await unread()).toEqual([true, false, true]);
    const activity = () =>
      ctx.sqlite
        .prepare<{ user_id: number; last_message_at: number }, [number]>(
          "SELECT user_id, last_message_at FROM conversation_participants WHERE conversation_id = ?1 ORDER BY user_id",
        )
        .all(id);
    expect(activity().map((row) => row.last_message_at)).toEqual([ctx.now(), ctx.now(), ctx.now()]);
    const afterReply = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    expect(afterReply.messageCount).toBe(2);
    expect(afterReply.lastMessage.messageId).toBe(bReply.id);
    expect(afterReply.lastMessage.user.id).toBe(idOf(b));
    expect(afterReply.lastMessage.sentAt).toBe(new Date(ctx.now()).toISOString());
    await execute(ctx, conversationsMarkReadOp, a, { conversationId: id });
    expect(await unread()).toEqual([false, false, true]);
    ctx.clock.advance(1000);
    await execute(ctx, conversationsReplyOp, c, { conversationId: id, body: "from c" });
    expect(await unread()).toEqual([true, true, false]);
    const bActivity = activity().find((row) => row.user_id === idOf(b))!.last_message_at;
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id });
    const aBefore = (await execute(ctx, conversationsListOp, a, { limit: 10 })).items[0]!;
    const cBefore = (await execute(ctx, conversationsListOp, c, { limit: 10 })).items[0]!;
    expect(aBefore.isUnread).toBe(true);
    expect(cBefore.isUnread).toBe(false);
    expect((await execute(ctx, conversationsListOp, b, { limit: 10 })).items).toHaveLength(0);
    const remaining = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    expect(remaining.participants.find((p) => p.user.id === idOf(b))?.state).toBe("left");
    expect(remaining.participantCount).toBe(2);
    ctx.clock.advance(1000);
    const aReply = await execute(ctx, conversationsReplyOp, a, {
      conversationId: id,
      body: "from a",
    });
    expect(activity().map((row) => row.last_message_at)).toEqual([ctx.now(), bActivity, ctx.now()]);
    expect((await execute(ctx, conversationsGetOp, a, { conversationId: id })).isUnread).toBe(
      false,
    );
    expect((await execute(ctx, conversationsGetOp, c, { conversationId: id })).isUnread).toBe(true);
    const aAfter = (await execute(ctx, conversationsListOp, a, { limit: 10 })).items[0]!;
    const cAfter = (await execute(ctx, conversationsListOp, c, { limit: 10 })).items[0]!;
    expect(aAfter.lastMessage.messageId).toBe(aReply.id);
    expect(aAfter.isUnread).toBe(false);
    expect(cAfter.isUnread).toBe(true);
  });

  test("inbox pagination reflects a reply moving an older conversation to the top", async () => {
    const { ctx, a, b } = fixture();
    const bId = b.kind === "guest" ? 0 : b.userId;
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await execute(ctx, conversationsCreateOp, a, start([bId]))).conversation.id);
      ctx.clock.advance(1000);
    }
    await execute(ctx, conversationsReplyOp, b, { conversationId: ids[0]!, body: "bump" });
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await execute(ctx, conversationsListOp, a, { limit: 2, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([ids[0]!, ...ids.slice(1).reverse()]);
    expect(new Set(seen).size).toBe(ids.length);
  });

  test("invalid cursors and unauthorized access disclose no other reader state", async () => {
    const { ctx, a, b, c, moderator, admin } = fixture();
    const idOf = (actor: typeof a) => (actor.kind === "guest" ? 0 : actor.userId);
    const privateConversation = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    const id = privateConversation.conversation.id;
    await execute(ctx, conversationsCreateOp, a, start([idOf(moderator)]));
    await execute(ctx, conversationsCreateOp, a, start([idOf(admin)]));
    for (const actor of [moderator, admin]) {
      const inbox = (await execute(ctx, conversationsListOp, actor, { limit: 10 })).items;
      expect(inbox).toHaveLength(1);
      expect(inbox.map((item) => item.id)).not.toContain(id);
      await expect(execute(ctx, conversationsGetOp, actor, { conversationId: id })).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        execute(ctx, conversationsReplyOp, actor, { conversationId: id, body: "x" }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(ctx, conversationsListMessagesOp, actor, { conversationId: id, limit: 10 }),
      ).rejects.toThrow(NotFoundError);
    }
    for (const cursor of ["not-a-cursor", encodeCursor(["wrong"]), encodeCursor([1, 2, 3])]) {
      await expect(execute(ctx, conversationsListOp, a, { limit: 2, cursor })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        execute(ctx, conversationsListMessagesOp, a, { conversationId: id, limit: 2, cursor }),
      ).rejects.toThrow(ValidationError);
    }
    const detail = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    const list = await execute(ctx, conversationsListOp, a, { limit: 10 });
    for (const output of [detail, list]) {
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("lastReadMessageId");
      expect(serialized).not.toContain("last_read_message_id");
      expect(serialized).not.toContain("lastMessageAt");
    }
    expect((await execute(ctx, conversationsListOp, c, { limit: 10 })).items).toHaveLength(0);
    expectNoTableScan(ctx, activeSql, [id, idOf(a)]);
    expectNoTableScan(ctx, reactableSql, [privateConversation.message.id, idOf(a)]);
  });
});
