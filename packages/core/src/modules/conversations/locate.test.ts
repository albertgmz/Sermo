import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import {
  conversationsCreateOp,
  conversationsListMessagesOp,
  conversationsLocateMessageOp,
  conversationsLocateUnreadOp,
  conversationsMarkReadOp,
  conversationsReplyOp,
  locateMessageSql,
} from "./index";

async function fixture(replies: number) {
  const ctx = createTestContext();
  const a = userActor(insertUser(ctx));
  const bUser = insertUser(ctx);
  const b = userActor(bUser);
  const c = userActor(insertUser(ctx));
  const { conversation, message } = await execute(ctx, conversationsCreateOp, a, {
    title: "Private",
    recipientIds: [bUser.id],
    body: "first",
  });
  const ids = [message.id];
  for (let i = 0; i < replies; i++)
    ids.push(
      (
        await execute(ctx, conversationsReplyOp, a, {
          conversationId: conversation.id,
          body: `m${i}`,
        })
      ).id,
    );
  return { ctx, a, b, c, conversationId: conversation.id, ids };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function pageAt(f: Fixture, cursor: string | null, limit: number) {
  const page = await execute(f.ctx, conversationsListMessagesOp, f.b, {
    conversationId: f.conversationId,
    order: "newest",
    cursor: cursor ?? undefined,
    limit,
  });
  return page.items.map((message) => message.id);
}

// The pages a reader walks from the newest message back.
async function walk(f: Fixture, limit: number) {
  const pages: number[][] = [];
  let cursor: string | undefined;
  do {
    const page = await execute(f.ctx, conversationsListMessagesOp, f.b, {
      conversationId: f.conversationId,
      order: "newest",
      cursor,
      limit,
    });
    pages.push(page.items.map((message) => message.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

describe("conversations.locateMessage", () => {
  test("gives the newest-order cursor of the page that holds the message", async () => {
    const f = await fixture(10);
    const pages = await walk(f, 4);
    for (const id of f.ids) {
      const located = await execute(f.ctx, conversationsLocateMessageOp, f.b, {
        messageId: id,
        limit: 4,
      });
      expect(located.conversationId).toBe(f.conversationId);
      expect(located.messageId).toBe(id);
      const page = await pageAt(f, located.cursor, 4);
      expect(pages).toContainEqual(page);
      expect(page).toContain(id);
    }
    const newest = await execute(f.ctx, conversationsLocateMessageOp, f.b, {
      messageId: f.ids.at(-1)!,
      limit: 4,
    });
    expect(newest.cursor).toBeNull();
  });

  test("anyone but an active participant finds nothing", async () => {
    const f = await fixture(1);
    await expect(
      execute(f.ctx, conversationsLocateMessageOp, f.c, { messageId: f.ids[0]!, limit: 20 }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, conversationsLocateMessageOp, GUEST, { messageId: f.ids[0]!, limit: 20 }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(f.ctx, conversationsLocateMessageOp, f.b, { messageId: 999, limit: 20 }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("conversations.locateUnread", () => {
  test("goes to the first message after the last one read, else to the newest", async () => {
    const f = await fixture(9);
    // The starter has read everything they sent; the recipient has read nothing.
    const unread = await execute(f.ctx, conversationsLocateUnreadOp, f.b, {
      conversationId: f.conversationId,
      limit: 4,
    });
    expect(unread.messageId).toBe(f.ids[0]!);
    expect(await pageAt(f, unread.cursor, 4)).toContain(f.ids[0]!);
    await execute(f.ctx, conversationsMarkReadOp, f.b, { conversationId: f.conversationId });
    const reply = await execute(f.ctx, conversationsReplyOp, f.a, {
      conversationId: f.conversationId,
      body: "new",
    });
    const next = await execute(f.ctx, conversationsLocateUnreadOp, f.b, {
      conversationId: f.conversationId,
      limit: 4,
    });
    expect(next).toEqual({ conversationId: f.conversationId, messageId: reply.id, cursor: null });
    const read = await execute(f.ctx, conversationsLocateUnreadOp, f.a, {
      conversationId: f.conversationId,
      limit: 4,
    });
    expect(read.messageId).toBe(reply.id);
  });

  test("a non-participant finds nothing", async () => {
    const f = await fixture(0);
    await expect(
      execute(f.ctx, conversationsLocateUnreadOp, f.c, {
        conversationId: f.conversationId,
        limit: 20,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("its queries seek the conversation's index", async () => {
    const f = await fixture(0);
    expectNoTableScan(f.ctx, locateMessageSql.above, [1, 1, 1, 0]);
    expectNoTableScan(f.ctx, locateMessageSql.nth, [1, 1, 1, 0, 3]);
    expectNoTableScan(f.ctx, locateMessageSql.firstAfter, [1, 1, 1, 0]);
    expectNoTableScan(f.ctx, locateMessageSql.newest, [1, 1, 1, 0]);
  });
});
