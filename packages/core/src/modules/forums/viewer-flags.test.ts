import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
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
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const authorRow = insertUser(ctx);
  const otherRow = insertUser(ctx);
  const author = userActor(authorRow);
  const other = userActor(otherRow);
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const created = await call("threads.create", author, {
    nodeId: forum.id,
    title: "Thread",
    body: "Body",
  });
  const reply = await call("posts.create", other, { threadId: created.thread.id, body: "Reply" });
  const threadId = created.thread.id as number;
  const get = (actor: object, input: object = {}) =>
    call("threads.get", actor, { threadId, ...input });
  return {
    ctx,
    trace,
    category,
    forum,
    admin,
    moderator,
    author,
    authorId: authorRow.id,
    otherId: otherRow.id,
    other,
    call,
    threadId,
    reply,
    get,
  };
}

const plan = (ctx: ReturnType<typeof createTestContext>, sql: string, params: number[]) =>
  ctx.sqlite
    .prepare<{ detail: string }, number[]>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => row.detail)
    .join(" ");

describe("threads.get: watching", () => {
  test("is null for a guest and for a member who does not watch, and follows watch and unwatch", async () => {
    const w = await world();
    expect((await w.get(GUEST)).watching).toBeNull();
    expect((await w.get(w.other)).watching).toBeNull();
    await w.call("threads.watch", w.other, { threadId: w.threadId });
    expect((await w.get(w.other)).watching).toEqual({ email: false });
    await w.call("threads.watch", w.other, { threadId: w.threadId, email: true });
    expect((await w.get(w.other)).watching).toEqual({ email: true });
    // Another member's watch is never shown.
    expect((await w.get(w.author)).watching).toBeNull();
    await w.call("threads.unwatch", w.other, { threadId: w.threadId });
    expect((await w.get(w.other)).watching).toBeNull();
  });

  test("costs one indexed lookup for a signed-in viewer and none for a guest", async () => {
    const w = await world();
    await w.get(w.other);
    const lookup = /FROM thread_watches/;
    w.trace.sql.length = 0;
    await w.get(GUEST);
    expect(w.trace.count(lookup)).toBe(0);
    w.trace.sql.length = 0;
    await w.get(w.other);
    expect(w.trace.count(lookup)).toBe(1);
    const sql = "SELECT email FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2";
    expectNoTableScan(w.ctx, sql, [w.threadId, 1]);
    expect(plan(w.ctx, sql, [w.threadId, 1])).toContain("thread_watches_thread_user");
  });
});

describe("threads.get: countView", () => {
  test("counts a view by default and with true, and not with false", async () => {
    const w = await world();
    const views = () => w.ctx.views.get(w.threadId) ?? 0;
    await w.get(w.other);
    expect(views()).toBe(1);
    await w.get(w.other, { countView: true });
    expect(views()).toBe(2);
    const quiet = await w.get(w.other, { countView: false });
    expect(views()).toBe(2);
    expect(quiet.thread.viewCount).toBe(2);
    await w.get(GUEST, { countView: false });
    expect(views()).toBe(2);
  });
});

