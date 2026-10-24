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
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { encodeCursor } from "../../pagination";
import { authCountersOp } from "../auth";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "../notifications";
import {
  activeSql,
  addParticipantSql,
  clearConversationNoticesSql,
  clearMessageNoticesSql,
  conversationsAddParticipantsOp,
  conversationsCreateOp,
  conversationsGetOp,
  conversationsLeaveOp,
  conversationsListMessagesOp,
  conversationsListOp,
  conversationsLocateUnreadOp,
  conversationsMarkReadOp,
  conversationsMarkUnreadOp,
  conversationsRenameOp,
  conversationsReplyOp,
  inboxSql,
  incrementParticipantsSql,
  markUnreadSql,
  messagesSql,
  participantStatesSql,
  participantsSql,
  reactableConversationMessage,
  reactableSql,
  reactivateParticipantSql,
  restoreLeaversSql,
  visibleMessagesNewestSql,
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
  body: "[B]hello[/B]",
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
    setGroupPermission(ctx, groupId, "conversation.receive", 1);
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

  test("messages page from either end, and a non-participant finds neither", async () => {
    const { ctx, a, b, c } = fixture();
    const bId = b.kind === "guest" ? 0 : b.userId;
    const id = (await execute(ctx, conversationsCreateOp, a, start([bId]))).conversation.id;
    for (let i = 0; i < 5; i++)
      await execute(ctx, conversationsReplyOp, b, { conversationId: id, body: `message ${i}` });
    const pages = async (order: "oldest" | "newest", cursor?: string) => {
      const out: number[][] = [];
      let next = cursor;
      do {
        const page: { items: { id: number }[]; nextCursor: string | null } = await execute(
          ctx,
          conversationsListMessagesOp,
          a,
          { conversationId: id, order, limit: 2, cursor: next },
        );
        out.push(page.items.map((m) => m.id));
        next = page.nextCursor ?? undefined;
      } while (next);
      return out;
    };
    const oldest = await pages("oldest");
    const newest = await pages("newest");
    expect(oldest.map((page) => page.length)).toEqual([2, 2, 2]);
    expect(newest.map((page) => page.length)).toEqual([2, 2, 2]);
    const forwards = oldest.flat();
    expect(forwards).toEqual([...forwards].sort((x, y) => x - y));
    expect(newest.flat()).toEqual([...forwards].reverse());
    // The default is the oldest first.
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, a, { conversationId: id, limit: 2 })
      ).items.map((m) => m.id),
    ).toEqual(oldest[0]!);
    // A cursor from the other order continues from its message in this order's direction.
    const issued = encodeCursor([forwards[2]!]);
    expect((await pages("newest", issued)).flat()).toEqual([forwards[1]!, forwards[0]!]);
    expect((await pages("oldest", issued)).flat()).toEqual(forwards.slice(3));
    for (const order of ["oldest", "newest"] as const)
      await expect(
        execute(ctx, conversationsListMessagesOp, c, { conversationId: id, order, limit: 2 }),
      ).rejects.toThrow(NotFoundError);
    expectNoTableScan(ctx, visibleMessagesNewestSql, [id, Number.MAX_SAFE_INTEGER, 21, 0, 0]);
  });

  test("marking a conversation unread puts its newest message back as the first unread, for the caller only", async () => {
    const { ctx, a, b, c } = fixture();
    const idOf = (actor: typeof a) => (actor.kind === "guest" ? 0 : actor.userId);
    const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    const id = made.conversation.id;
    ctx.clock.advance(1000);
    await execute(ctx, conversationsReplyOp, b, { conversationId: id, body: "second" });
    ctx.clock.advance(1000);
    const third = await execute(ctx, conversationsReplyOp, b, {
      conversationId: id,
      body: "third",
    });
    await execute(ctx, conversationsMarkReadOp, a, { conversationId: id });
    const isUnread = async (actor: typeof a) =>
      (await execute(ctx, conversationsGetOp, actor, { conversationId: id })).isUnread;
    const counter = async (actor: typeof a) =>
      (await execute(ctx, authCountersOp, actor, {})).conversations;
    expect([await isUnread(a), await counter(a)]).toEqual([false, 0]);
    await execute(ctx, conversationsMarkUnreadOp, a, { conversationId: id });
    expect([await isUnread(a), await counter(a)]).toEqual([true, 1]);
    // It opens at the newest message, the only unread one, and the other reader's mark is theirs.
    const place = await execute(ctx, conversationsLocateUnreadOp, a, {
      conversationId: id,
      limit: 20,
    });
    expect(place.messageId).toBe(third.id);
    expect(await isUnread(b)).toBe(false);
    // Reading it again clears the mark.
    await execute(ctx, conversationsMarkReadOp, a, { conversationId: id });
    expect([await isUnread(a), await counter(a)]).toEqual([false, 0]);
    // A mark already behind the target stays where it is: nothing unread becomes read.
    const markOf = (userId: number) =>
      ctx.sqlite
        .prepare<{ m: number }, [number, number]>(
          "SELECT last_read_message_id AS m FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
        )
        .get(id, userId)!.m;
    expect(markOf(idOf(a))).toBe(third.id);
    ctx.sqlite
      .prepare(
        "UPDATE conversation_participants SET last_read_message_id = ?1 WHERE conversation_id = ?2 AND user_id = ?3",
      )
      .run(made.message.id, id, idOf(a));
    await execute(ctx, conversationsMarkUnreadOp, a, { conversationId: id });
    expect(markOf(idOf(a))).toBe(made.message.id);
    ctx.sqlite
      .prepare(
        "UPDATE conversation_participants SET last_read_message_id = 0 WHERE conversation_id = ?1 AND user_id = ?2",
      )
      .run(id, idOf(a));
    await execute(ctx, conversationsMarkUnreadOp, a, { conversationId: id });
    expect(markOf(idOf(a))).toBe(0);
    // A conversation of one message goes back to nothing read.
    const alone = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    await execute(ctx, conversationsMarkUnreadOp, a, { conversationId: alone.conversation.id });
    expect(
      (await execute(ctx, conversationsGetOp, a, { conversationId: alone.conversation.id }))
        .isUnread,
    ).toBe(true);
    // Only a participant: an outsider and a guest are refused before anything is read.
    await expect(
      execute(ctx, conversationsMarkUnreadOp, c, { conversationId: id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, conversationsMarkUnreadOp, GUEST, { conversationId: id }),
    ).rejects.toThrow(UnauthenticatedError);
    expectNoTableScan(ctx, markUnreadSql, [id, third.id]);
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
    expect(afterReply.lastMessage.user).toMatchObject({ kind: "member", id: idOf(b) });
    expect(afterReply.lastMessage.sentAt).toBe(new Date(ctx.now()).toISOString());
    await execute(ctx, conversationsMarkReadOp, a, { conversationId: id });
    expect(await unread()).toEqual([false, false, true]);
    ctx.clock.advance(1000);
    await execute(ctx, conversationsReplyOp, c, { conversationId: id, body: "from c" });
    expect(await unread()).toEqual([true, true, false]);
    const bActivity = activity().find((row) => row.user_id === idOf(b))!.last_message_at;
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id, futureMessages: "ignore" });
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
    expectNoTableScan(ctx, restoreLeaversSql, [0, id]);
    expectNoTableScan(ctx, reactableSql, [privateConversation.message.id, idOf(a)]);
  });

  describe("alerts", () => {
    const idOf = (actor: { kind: string; userId?: number }) => actor.userId ?? 0;
    const unreadCount = (
      ctx: ReturnType<typeof createTestContext>,
      actor: ReturnType<typeof userActor>,
    ) =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT unread_notification_count AS n FROM users WHERE id = ?1",
        )
        .get(idOf(actor))!.n;
    const unreadRows = (
      ctx: ReturnType<typeof createTestContext>,
      actor: ReturnType<typeof userActor>,
    ) =>
      ctx.sqlite
        .prepare<{ content_type: string; content_id: number }, [number]>(
          "SELECT content_type, content_id FROM notifications n WHERE user_id = ?1 AND read_at IS NULL AND epoch = (SELECT notification_epoch FROM users WHERE id = ?1) ORDER BY id",
        )
        .all(idOf(actor));
    function notice(
      ctx: ReturnType<typeof createTestContext>,
      actor: ReturnType<typeof userActor>,
      contentType: string,
      contentId: number,
      data: object = {},
      epoch?: number,
    ) {
      ctx.sqlite
        .prepare(
          "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, data, created_at, updated_at) VALUES (?1, coalesce(?5, (SELECT notification_epoch FROM users WHERE id = ?1)), 'conversation.added', ?2, ?3, ?4, 0, 0)",
        )
        .run(idOf(actor), contentType, contentId, JSON.stringify(data), epoch ?? null);
      ctx.sqlite
        .prepare(
          "UPDATE users SET unread_notification_count = unread_notification_count + 1 WHERE id = ?1",
        )
        .run(idOf(actor));
    }

    test("a reply raises one alert for the other participants, and a second reply joins it", async () => {
      const { ctx, a, b } = fixture();
      registerNotificationJobs(ctx);
      const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      await dispatchEvents(ctx);
      await runDueJobs(ctx);
      const before = unreadCount(ctx, b);
      const beforeSender = unreadCount(ctx, a);
      for (const body of ["again", "and again"]) {
        await execute(ctx, conversationsReplyOp, a, {
          conversationId: made.conversation.id,
          body,
        });
        await dispatchEvents(ctx);
        await runDueJobs(ctx);
      }
      expect(unreadCount(ctx, b)).toBe(before + 1);
      expect(unreadCount(ctx, a)).toBe(beforeSender);
      expect(
        ctx.sqlite
          .prepare<{ user_id: number }, []>(
            "SELECT user_id FROM notifications WHERE type = 'conversation.message'",
          )
          .all(),
      ).toEqual([{ user_id: idOf(b) }]);
      // The envelope counter is separate: the conversation is still unread.
      const detail = await execute(ctx, conversationsGetOp, b, {
        conversationId: made.conversation.id,
      });
      expect(detail.isUnread).toBe(true);
      // Opening the conversation clears its alerts, the addition's and the messages'.
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: made.conversation.id });
      expect(unreadCount(ctx, b)).toBe(0);
    });

    test("marking a conversation read clears its alerts and the counter, for the caller only", async () => {
      const { ctx, a, b, c } = fixture();
      const one = await execute(ctx, conversationsCreateOp, a, start([idOf(b), idOf(c)]));
      const two = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      const id = one.conversation.id;
      // b: added to both conversations (first under an old epoch), a mention inside a message of the first, an alert of
      // another kind, and one that belongs to an older epoch (already counted as read).
      notice(ctx, b, "conversation", id);
      notice(ctx, b, "conversation", two.conversation.id);
      notice(ctx, b, "conversation_message", one.message.id, { conversationId: id });
      notice(ctx, b, "thread", 99);
      ctx.sqlite.prepare("UPDATE users SET notification_epoch = 1 WHERE id = ?1").run(idOf(b));
      ctx.sqlite
        .prepare("UPDATE users SET unread_notification_count = 0 WHERE id = ?1")
        .run(idOf(b));
      notice(ctx, b, "conversation", two.conversation.id);
      notice(ctx, b, "conversation", id);
      notice(ctx, b, "conversation_message", one.message.id, { conversationId: id });
      notice(ctx, b, "thread", 98);
      notice(ctx, c, "conversation", id);
      expect(unreadCount(ctx, b)).toBe(4);

      await execute(ctx, conversationsMarkReadOp, b, { conversationId: id });

      expect(unreadRows(ctx, b).filter((row) => row.content_type !== "thread")).toEqual([
        { content_type: "conversation", content_id: two.conversation.id },
      ]);
      expect(unreadRows(ctx, b).filter((row) => row.content_type === "thread")).toHaveLength(1);
      expect(unreadCount(ctx, b)).toBe(2);
      // The older epoch's rows were not touched, and nobody else's counter moved.
      expect(
        ctx.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND epoch = 0 AND read_at IS NULL",
          )
          .get(idOf(b))!.n,
      ).toBe(4);
      expect(unreadCount(ctx, c)).toBe(1);
      expect(unreadRows(ctx, c)).toHaveLength(1);
      // Marking it again changes nothing.
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: id });
      expect(unreadCount(ctx, b)).toBe(2);
    });

    test("alerts are cleared even when the conversation itself is already read", async () => {
      const { ctx, a, b } = fixture();
      const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: made.conversation.id });
      notice(ctx, b, "conversation", made.conversation.id);
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: made.conversation.id });
      expect(unreadCount(ctx, b)).toBe(0);
      expect(unreadRows(ctx, b)).toEqual([]);
    });

    test("a counter that has drifted below the alerts cleared stops at zero", async () => {
      const { ctx, a, b } = fixture();
      const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      notice(ctx, b, "conversation", made.conversation.id);
      ctx.sqlite
        .prepare("UPDATE users SET unread_notification_count = 0 WHERE id = ?1")
        .run(idOf(b));
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: made.conversation.id });
      expect(unreadCount(ctx, b)).toBe(0);
      expect(unreadRows(ctx, b)).toEqual([]);
    });

    test("a non-participant, a guest and a left member clear nothing", async () => {
      const { ctx, a, b, c } = fixture();
      const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      const id = made.conversation.id;
      notice(ctx, c, "conversation", id);
      await expect(
        execute(ctx, conversationsMarkReadOp, c, { conversationId: id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(ctx, conversationsMarkReadOp, GUEST, { conversationId: id }),
      ).rejects.toThrow(UnauthenticatedError);
      await execute(ctx, conversationsLeaveOp, b, { conversationId: id });
      notice(ctx, b, "conversation", id);
      await expect(
        execute(ctx, conversationsMarkReadOp, b, { conversationId: id }),
      ).rejects.toThrow(NotFoundError);
      expect(unreadCount(ctx, c)).toBe(1);
      expect(unreadCount(ctx, b)).toBe(1);
      expect(unreadRows(ctx, b)).toHaveLength(1);
    });

    test("a conversation id stored as text still matches", async () => {
      const { ctx, a, b } = fixture();
      const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
      notice(ctx, b, "conversation_message", made.message.id, {
        conversationId: String(made.conversation.id),
      });
      await execute(ctx, conversationsMarkReadOp, b, { conversationId: made.conversation.id });
      expect(unreadRows(ctx, b)).toEqual([]);
    });

    test("the message statement skips the rows of older epochs through the index", () => {
      const { ctx } = fixture();
      const plan = ctx.sqlite
        .prepare<{ detail: string }, [number, number, number]>(
          `EXPLAIN QUERY PLAN ${clearMessageNoticesSql}`,
        )
        .all(0, 1, 1)
        .map((row) => row.detail)
        .join(" ");
      expect(plan).toContain("notifications_user_unread_recent (user_id=? AND epoch=?)");
    });

    test("the clearing statements use an index", () => {
      const { ctx } = fixture();
      expectNoTableScan(ctx, clearConversationNoticesSql, [0, 1, 1]);
      expectNoTableScan(ctx, clearMessageNoticesSql, [0, 1, 1]);
    });
  });
});

