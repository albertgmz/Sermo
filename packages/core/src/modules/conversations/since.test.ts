import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { visibleMessagesSql } from "./index";

type Listed = {
  items: { id: number; bodyHtml: string }[];
  nextCursor: string | null;
  total: number | null;
};
const plain = (html: string) => html.replace(/<[^>]+>/g, "").trim();

/** a starts the conversation with b; the admin (a holder of conversation.moderate) is in too. */
async function setup() {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const outsiderUser = insertUser(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const a = userActor(aUser);
  const b = userActor(bUser);
  const outsider = userActor(outsiderUser);
  const admin = userActor(adminUser);
  const call = (name: string, actor: object, input: object) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const made = await call("conversations.create", a, {
    title: "Private",
    recipientIds: [bUser.id, adminUser.id],
    body: "first",
  });
  const id = made.conversation.id as number;
  const reply = (actor: object, body: string) =>
    call("conversations.reply", actor, { conversationId: id, body });
  const since = (actor: object, afterMessageId: number, extra: object = {}) =>
    call("conversations.listMessages", actor, {
      conversationId: id,
      afterMessageId,
      ...extra,
    }) as Promise<Listed>;
  return {
    ctx,
    a,
    b,
    bUser,
    outsider,
    admin,
    id,
    first: made.message.id as number,
    call,
    reply,
    since,
  };
}

const bodies = (page: Listed) => page.items.map((message) => plain(message.bodyHtml));

describe("conversations.listMessages afterMessageId", () => {
  test("lists the messages above the id, oldest first, and nothing when there is nothing new", async () => {
    const s = await setup();
    const one = await s.reply(s.b, "one");
    const two = await s.reply(s.a, "two");
    for (const actor of [s.a, s.b, s.admin, tokenActor(s.bUser)]) {
      const page = await s.since(actor, s.first);
      expect(bodies(page)).toEqual(["one", "two"]);
      expect(page.nextCursor).toBeNull();
      expect(bodies(await s.since(actor, one.id))).toEqual(["two"]);
      expect(await s.since(actor, two.id)).toEqual({ items: [], nextCursor: null, total: null });
      expect(await s.since(actor, two.id + 100)).toEqual({
        items: [],
        nextCursor: null,
        total: null,
      });
    }
    // The order does not turn the poll around.
    expect(bodies(await s.since(s.a, s.first, { order: "newest" }))).toEqual(["one", "two"]);
    // A reply after the poll shows up on the next one.
    const three = await s.reply(s.b, "three");
    expect((await s.since(s.a, two.id)).items.map((message) => message.id)).toEqual([three.id]);
  });

  test("pages of limit messages continue with the cursor, which wins over afterMessageId and order", async () => {
    const s = await setup();
    for (const body of ["a", "b", "c", "d", "e"]) await s.reply(s.b, body);
    const first = await s.since(s.a, s.first, { limit: 2 });
    expect(bodies(first)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await s.since(s.a, s.first, { limit: 2, cursor: first.nextCursor });
    expect(bodies(second)).toEqual(["c", "d"]);
    const third = await s.since(s.a, s.first, { limit: 2, cursor: second.nextCursor });
    expect(bodies(third)).toEqual(["e"]);
    expect(third.nextCursor).toBeNull();
    // A cursor of the newest order keeps walking back, whatever afterMessageId says.
    const newest = (await s.call("conversations.listMessages", s.a, {
      conversationId: s.id,
      order: "newest",
      limit: 2,
    })) as Listed;
    const older = await s.since(s.a, s.first, {
      order: "newest",
      limit: 2,
      cursor: newest.nextCursor,
    });
    expect(bodies(older)).toEqual(["c", "b"]);
  });

  test("shows each viewer the messages they may see: moderated, deleted", async () => {
    const s = await setup();
    await s.reply(s.b, "plain");
    const doomed = await s.reply(s.b, "doomed");
    await s.call("conversations.deleteMessage", s.admin, { messageId: doomed.id });
    s.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run((await s.reply(s.b, "waiting")).id);
    await s.reply(s.a, "last");
    expect(bodies(await s.since(s.a, s.first))).toEqual(["plain", "last"]);
    // The author of a moderated message sees it; the holder of conversation.viewHidden sees all.
    expect(bodies(await s.since(s.b, s.first))).toEqual(["plain", "waiting", "last"]);
    expect(bodies(await s.since(s.admin, s.first))).toEqual(["plain", "doomed", "waiting", "last"]);
  });

  test("only a participant may poll: others get not found, guests are refused", async () => {
    const s = await setup();
    await s.reply(s.b, "secret");
    await expect(s.since(s.outsider, s.first)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.since(s.a, s.first, { conversationId: 99999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(s.since(GUEST, s.first)).rejects.toBeInstanceOf(UnauthenticatedError);
    // Someone who left cannot read on.
    await s.call("conversations.leave", s.b, { conversationId: s.id });
    await expect(s.since(s.b, s.first)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a zero or fractional id is refused", async () => {
    const s = await setup();
    await expect(s.since(s.a, 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.since(s.a, 1.5)).rejects.toBeInstanceOf(ValidationError);
  });

  test("the query reads the conversation's message index", async () => {
    const s = await setup();
    expectNoTableScan(s.ctx, visibleMessagesSql, [s.id, 1, 21, 1, 0]);
  });
});