describe("threads.get: viewer flags", () => {
  test("canReport follows report.create, as reports.create enforces it", async () => {
    const w = await world();
    const target = { type: "post", id: w.reply.id };
    expect((await w.get(GUEST)).permissions.canReport).toBe(false);
    await expect(
      w.call("reports.create", GUEST, { target, reason: "Rude" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect((await w.get(w.author)).permissions.canReport).toBe(true);
    await w.call("reports.create", w.author, { target, reason: "Rude" });
    await w.call("permissions.set", w.admin, {
      userId: w.authorId,
      entries: [{ permission: "report.create", value: "never" }],
    });
    expect((await w.get(w.author)).permissions.canReport).toBe(false);
    await expect(
      w.call("reports.create", w.author, { target, reason: "Rude" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("canRemoveCover is true for the author of a visible thread and for those who edit any thread, as the write allows", async () => {
    const w = await world();
    const flags = async () => ({
      guest: (await w.get(GUEST)).permissions.canRemoveCover,
      author: (await w.get(w.author)).permissions.canRemoveCover,
      other: (await w.get(w.other)).permissions.canRemoveCover,
      moderator: (await w.get(w.moderator)).permissions.canRemoveCover,
    });
    expect(await flags()).toEqual({ guest: false, author: true, other: false, moderator: true });
    const allowed = async (actor: object) =>
      w.call("threads.removeCover", actor, { threadId: w.threadId }).then(
        () => true,
        (error) => {
          expect(error).toBeInstanceOf(ForbiddenError);
          return false;
        },
      );
    expect(await allowed(w.author)).toBe(true);
    expect(await allowed(w.other)).toBe(false);
    expect(await allowed(w.moderator)).toBe(true);
    // Hidden from its author, the thread no longer offers them the removal.
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(w.threadId);
    expect((await w.get(w.author)).permissions.canRemoveCover).toBe(false);
    expect((await w.get(w.moderator)).permissions.canRemoveCover).toBe(true);
    expect(await allowed(w.author)).toBe(false);
  });

  test("canWatch is true for a signed-in viewer and matches threads.watch", async () => {
    const w = await world();
    expect((await w.get(GUEST)).permissions.canWatch).toBe(false);
    await expect(w.call("threads.watch", GUEST, { threadId: w.threadId })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect((await w.get(w.other)).permissions.canWatch).toBe(true);
    await w.call("threads.watch", w.other, { threadId: w.threadId });
  });
});

describe("posts: canReport", () => {
  test("is on every post of a page and of a single read, and follows report.create", async () => {
    const w = await world();
    const list = async (actor: object) =>
      (await w.call("posts.list", actor, { threadId: w.threadId })).items.map(
        (post: { canReport: boolean }) => post.canReport,
      );
    expect(await list(GUEST)).toEqual([false, false]);
    expect(await list(w.other)).toEqual([true, true]);
    expect((await w.call("posts.get", w.other, { postId: w.reply.id })).canReport).toBe(true);
    expect((await w.call("posts.get", GUEST, { postId: w.reply.id })).canReport).toBe(false);
    await w.call("permissions.set", w.admin, {
      userId: w.otherId,
      entries: [{ permission: "report.create", value: "never" }],
    });
    expect(await list(w.other)).toEqual([false, false]);
    expect((await w.call("posts.get", w.other, { postId: w.reply.id })).canReport).toBe(false);
  });
});

describe("nodes.get: watching", () => {
  test("is null for a guest, for a non-watcher and for a category, and carries mode and email", async () => {
    const w = await world();
    const watching = async (actor: object, nodeId = w.forum.id) =>
      (await w.call("nodes.get", actor, { nodeId })).watching;
    expect(await watching(GUEST)).toBeNull();
    expect(await watching(w.other)).toBeNull();
    await w.call("nodes.watch", w.other, { nodeId: w.forum.id, mode: "posts", email: true });
    expect(await watching(w.other)).toEqual({ mode: "posts", email: true });
    await w.call("nodes.watch", w.other, { nodeId: w.forum.id });
    expect(await watching(w.other)).toEqual({ mode: "threads", email: false });
    expect(await watching(w.author)).toBeNull();
    expect(await watching(w.other, w.category.id)).toBeNull();
    await w.call("nodes.unwatch", w.other, { nodeId: w.forum.id });
    expect(await watching(w.other)).toBeNull();
  });

  test("costs one indexed lookup for a signed-in viewer of a forum and none otherwise", async () => {
    const w = await world();
    const lookup = /FROM node_watches/;
    await w.call("nodes.get", w.other, { nodeId: w.forum.id });
    const cost = async (actor: object, nodeId: number) => {
      w.trace.sql.length = 0;
      await w.call("nodes.get", actor, { nodeId });
      return w.trace.count(lookup);
    };
    expect(await cost(GUEST, w.forum.id)).toBe(0);
    expect(await cost(w.other, w.category.id)).toBe(0);
    expect(await cost(w.other, w.forum.id)).toBe(1);
    const sql = "SELECT mode, email FROM node_watches WHERE node_id = ?1 AND user_id = ?2";
    expectNoTableScan(w.ctx, sql, [w.forum.id, 1]);
    expect(plan(w.ctx, sql, [w.forum.id, 1])).toContain("node_watches_node_user");
  });
});