describe("adding people and renaming", () => {
  const idOf = (actor: { kind: string; userId?: number }) => actor.userId ?? 0;
  function setup() {
    const base = fixture();
    const d = insertUser(base.ctx);
    return { ...base, d, dActor: userActor(d) };
  }
  async function started() {
    const s = setup();
    const made = await execute(s.ctx, conversationsCreateOp, s.a, start([idOf(s.b)]));
    return { ...s, id: made.conversation.id };
  }
  const events = (ctx: ReturnType<typeof createTestContext>) =>
    ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'conversation.participants_added' ORDER BY id",
      )
      .all()
      .map((e) => JSON.parse(e.payload) as { userIds: number[]; actorId: number });
  const rowOf = (ctx: ReturnType<typeof createTestContext>, id: number, userId: number) =>
    ctx.sqlite
      .prepare<
        { state: string; last_read_message_id: number; last_message_at: number },
        [number, number]
      >(
        "SELECT state, last_read_message_id, last_message_at FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
      )
      .get(id, userId);
  const countOf = (ctx: ReturnType<typeof createTestContext>, id: number) =>
    ctx.sqlite
      .prepare<{ participant_count: number }, [number]>(
        "SELECT participant_count FROM conversations WHERE id = ?1",
      )
      .get(id)!.participant_count;

  test("the viewer's abilities tell the starter from another participant", async () => {
    const { ctx, a, b, id } = await started();
    const asStarter = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    expect([asStarter.canInvite, asStarter.canRename]).toEqual([true, true]);
    const asOther = await execute(ctx, conversationsGetOp, b, { conversationId: id });
    expect([asOther.canInvite, asOther.canRename]).toEqual([false, false]);
    const made = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    expect([made.conversation.canInvite, made.conversation.canRename]).toEqual([true, true]);
  });

  test("the starter adds people: counters, unread, event and a skipped repeat", async () => {
    const { ctx, a, b, c, id } = await started();
    const cId = idOf(c);
    const result = await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [cId, cId, idOf(a), idOf(b)],
    });
    expect(result.participantCount).toBe(3);
    expect(result.participants.map((p) => [p.user.id, p.state])).toEqual([
      [idOf(a), "active"],
      [idOf(b), "active"],
      [cId, "active"],
    ]);
    expect(countOf(ctx, id)).toBe(3);
    expect((await execute(ctx, conversationsGetOp, c, { conversationId: id })).isUnread).toBe(true);
    expect((await execute(ctx, conversationsListOp, c, { limit: 10 })).items).toHaveLength(1);
    expect(events(ctx)).toEqual([
      { userIds: [idOf(b)], actorId: idOf(a) },
      { userIds: [cId], actorId: idOf(a) },
    ]);
    // everyone is already active: nothing changes and no event is published
    await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [cId, idOf(b)],
    });
    expect(countOf(ctx, id)).toBe(3);
    expect(events(ctx)).toHaveLength(2);
    // the new participant can reply
    await execute(ctx, conversationsReplyOp, c, { conversationId: id, body: "hi" });
  });

  test("a new participant's inbox position follows the latest activity", async () => {
    const { ctx, a, b, c, id } = await started();
    ctx.clock.advance(5000);
    await execute(ctx, conversationsReplyOp, b, { conversationId: id, body: "later" });
    await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [idOf(c)],
    });
    expect(rowOf(ctx, id, idOf(c))).toMatchObject({ state: "active", last_read_message_id: 0 });
    expect(rowOf(ctx, id, idOf(c))!.last_message_at).toBe(ctx.now());
  });

  test("someone who left becomes active again in the same row", async () => {
    const { ctx, a, b, id } = await started();
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id });
    expect(countOf(ctx, id)).toBe(1);
    ctx.clock.advance(3000);
    await execute(ctx, conversationsReplyOp, a, { conversationId: id, body: "alone" });
    const result = await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [idOf(b)],
    });
    expect(result.participantCount).toBe(2);
    expect(result.participants.every((p) => p.state === "active")).toBe(true);
    expect(countOf(ctx, id)).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM conversation_participants WHERE conversation_id = ?1",
        )
        .get(id)!.n,
    ).toBe(2);
    expect(rowOf(ctx, id, idOf(b))!.last_message_at).toBe(ctx.now());
    expect((await execute(ctx, conversationsListOp, b, { limit: 10 })).items).toHaveLength(1);
    expect(events(ctx).at(-1)).toEqual({ userIds: [idOf(b)], actorId: idOf(a) });
  });

  test("leaving and accepting future messages: a new reply brings the conversation back unread", async () => {
    const { ctx, a, b, id } = await started();
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id });
    expect(rowOf(ctx, id, idOf(b))!.state).toBe("left");
    expect(countOf(ctx, id)).toBe(1);
    expect((await execute(ctx, conversationsListOp, b, { limit: 10 })).items).toHaveLength(0);
    ctx.clock.advance(1000);
    // A reply by someone else restores them; their own earlier read mark is kept, so what was sent meanwhile is unread.
    const reply = await execute(ctx, conversationsReplyOp, a, {
      conversationId: id,
      body: "still there?",
    });
    expect(rowOf(ctx, id, idOf(b))).toMatchObject({
      state: "active",
      last_message_at: ctx.now(),
    });
    expect(countOf(ctx, id)).toBe(2);
    const inbox = (await execute(ctx, conversationsListOp, b, { limit: 10 })).items;
    expect(inbox.map((item) => [item.id, item.isUnread, item.participantCount])).toEqual([
      [id, true, 2],
    ]);
    expect(inbox[0]!.lastMessage.messageId).toBe(reply.id);
    // Replying again changes nothing more.
    await execute(ctx, conversationsReplyOp, a, { conversationId: id, body: "again" });
    expect(countOf(ctx, id)).toBe(2);
  });

  test("leaving and ignoring future messages: replies do not bring it back, adding the member does", async () => {
    const { ctx, a, b, id } = await started();
    await execute(ctx, conversationsLeaveOp, b, { conversationId: id, futureMessages: "ignore" });
    expect(rowOf(ctx, id, idOf(b))!.state).toBe("left_ignored");
    expect(countOf(ctx, id)).toBe(1);
    ctx.clock.advance(1000);
    await execute(ctx, conversationsReplyOp, a, { conversationId: id, body: "gone" });
    expect(rowOf(ctx, id, idOf(b))!.state).toBe("left_ignored");
    expect(countOf(ctx, id)).toBe(1);
    expect((await execute(ctx, conversationsListOp, b, { limit: 10 })).items).toHaveLength(0);
    await expect(execute(ctx, conversationsGetOp, b, { conversationId: id })).rejects.toThrow(
      NotFoundError,
    );
    // Others see "left", not that the member ignores the conversation.
    const seen = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    expect(seen.participants.find((p) => p.user.id === idOf(b))?.state).toBe("left");
    const result = await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [idOf(b)],
    });
    expect(result.participantCount).toBe(2);
    expect(rowOf(ctx, id, idOf(b))!.state).toBe("active");
    expect((await execute(ctx, conversationsListOp, b, { limit: 10 })).items).toHaveLength(1);
  });

  test("a guest and an outsider cannot leave, and the choice is checked before it is used", async () => {
    const { ctx, c, id } = await started();
    await expect(
      execute(ctx, conversationsLeaveOp, GUEST, { conversationId: id, futureMessages: "ignore" }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(ctx, conversationsLeaveOp, c, { conversationId: id, futureMessages: "ignore" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, conversationsLeaveOp, c, {
        conversationId: id,
        futureMessages: "later" as "ignore",
      }),
    ).rejects.toThrow();
  });

  test("only the starter, while active, may add people", async () => {
    const { ctx, a, b, c, dActor, moderator, admin, id } = await started();
    const input = { conversationId: id, userIds: [idOf(c)] };
    await expect(execute(ctx, conversationsAddParticipantsOp, GUEST, input)).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(execute(ctx, conversationsAddParticipantsOp, b, input)).rejects.toThrow(
      ForbiddenError,
    );
    for (const outsider of [dActor, moderator, admin])
      await expect(execute(ctx, conversationsAddParticipantsOp, outsider, input)).rejects.toThrow(
        NotFoundError,
      );
    await expect(
      execute(ctx, conversationsAddParticipantsOp, a, { ...input, conversationId: 999999 }),
    ).rejects.toThrow(NotFoundError);
    expect(countOf(ctx, id)).toBe(2);
    await execute(ctx, conversationsLeaveOp, a, { conversationId: id });
    await expect(execute(ctx, conversationsAddParticipantsOp, a, input)).rejects.toThrow(
      NotFoundError,
    );
    expect(countOf(ctx, id)).toBe(1);
    expect(events(ctx)).toHaveLength(1);
  });

  test("a starter restricted from conversations cannot add people", async () => {
    const { ctx, a, c, id } = await started();
    ctx.sqlite
      .prepare("UPDATE users SET restricted_conversations_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 1e9, idOf(a));
    ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    await expect(
      execute(ctx, conversationsAddParticipantsOp, a, { conversationId: id, userIds: [idOf(c)] }),
    ).rejects.toThrow(ForbiddenError);
    const seen = await execute(ctx, conversationsGetOp, a, { conversationId: id });
    expect(seen.canInvite).toBe(false);
    expect(seen.canRename).toBe(true);
  });

  test("invalid people are refused", async () => {
    const { ctx, a, id } = await started();
    const add = (userIds: number[]) =>
      execute(ctx, conversationsAddParticipantsOp, a, { conversationId: id, userIds });
    const own = await add([idOf(a)]).catch((e: unknown) => e);
    expect(own).toBeInstanceOf(ValidationError);
    expect((own as Error).message).toBe("At least one other person is required.");
    const unknown = await add([999999]).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(ValidationError);
    expect((unknown as ValidationError).issues?.[0]?.path).toEqual(["userIds"]);
    await expect(add([])).rejects.toThrow();
    expect(countOf(ctx, id)).toBe(2);
  });

  test("the recipient limit counts the other active participants after the addition", async () => {
    const { ctx, b } = setup();
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Two recipients', 10) RETURNING id",
      )
      .get()!.id;
    const starter = insertUser(ctx, { groupId });
    const x = insertUser(ctx);
    const y = insertUser(ctx);
    setGroupPermission(ctx, groupId, "conversation.start", 1);
    setGroupPermission(ctx, groupId, "conversation.maxRecipients", 2);
    const s = userActor(starter);
    const made = await execute(ctx, conversationsCreateOp, s, start([idOf(b)]));
    const id = made.conversation.id;
    expect(made.conversation.canInvite).toBe(true);
    const tooMany = await execute(ctx, conversationsAddParticipantsOp, s, {
      conversationId: id,
      userIds: [x.id, y.id],
    }).catch((e: unknown) => e);
    expect(tooMany).toBeInstanceOf(ValidationError);
    expect((tooMany as Error).message).toBe("You can add at most 2 recipients.");
    expect(countOf(ctx, id)).toBe(2);
    await execute(ctx, conversationsAddParticipantsOp, s, { conversationId: id, userIds: [x.id] });
    expect(countOf(ctx, id)).toBe(3);
    // someone already active does not count against the limit
    await execute(ctx, conversationsAddParticipantsOp, s, {
      conversationId: id,
      userIds: [x.id, idOf(b)],
    });
    await expect(
      execute(ctx, conversationsAddParticipantsOp, s, { conversationId: id, userIds: [y.id] }),
    ).rejects.toThrow(ValidationError);
    expect(countOf(ctx, id)).toBe(3);
    const canInvite = async () =>
      (await execute(ctx, conversationsGetOp, s, { conversationId: id })).canInvite;
    const setLimit = (value: number) => {
      ctx.sqlite
        .prepare(
          "UPDATE permission_entries SET value = ?2 WHERE group_id = ?1 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'conversation.maxRecipients')",
        )
        .run(groupId, value);
      ctx.sqlite
        .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
        .run();
    };
    // Two other participants under a limit of two: no room, so no action is offered.
    expect(await canInvite()).toBe(false);
    setLimit(3);
    expect(await canInvite()).toBe(true);
    setLimit(-1);
    expect(await canInvite()).toBe(true);
    setLimit(0);
    expect(await canInvite()).toBe(false);
  });

  test("a person who ignores the starter cannot be added", async () => {
    const { ctx, a, c, id } = await started();
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)")
      .run(idOf(c), idOf(a), ctx.now());
    await expect(
      execute(ctx, conversationsAddParticipantsOp, a, { conversationId: id, userIds: [idOf(c)] }),
    ).rejects.toThrow(ForbiddenError);
    expect(countOf(ctx, id)).toBe(2);
    expect(rowOf(ctx, id, idOf(c))).toBeNull();
    expect(events(ctx)).toHaveLength(1);
  });

  test("the starter renames; nobody else does", async () => {
    const { ctx, a, b, dActor, moderator, admin, id } = await started();
    const renamed = await execute(ctx, conversationsRenameOp, a, {
      conversationId: id,
      title: "  New name  ",
    });
    expect(renamed.title).toBe("New name");
    expect((await execute(ctx, conversationsGetOp, b, { conversationId: id })).title).toBe(
      "New name",
    );
    expect((await execute(ctx, conversationsListOp, b, { limit: 5 })).items[0]!.title).toBe(
      "New name",
    );
    const input = { conversationId: id, title: "Taken over" };
    await expect(execute(ctx, conversationsRenameOp, GUEST, input)).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(execute(ctx, conversationsRenameOp, b, input)).rejects.toThrow(ForbiddenError);
    for (const outsider of [dActor, moderator, admin])
      await expect(execute(ctx, conversationsRenameOp, outsider, input)).rejects.toThrow(
        NotFoundError,
      );
    await expect(
      execute(ctx, conversationsRenameOp, a, { conversationId: id, title: "   " }),
    ).rejects.toThrow();
    await execute(ctx, conversationsLeaveOp, a, { conversationId: id });
    await expect(execute(ctx, conversationsRenameOp, a, input)).rejects.toThrow(NotFoundError);
    expect(
      ctx.sqlite
        .prepare<{ title: string }, [number]>("SELECT title FROM conversations WHERE id = ?1")
        .get(id)!.title,
    ).toBe("New name");
  });
  test("renaming needs conversation.reply, and canRename follows it", async () => {
    const { ctx, b } = setup();
    const groupId = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Start only', 10) RETURNING id",
      )
      .get()!.id;
    const starter = insertUser(ctx, { groupId });
    setGroupPermission(ctx, groupId, "conversation.start", 1);
    setGroupPermission(ctx, groupId, "conversation.maxRecipients", -1);
    const s = userActor(starter);
    const made = await execute(ctx, conversationsCreateOp, s, start([idOf(b)]));
    const id = made.conversation.id;
    const seen = await execute(ctx, conversationsGetOp, s, { conversationId: id });
    expect(seen.canReply).toBe(false);
    expect(seen.canRename).toBe(false);
    expect(made.conversation.canRename).toBe(false);
    await expect(
      execute(ctx, conversationsRenameOp, s, { conversationId: id, title: "Renamed" }),
    ).rejects.toThrow(ForbiddenError);
    expect(
      ctx.sqlite
        .prepare<{ title: string }, [number]>("SELECT title FROM conversations WHERE id = ?1")
        .get(id)!.title,
    ).toBe("Private thread");
  });

  test("a person added is unread only when there is a message to see", async () => {
    const { ctx, a, b, c, id } = await started();
    await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: id,
      userIds: [idOf(c)],
    });
    expect((await execute(ctx, conversationsGetOp, c, { conversationId: id })).isUnread).toBe(true);
    // A conversation whose only message is held for approval has nothing to read yet.
    const held = await execute(ctx, conversationsCreateOp, a, start([idOf(b)]));
    ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE conversation_id = ?1")
      .run(held.conversation.id);
    ctx.sqlite
      .prepare("UPDATE conversations SET message_count = 0 WHERE id = ?1")
      .run(held.conversation.id);
    await execute(ctx, conversationsAddParticipantsOp, a, {
      conversationId: held.conversation.id,
      userIds: [idOf(c)],
    });
    expect(
      (await execute(ctx, conversationsGetOp, c, { conversationId: held.conversation.id }))
        .isUnread,
    ).toBe(false);
  });

  test("the statements of adding people use indexes", async () => {
    const { ctx, id } = await started();
    expectNoTableScan(ctx, participantStatesSql, [id, "[1,2]"]);
    expectNoTableScan(ctx, reactivateParticipantSql, [1, id, 2]);
    expectNoTableScan(ctx, addParticipantSql, [id, 2, 1, 1, 0]);
    expectNoTableScan(ctx, incrementParticipantsSql, [1, id]);
  });
});
