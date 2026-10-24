import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { execute } from "../../operation";
import { traceStatements } from "../statement-trace";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsListMessagesOp,
  conversationsReplyOp,
} from "./index";

/** a starts a conversation with b and an administrator; b replies twice. */
async function setup() {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const [aUser, bUser, adminUser] = [
    insertUser(ctx),
    insertUser(ctx),
    insertUser(ctx, { groupId: 4 }),
  ];
  const [a, b, admin] = [aUser, bUser, adminUser].map((user) => userActor(user)!);
  const made = await execute(ctx, conversationsCreateOp, a!, {
    title: "Private",
    recipientIds: [bUser.id, adminUser.id],
    body: "first",
  });
  const conversationId = made.conversation.id;
  const reply = (body: string) =>
    execute(ctx, conversationsReplyOp, b!, { conversationId, body, attachmentIds: [] });
  const list = (actor: NonNullable<typeof a>) =>
    execute(ctx, conversationsListMessagesOp, actor, { conversationId });
  return { ctx, trace, a: a!, b: b!, admin: admin!, bUser, adminUser, reply, list };
}

describe("conversations: who hid a deleted message, and why", () => {
  test("an administrator sees who deleted a message, the reason and the time; the participants without the right get nothing", async () => {
    const s = await setup();
    try {
      const byAdmin = await s.reply("rude");
      const byAuthor = await s.reply("oops");
      await execute(s.ctx, conversationsDeleteMessageOp, s.admin, {
        messageId: byAdmin.id,
        reason: "Rude",
        notify: false,
      });
      await execute(s.ctx, conversationsDeleteMessageOp, s.b, {
        messageId: byAuthor.id,
        reason: "",
      });
      const seen = (await s.list(s.admin)).items;
      const one = seen.find((message) => message.id === byAdmin.id)!;
      expect(one.deletion?.by).toEqual({
        kind: "member",
        id: s.adminUser.id,
        username: s.adminUser.username,
      });
      expect(one.deletion?.reason).toBe("Rude");
      expect(Number.isNaN(Date.parse(one.deletion?.at ?? ""))).toBe(false);
      // Hidden by its author: the author is named, with no reason.
      const own = seen.find((message) => message.id === byAuthor.id)!;
      expect(own.deletion?.by).toMatchObject({ kind: "member", id: s.bUser.id });
      expect(own.deletion?.reason).toBe("");
      // A live message has none.
      expect(
        seen.filter((message) => message.state === "visible").every((m) => m.deletion === null),
      ).toBe(true);

      for (const actor of [s.a, s.b]) {
        const items = (await s.list(actor)).items;
        expect(items.some((message) => message.state === "deleted")).toBe(false);
        expect(items.every((message) => message.deletion === null)).toBe(true);
      }
    } finally {
      closeContext(s.ctx);
    }
  });

  test("a page costs one lookup of deletions, and none for a viewer who may not see them", async () => {
    const s = await setup();
    try {
      const gone = await s.reply("gone");
      await execute(s.ctx, conversationsDeleteMessageOp, s.admin, {
        messageId: gone.id,
        reason: "x",
        notify: false,
      });
      const lookup = /FROM domain_events WHERE target_type = 'conversation_message'/;
      s.trace.sql.length = 0;
      await s.list(s.admin);
      expect(s.trace.count(lookup)).toBe(1);
      s.trace.sql.length = 0;
      await s.list(s.a);
      expect(s.trace.count(lookup)).toBe(0);
    } finally {
      closeContext(s.ctx);
    }
  });
});
