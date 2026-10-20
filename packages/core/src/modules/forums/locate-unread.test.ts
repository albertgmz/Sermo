import { afterEach, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { firstUnreadPostSql } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const category = insertNode(ctx, { type: "category" });
  const forum = insertNode(ctx, { parentId: category.id });
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const reader = userActor(insertUser(ctx));
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const created = await call("threads.create", author, {
    nodeId: forum.id,
    title: "Thread",
    body: "Body",
  });
  const threadId = created.thread.id as number;
  const posts = [created.post as { id: number; position: number }];
  for (let i = 0; i < 4; i++)
    posts.push(await call("posts.create", author, { threadId, body: `reply ${i}` }));
  const locate = (actor: object) => call("threads.locateUnread", actor, { threadId });
  return { ctx, call, author, reader, threadId, posts, locate };
}

test("a reader who never opened the thread starts at its first post", async () => {
  const w = await world();
  expect(await w.locate(w.reader)).toEqual({
    threadId: w.threadId,
    postId: w.posts[0]!.id,
    position: 0,
  });
});

test("a reader picks up after the newest post they read, and at the newest once all is read", async () => {
  const w = await world();
  await w.call("threads.markRead", w.reader, { threadId: w.threadId, position: 2 });
  expect(await w.locate(w.reader)).toMatchObject({ postId: w.posts[3]!.id, position: 3 });
  await w.call("threads.markRead", w.reader, { threadId: w.threadId, position: 4 });
  expect(await w.locate(w.reader)).toMatchObject({ postId: w.posts[4]!.id, position: 4 });
});

test("a guest goes to the newest post; a missing thread is not found", async () => {
  const w = await world();
  expect(await w.locate(GUEST)).toMatchObject({ postId: w.posts[4]!.id, position: 4 });
  await expect(w.call("threads.locateUnread", GUEST, { threadId: 999 })).rejects.toThrow(
    NotFoundError,
  );
  expectNoTableScan(w.ctx, firstUnreadPostSql, [w.threadId, 1]);
});
