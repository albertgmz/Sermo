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
import {
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

describe("conversations", () => {
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
    await expect(execute(ctx, conversationsCreateOp, a, start([aId]))).rejects.toThrow(
      ValidationError,
    );
    await expect(execute(ctx, conversationsCreateOp, a, start([]))).rejects.toThrow(
      ValidationError,
    );
    await expect(execute(ctx, conversationsCreateOp, a, start([999999]))).rejects.toThrow(
      ValidationError,
    );
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
});
