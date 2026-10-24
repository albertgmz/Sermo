import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import {
  conversationsCreateOp,
  conversationsLeaveOp,
  conversationsListMessagesOp,
  conversationsListOp,
  conversationsLocateMessageOp,
  conversationsReplyOp,
  inboxCountSql,
  inboxKeySql,
  locateMessageSql,
} from "./index";

function people() {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const cUser = insertUser(ctx);
  return { ctx, a: userActor(aUser), b: userActor(bUser), c: userActor(cUser), bUser, cUser };
}

const ids = (page: { items: { id: number }[] }) => page.items.map((item) => item.id);

// The plan reads only the index: no row of the table is opened to skip or count.
function indexOnly(ctx: ReturnType<typeof people>["ctx"], sql: string, params: unknown[]) {
  const plan = ctx.sqlite
    .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(params as never[]))
    .map((row) => row.detail);
  expect(plan.join("\n")).toContain("USING COVERING INDEX");
  expect(plan.join("\n")).not.toContain("TEMP B-TREE");
}

describe("conversations.list numbered pages", () => {
  test("pages run from the newest activity; only the viewer's active conversations count", async () => {
    const p = people();
    const made: number[] = [];
    for (let i = 0; i < 5; i++) {
      p.ctx.clock.advance(60_000);
      const { conversation } = await execute(p.ctx, conversationsCreateOp, p.a, {
        title: `C${i}`,
        recipientIds: [p.bUser.id],
        body: "hello",
      });
      made.push(conversation.id);
    }
    // One the viewer left, and one they are not part of: neither is listed nor counted.
    await execute(p.ctx, conversationsLeaveOp, p.b, { conversationId: made[1]! });
    p.ctx.clock.advance(60_000);
    await execute(p.ctx, conversationsCreateOp, p.a, {
      title: "Not for b",
      recipientIds: [p.cUser.id],
      body: "private",
    });
    const list = (page: number) => execute(p.ctx, conversationsListOp, p.b, { page, limit: 2 });
    const [one, two, three] = await Promise.all([list(1), list(2), list(3)]);
    expect(ids(one)).toEqual([made[4]!, made[3]!]);
    expect(ids(two)).toEqual([made[2]!, made[0]!]);
    expect(ids(three)).toEqual([]);
    for (const page of [one, two, three]) expect(page.total).toBe(4);
    expect((await execute(p.ctx, conversationsListOp, p.a, { page: 1 })).total).toBe(6);
    // A cursor walk carries no count.
    expect((await execute(p.ctx, conversationsListOp, p.b, { limit: 2 })).total).toBeNull();
  });

  test("the inbox pages are read from its index alone", () => {
    const { ctx } = people();
    indexOnly(ctx, inboxKeySql, [1, 40]);
    indexOnly(ctx, inboxCountSql, [1]);
  });
});

describe("conversations.listMessages numbered pages", () => {
  async function talk() {
    const p = people();
    const { conversation, message } = await execute(p.ctx, conversationsCreateOp, p.a, {
      title: "Long",
      recipientIds: [p.bUser.id],
      body: "m0",
    });
    const messages = [message.id];
    for (let i = 1; i < 8; i++)
      messages.push(
        (
          await execute(p.ctx, conversationsReplyOp, i % 2 ? p.b : p.a, {
            conversationId: conversation.id,
            body: `m${i}`,
          })
        ).id,
      );
    // m3, by b, waits for approval: b sees it, a does not.
    p.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(messages[3]!);
    const page = (actor: typeof p.a, number: number) =>
      execute(p.ctx, conversationsListMessagesOp, actor, {
        conversationId: conversation.id,
        page: number,
        limit: 3,
      });
    return { ...p, conversationId: conversation.id, m: messages, page };
  }

  test("page 1 holds the oldest messages and the last page the newest", async () => {
    const t = await talk();
    const [one, two, three, past] = await Promise.all(
      [1, 2, 3, 4].map((number) => t.page(t.b, number)),
    );
    expect(ids(one!)).toEqual([t.m[0]!, t.m[1]!, t.m[2]!]);
    expect(ids(two!)).toEqual([t.m[3]!, t.m[4]!, t.m[5]!]);
    expect(ids(three!)).toEqual([t.m[6]!, t.m[7]!]);
    expect(three!.nextCursor).toBeNull();
    expect(ids(past!)).toEqual([]);
    for (const page of [one, two, three, past]) expect(page!.total).toBe(8);
  });

  test("a message the viewer may not see is neither on a page nor counted", async () => {
    const t = await talk();
    const one = await t.page(t.a, 1);
    const two = await t.page(t.a, 2);
    expect(one.total).toBe(7);
    expect(ids(one)).toEqual([t.m[0]!, t.m[1]!, t.m[2]!]);
    expect(ids(two)).toEqual([t.m[4]!, t.m[5]!, t.m[6]!]);
    expect(ids(await t.page(t.a, 3))).toEqual([t.m[7]!]);
  });

  test("a located message names its page counted from the oldest", async () => {
    const t = await talk();
    const at = async (actor: typeof t.a, index: number) =>
      (
        await execute(t.ctx, conversationsLocateMessageOp, actor, {
          messageId: t.m[index]!,
          limit: 3,
        })
      ).page;
    expect(await Promise.all([0, 2, 3, 7].map((index) => at(t.b, index)))).toEqual([1, 1, 2, 3]);
    // For a, who does not see m3, m4 is the fourth message: still page 2; m7 the seventh, page 3.
    expect(await Promise.all([4, 6, 7].map((index) => at(t.a, index)))).toEqual([2, 2, 3]);
  });

  test("a poll carries no count; the page counts are read from the index alone", async () => {
    const t = await talk();
    const poll = await execute(t.ctx, conversationsListMessagesOp, t.b, {
      conversationId: t.conversationId,
      afterMessageId: t.m[7]!,
      page: 2,
    });
    expect(poll).toEqual({ items: [], nextCursor: null, total: null });
    indexOnly(t.ctx, locateMessageSql.above, [1, 0, 1, 0]);
    indexOnly(t.ctx, locateMessageSql.nth, [1, 0, 1, 0, 40]);
    indexOnly(t.ctx, locateMessageSql.below, [1, 99, 1, 0]);
  });
});
