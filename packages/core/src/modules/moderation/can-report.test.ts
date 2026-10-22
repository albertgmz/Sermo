import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  insertNode(ctx, { type: "category" });
  invalidate(ctx, "node_tree");
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = userActor(insertUser(ctx));
  const reader = userActor(insertUser(ctx));
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const conversation = await call("conversations.create", author, {
    title: "Hello",
    recipientIds: [actorUserId(reader)!, actorUserId(admin)!],
    body: "First",
  });
  const message = await call("conversations.reply", author, {
    conversationId: conversation.conversation.id,
    body: "Second",
  });
  const wallPost = await call("profilePosts.create", author, {
    userId: actorUserId(author),
    body: "Wall",
  });
  const comment = await call("profileComments.create", author, {
    profilePostId: wallPost.id,
    body: "Comment",
  });
  const forbid = (userId: number) =>
    call("permissions.set", admin, {
      userId,
      entries: [{ permission: "report.create", value: "never" }],
    });
  return {
    ctx,
    call,
    admin,
    author,
    reader,
    forbid,
    conversationId: conversation.conversation.id as number,
    firstMessage: conversation.message,
    message,
    wallPost,
    comment,
  };
}

describe("canReport on messages, wall posts and comments", () => {
  test("a conversation message carries it on every read and write that returns one", async () => {
    const w = await world();
    expect(w.firstMessage.canReport).toBe(true);
    expect(w.message.canReport).toBe(true);
    const listed = await w.call("conversations.listMessages", w.reader, {
      conversationId: w.conversationId,
    });
    expect(listed.items.map((item: { canReport: boolean }) => item.canReport)).toEqual([
      true,
      true,
    ]);
    await w.forbid(actorUserId(w.reader)!);
    const after = await w.call("conversations.listMessages", w.reader, {
      conversationId: w.conversationId,
    });
    expect(after.items.map((item: { canReport: boolean }) => item.canReport)).toEqual([
      false,
      false,
    ]);
    await expect(
      w.call("reports.create", w.reader, {
        target: { type: "conversation_message", id: w.message.id },
        reason: "Spam",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a hidden message a viewer sees is not reportable by them, as reports.create refuses it", async () => {
    const w = await world();
    await w.call("conversations.deleteMessage", w.author, { messageId: w.message.id });
    const seen = await w.call("conversations.listMessages", w.admin, {
      conversationId: w.conversationId,
    });
    const hidden = seen.items.find((item: { id: number }) => item.id === w.message.id);
    expect(hidden.state).toBe("deleted");
    expect(hidden.canReport).toBe(false);
    await expect(
      w.call("reports.create", w.admin, {
        target: { type: "conversation_message", id: w.message.id },
        reason: "Spam",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The visible message beside it stays reportable.
    expect(seen.items.find((item: { id: number }) => item.id === w.firstMessage.id).canReport).toBe(
      true,
    );
  });

  test("a wall post and its comments carry it, and it follows report.create", async () => {
    const w = await world();
    const userId = actorUserId(w.author)!;
    expect(w.wallPost.canReport).toBe(true);
    expect(w.comment.canReport).toBe(true);
    const wall = await w.call("profilePosts.list", w.reader, { userId });
    expect(wall.items[0].canReport).toBe(true);
    expect(wall.items[0].latestComments[0].canReport).toBe(true);
    const comments = await w.call("profileComments.list", w.reader, {
      profilePostId: w.wallPost.id,
    });
    expect(comments.items[0].canReport).toBe(true);
    const guest = await w.call("profilePosts.list", GUEST, { userId });
    expect(guest.items[0].canReport).toBe(false);
    expect(guest.items[0].latestComments[0].canReport).toBe(false);
    await w.forbid(actorUserId(w.reader)!);
    const after = await w.call("profilePosts.list", w.reader, { userId });
    expect(after.items[0].canReport).toBe(false);
    expect(after.items[0].latestComments[0].canReport).toBe(false);
    expect(
      (await w.call("profileComments.list", w.reader, { profilePostId: w.wallPost.id })).items[0]
        .canReport,
    ).toBe(false);
    for (const target of [
      { type: "profile_post", id: w.wallPost.id },
      { type: "profile_post_comment", id: w.comment.id },
    ])
      await expect(
        w.call("reports.create", w.reader, { target, reason: "Spam" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
