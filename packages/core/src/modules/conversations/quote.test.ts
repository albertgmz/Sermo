import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { renderContent } from "../../render";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsQuoteMessageOp,
  conversationsReplyOp,
  conversationsUpdateMessageOp,
} from "./index";

/** a starts a conversation with b; c has one of their own with a; d takes part in neither. */
async function setup() {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const cUser = insertUser(ctx);
  const a = userActor(aUser);
  const b = userActor(bUser);
  const c = userActor(cUser);
  const d = userActor(insertUser(ctx));
  const made = await execute(ctx, conversationsCreateOp, a, {
    title: "Private",
    recipientIds: [bUser.id],
    body: "first [B]words[/B]",
  });
  const other = await execute(ctx, conversationsCreateOp, c, {
    title: "Elsewhere",
    recipientIds: [aUser.id],
    body: "elsewhere",
  });
  const reply = (actor: typeof a, conversationId: number, body: string) =>
    execute(ctx, conversationsReplyOp, actor, { conversationId, body });
  const quote = (actor: typeof a, messageId: number) =>
    execute(ctx, conversationsQuoteMessageOp, actor, { messageId });
  return {
    ctx,
    aUser,
    bUser,
    a,
    b,
    c,
    d,
    id: made.conversation.id,
    first: made.message.id,
    other,
    reply,
    quote,
  };
}

const quoted = (name: string, messageId: number, memberId: number, text: string) =>
  `[QUOTE="${name}, convMessage: ${messageId}, member: ${memberId}"]${text}[/QUOTE]`;

describe("the source of a message to quote", () => {
  test("a participant gets the author and the source of someone else's message", async () => {
    const s = await setup();
    const got = await s.quote(s.b, s.first);
    expect(got).toEqual({
      messageId: s.first,
      author: { kind: "member", id: s.aUser.id, username: s.aUser.username },
      bodySource: "first [B]words[/B]",
    });
  });

  test("a non-participant finds nothing and a guest is asked to sign in", async () => {
    const s = await setup();
    await expect(s.quote(s.d, s.first)).rejects.toThrow(NotFoundError);
    await expect(s.quote(s.c, s.first)).rejects.toThrow(NotFoundError);
    await expect(s.quote(GUEST, s.first)).rejects.toThrow(UnauthenticatedError);
  });

  test("a guest is refused before what they sent is read", async () => {
    const s = await setup();
    await expect(
      execute(s.ctx, conversationsQuoteMessageOp, GUEST, {
        messageId: "abc" as unknown as number,
      }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  test("a deleted message cannot be quoted", async () => {
    const s = await setup();
    const gone = await s.reply(s.b, s.id, "gone");
    await execute(s.ctx, conversationsDeleteMessageOp, s.b, { messageId: gone.id });
    await expect(s.quote(s.a, gone.id)).rejects.toThrow(NotFoundError);
  });
});

describe("a quote of a message in a reply", () => {
  test("links to the quoted message under its author's name and keeps the reference in the source", async () => {
    const s = await setup();
    const sent = await s.reply(s.b, s.id, `${quoted("someone", s.first, 99, "first")}\n\nyes`);
    expect(sent.bodyHtml).toContain(
      `<blockquote class="bb-quote"><cite class="bb-quote-author"><a href="/conversations/messages/${s.first}" rel="nofollow ugc noopener">${s.aUser.username}</a></cite>`,
    );
    const row = s.ctx.sqlite
      .prepare<{ body_source: string }, [number]>(
        "SELECT body_source FROM conversation_messages WHERE id = ?1",
      )
      .get(sent.id)!;
    expect(row.body_source).toStartWith(
      `[QUOTE="${s.aUser.username}, convMessage: ${s.first}, member: ${s.aUser.id}"]first[/QUOTE]`,
    );
  });

  test("an edit keeps the link", async () => {
    const s = await setup();
    const sent = await s.reply(s.b, s.id, "plain");
    const edited = await execute(s.ctx, conversationsUpdateMessageOp, s.b, {
      messageId: sent.id,
      body: quoted("x", s.first, s.aUser.id, "first"),
    });
    expect(edited.bodyHtml).toContain(`href="/conversations/messages/${s.first}"`);
  });

  test("a message of another conversation is quoted without a link and without its author", async () => {
    const s = await setup();
    const sent = await s.reply(s.a, s.id, quoted("typed", s.other.message.id, 1, "elsewhere"));
    expect(sent.bodyHtml).not.toContain("/conversations/messages/");
    expect(sent.bodyHtml).toContain('<cite class="bb-quote-author">typed</cite>');
  });

  test("a deleted message is quoted without a link", async () => {
    const s = await setup();
    const gone = await s.reply(s.b, s.id, "gone");
    await execute(s.ctx, conversationsDeleteMessageOp, s.b, { messageId: gone.id });
    const sent = await s.reply(s.a, s.id, quoted("typed", gone.id, s.bUser.id, "gone"));
    expect(sent.bodyHtml).not.toContain("/conversations/messages/");
  });

  test("outside a conversation (a post) a message quote never links", async () => {
    const s = await setup();
    const html = renderContent(s.ctx, s.a, quoted("typed", s.first, s.aUser.id, "first")).html;
    expect(html).not.toContain("/conversations/messages/");
    expect(html).toContain('<cite class="bb-quote-author">typed</cite>');
  });
});

test("a member whose name holds a post reference is still quoted as the author of a message", async () => {
  const s = await setup();
  const odd = insertUser(s.ctx, { username: "Ann, post: 7" });
  const made = await execute(s.ctx, conversationsCreateOp, userActor(odd), {
    title: "Odd",
    recipientIds: [s.aUser.id],
    body: "hello",
  });
  const conversationId = made.conversation.id;
  const sent = await s.reply(
    s.a,
    conversationId,
    quoted("Ann post: 7", made.message.id, odd.id, "hello"),
  );
  expect(sent.bodyHtml).toContain(`href="/conversations/messages/${made.message.id}"`);
  // The stored source names the member as they are called, and an edit reads it back the same.
  const edited = await execute(s.ctx, conversationsUpdateMessageOp, s.a, {
    messageId: sent.id,
    body: s.ctx.sqlite
      .prepare<{ body_source: string }, [number]>(
        "SELECT body_source FROM conversation_messages WHERE id = ?1",
      )
      .get(sent.id)!.body_source,
  });
  expect(edited.bodyHtml).toContain(`href="/conversations/messages/${made.message.id}"`);
});
