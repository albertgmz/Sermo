import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resumeSpamCleanup } from "../moderation";
import { traceStatements } from "../statement-trace";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const trace = traceStatements(ctx);
  const category = insertNode(ctx, { type: "category" });
  const forum = insertNode(ctx, { parentId: category.id });
  invalidate(ctx, "node_tree");
  const moderatorRow = insertUser(ctx, { groupId: 3 });
  const moderator = userActor(moderatorRow);
  const authorRow = insertUser(ctx);
  const author = userActor(authorRow);
  const other = userActor(insertUser(ctx));
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const created = await call("threads.create", author, {
    nodeId: forum.id,
    title: "Thread",
    body: "Body",
  });
  const threadId = created.thread.id as number;
  const reply = await call("posts.create", author, { threadId, body: "Reply" });
  const list = (actor: object) => call("posts.list", actor, { threadId });
  const deletionOf = async (actor: object) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    (await list(actor)).items.find((post: any) => post.id === reply.id)?.deletion;
  return {
    ctx,
    trace,
    moderator,
    moderatorId: moderatorRow.id,
    authorId: authorRow.id,
    author,
    other,
    call,
    threadId,
    reply,
    deletionOf,
  };
}

describe("posts: who hid a deleted post, and why", () => {
  test("a moderator sees the member who hid it, the reason and the time", async () => {
    const w = await world();
    expect(await w.deletionOf(w.moderator)).toBeNull();
    await w.call("posts.delete", w.moderator, {
      postId: w.reply.id,
      reason: "Off topic",
      notify: false,
    });
    const deletion = await w.deletionOf(w.moderator);
    expect(deletion.by.id).toBe(w.moderatorId);
    expect(deletion.reason).toBe("Off topic");
    expect(Number.isNaN(Date.parse(deletion.at))).toBe(false);
    const single = await w.call("posts.get", w.moderator, { postId: w.reply.id });
    expect(single.deletion).toEqual(deletion);
  });

  test("an author who hid their own post is named as the one who did", async () => {
    const w = await world();
    await w.call("posts.delete", w.author, { postId: w.reply.id, reason: "", notify: false });
    const deletion = await w.deletionOf(w.moderator);
    expect(deletion.by.id).toBe(w.authorId);
    expect(deletion.reason).toBe("");
  });

  test("the newest deletion is the one shown after a restore", async () => {
    const w = await world();
    const hide = (actor: object, reason: string) =>
      w.call("posts.delete", actor, { postId: w.reply.id, reason, notify: false });
    await hide(w.moderator, "First");
    await w.call("posts.restore", w.moderator, {
      postId: w.reply.id,
      reason: "",
      notify: false,
    });
    expect(await w.deletionOf(w.moderator)).toBeNull();
    await hide(w.author, "");
    const deletion = await w.deletionOf(w.moderator);
    expect(deletion.by.id).toBe(w.authorId);
    expect(deletion.reason).toBe("");
  });

  test("a post hidden through moderation.setState names its moderator and reason", async () => {
    const w = await world();
    await w.call("moderation.setState", w.moderator, {
      target: { type: "post", id: w.reply.id },
      state: "deleted",
      reason: "Spam",
      notify: false,
    });
    const deletion = await w.deletionOf(w.moderator);
    expect(deletion.by.id).toBe(w.moderatorId);
    expect(deletion.reason).toBe("Spam");
  });

  test("a post hidden by a spam cleanup names the moderator who ran it, never its author", async () => {
    const w = await world();
    const admin = userActor(insertUser(w.ctx, { groupId: 4 }));
    resumeSpamCleanup(w.ctx, admin, w.authorId, null, 100, "Spam");
    const deletion = await w.deletionOf(w.moderator);
    expect(deletion).not.toBeNull();
    expect(deletion.by.id).toBe(actorUserId(admin));
    expect(deletion.by.id).not.toBe(w.authorId);
    expect(deletion.reason).toBe("Spam");
  });

  test("members who cannot see deleted posts never get it, and a visible post has none", async () => {
    const w = await world();
    await w.call("posts.delete", w.moderator, {
      postId: w.reply.id,
      reason: "Rude",
      notify: false,
    });
    for (const actor of [w.other, w.author, GUEST]) {
      const listed = await w.call("posts.list", actor, { threadId: w.threadId });
      expect(listed.items.some((post: { id: number }) => post.id === w.reply.id)).toBe(false);
      expect(listed.items.every((post: { deletion: unknown }) => post.deletion === null)).toBe(
        true,
      );
    }
    // The post the author hid is returned to them by posts.delete itself, without the detail.
    const own = await w.call("posts.delete", w.author, {
      postId: (await w.call("posts.create", w.author, { threadId: w.threadId, body: "More" })).id,
      reason: "",
      notify: false,
    });
    expect(own.deletion).toBeNull();
  });

  test("it costs one indexed lookup for a page, and none without a deleted post", async () => {
    const w = await world();
    const lookup = /FROM domain_events WHERE target_type = 'post'/;
    w.trace.sql.length = 0;
    await w.call("posts.list", w.moderator, { threadId: w.threadId });
    expect(w.trace.count(lookup)).toBe(0);
    await w.call("posts.delete", w.moderator, { postId: w.reply.id, reason: "x", notify: false });
    w.trace.sql.length = 0;
    await w.call("posts.list", w.moderator, { threadId: w.threadId });
    expect(w.trace.count(lookup)).toBe(1);
    expectNoTableScan(
      w.ctx,
      "SELECT id, target_id, payload, created_at FROM domain_events WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?1)) AND type = 'content.deleted'",
      ["[1]"],
    );
  });
});
