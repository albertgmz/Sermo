import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { NotFoundError, UnauthenticatedError } from "../../errors";
import { fillPosts, fillThreads, type World, world } from "../feed/fixtures.test";
import { runHourlyTasks } from "../jobs/scheduler";
import { readMarkSql } from "./read-marks";

type Actor = Parameters<World["call"]>[1];
// biome-ignore lint/suspicious/noExplicitAny: operation outputs are checked field by field
type Row = Record<string, any>;

const unreadTitles = async (w: World, actor: Actor, nodeId: number) =>
  (
    ((await w.call("threads.list", actor, { nodeId, limit: 50 })).items as Row[]).filter(
      (thread) => thread.isUnread,
    ) as Row[]
  )
    .map((thread) => thread.title as string)
    .sort();
const feedUnread = async (w: World, actor: Actor) =>
  ((await w.call("feed.list", actor, { limit: 100, unread: true })).items as Row[])
    .map((item) => item.thread.title as string)
    .sort();

async function scene() {
  const w = world();
  const sub = insertNode(w.ctx, { parentId: w.open.id, title: "Sub" });
  const other = insertNode(w.ctx, { parentId: w.category.id, title: "Other" });
  invalidate(w.ctx, "node_tree");
  await w.thread(w.bob, w.open.id, "A");
  await w.thread(w.bob, w.open.id, "B");
  await w.thread(w.bob, sub.id, "S");
  await w.thread(w.bob, other.id, "O");
  return { w, sub, other };
}

describe("nodes.markRead", () => {
  test("marks every thread of the forum read for the viewer alone, with one row and no per-thread write", async () => {
    const { w } = await scene();
    expect(await unreadTitles(w, w.carol, w.open.id)).toEqual(["A", "B"]);
    w.ctx.clock.advance(60_000);
    const rows = () =>
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM thread_reads").get()!.n;
    const before = rows();
    const result = await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    expect(rows()).toBe(before);
    expect(result.forums).toBe(2);
    expect(await unreadTitles(w, w.carol, w.open.id)).toEqual([]);
    expect((await w.call("threads.list", w.carol, { nodeId: w.open.id })).items[0].isUnread).toBe(
      false,
    );
    // Another member still has them unread, and so has the member in a forum not marked.
    expect(await unreadTitles(w, w.alice, w.open.id)).toEqual(["A", "B"]);
    expect(await unreadTitles(w, w.carol, (await scene2(w)).id)).toEqual(["O2"]);
  });

  test("a later post makes the thread unread again, and only that thread", async () => {
    const { w } = await scene();
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    const list = (await w.call("threads.list", w.carol, { nodeId: w.open.id })).items as Row[];
    const a = list.find((thread) => thread.title === "A")!;
    await w.reply(w.bob, a.id, "again");
    expect(await unreadTitles(w, w.carol, w.open.id)).toEqual(["A"]);
    // Opening it clears it as before.
    await w.call("threads.markRead", w.carol, { threadId: a.id, position: 1 });
    expect(await unreadTitles(w, w.carol, w.open.id)).toEqual([]);
  });

  test("a category marks the forums under it; the feed's unread filter follows", async () => {
    const { w, sub, other } = await scene();
    expect(await feedUnread(w, w.carol)).toEqual(["A", "B", "O", "S"]);
    const result = await w.call("nodes.markRead", w.carol, { nodeId: w.category.id });
    expect(result.forums).toBe(3);
    expect(await feedUnread(w, w.carol)).toEqual([]);
    expect(await unreadTitles(w, w.carol, sub.id)).toEqual([]);
    expect(await unreadTitles(w, w.carol, other.id)).toEqual([]);
  });

  test("a forum marks its subforums but not its siblings", async () => {
    const { w, sub, other } = await scene();
    const result = await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    expect(result.forums).toBe(2);
    expect(await unreadTitles(w, w.carol, sub.id)).toEqual([]);
    expect(await unreadTitles(w, w.carol, other.id)).toEqual(["O"]);
  });

  test("marking again never moves the marker back, and forums the viewer cannot open are skipped", async () => {
    const { w } = await scene();
    await w.thread(w.mod, w.secret.id, "Hidden");
    w.ctx.clock.advance(60_000);
    const result = await w.call("nodes.markRead", w.carol, { nodeId: w.category.id });
    // The open forum, its subforum and the sibling: the secret forum is not carol's to see.
    expect(result.forums).toBe(3);
    const marked = (userId: number) =>
      w.ctx.sqlite
        .prepare<{ node_id: number }, [number]>("SELECT node_id FROM node_reads WHERE user_id = ?1")
        .all(userId)
        .map((row) => row.node_id);
    expect(marked(w.carolUser.id)).not.toContain(w.secret.id);
    const at = w.ctx.sqlite
      .prepare<{ read_at: number }, [number, number]>(
        "SELECT read_at FROM node_reads WHERE user_id = ?1 AND node_id = ?2",
      )
      .get(w.carolUser.id, w.open.id)!.read_at;
    w.ctx.clock.set(at - 5_000);
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    expect(
      w.ctx.sqlite
        .prepare<{ read_at: number }, [number, number]>(
          "SELECT read_at FROM node_reads WHERE user_id = ?1 AND node_id = ?2",
        )
        .get(w.carolUser.id, w.open.id)!.read_at,
    ).toBe(at);
  });

  test("refuses a guest before reading the input, and a forum the viewer cannot see is not found", async () => {
    const { w } = await scene();
    await expect(w.call("nodes.markRead", GUEST, { nodeId: w.open.id })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(w.call("nodes.markRead", GUEST, {})).rejects.toThrow(UnauthenticatedError);
    await expect(w.call("nodes.markAllRead", GUEST, {})).rejects.toThrow(UnauthenticatedError);
    await expect(w.call("nodes.markRead", w.carol, { nodeId: w.secret.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(w.call("nodes.markRead", w.carol, { nodeId: 99999 })).rejects.toThrow(
      NotFoundError,
    );
    // The staff member who can see it may mark it.
    expect((await w.call("nodes.markRead", w.admin, { nodeId: w.secret.id })).forums).toBe(1);
  });
});

describe("nodes.markAllRead", () => {
  test("marks every forum the viewer can see", async () => {
    const { w, sub, other } = await scene();
    await w.thread(w.mod, w.secret.id, "Hidden");
    const result = await w.call("nodes.markAllRead", w.carol, {});
    expect(result.forums).toBe(3);
    expect(await feedUnread(w, w.carol)).toEqual([]);
    for (const id of [w.open.id, sub.id, other.id])
      expect(await unreadTitles(w, w.carol, id)).toEqual([]);
    expect(await unreadTitles(w, w.admin, w.secret.id)).toEqual(["Hidden"]);
  });
});

describe("what a marker is read against", () => {
  test("locateUnread skips the posts made before the marker and lands on the first made after it", async () => {
    const { w } = await scene();
    const a = ((await w.call("threads.list", w.carol, { nodeId: w.open.id })).items as Row[]).find(
      (thread) => thread.title === "A",
    )!;
    await w.reply(w.bob, a.id, "second");
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    const third = await w.reply(w.bob, a.id, "third");
    expect(await w.call("threads.locateUnread", w.carol, { threadId: a.id })).toMatchObject({
      postId: third.id,
      position: 2,
    });
    // A member who never marked starts at the first post.
    expect(await w.call("threads.locateUnread", w.alice, { threadId: a.id })).toMatchObject({
      position: 0,
    });
  });

  test("a feed card counts only the posts made after the marker", async () => {
    const { w } = await scene();
    const a = ((await w.call("threads.list", w.carol, { nodeId: w.open.id })).items as Row[]).find(
      (thread) => thread.title === "A",
    )!;
    await w.reply(w.bob, a.id, "second");
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    await w.reply(w.bob, a.id, "third");
    const items = (await w.call("feed.list", w.carol, { limit: 100 })).items as Row[];
    const card = items.find((item) => item.thread.title === "A")!;
    expect(card.unread).toMatchObject({ count: 1, firstPosition: 2 });
  });

  test("a long thread read only through the marker is found by one seek, and the card counts what came after", async () => {
    const { w } = await scene();
    const a = ((await w.call("threads.list", w.carol, { nodeId: w.open.id })).items as Row[]).find(
      (thread) => thread.title === "A",
    )!;
    fillPosts(w.ctx, a.id, w.bobUser.id, 2000);
    w.ctx.clock.advance(60_000);
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    w.ctx.clock.advance(60_000);
    const first = await w.reply(w.bob, a.id, "after the mark");
    await w.reply(w.bob, a.id, "and another");
    const plan = (sql: string, ...params: (number | string)[]) =>
      w.ctx.sqlite
        .prepare<{ detail: string }, (number | string)[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((row) => row.detail)
        .join("\n");
    expect(plan(readMarkSql.after, a.id, 1)).toContain("USING INDEX posts_thread_created");
    expect(await w.call("threads.locateUnread", w.carol, { threadId: a.id })).toMatchObject({
      postId: first.id,
      position: 2001,
    });
    const card = ((await w.call("feed.list", w.carol, { limit: 100 })).items as Row[]).find(
      (item) => item.thread.title === "A",
    )!;
    expect(card.unread).toMatchObject({ count: 2, firstPosition: 2001 });
  });

  test("the lookups hit their indexes", async () => {
    const { w } = await scene();
    expectNoTableScan(w.ctx, readMarkSql.after, [1, 1]);
    expectNoTableScan(w.ctx, readMarkSql.marks, [1, JSON.stringify([1, 2])]);
    expectNoTableScan(w.ctx, readMarkSql.mark, [1, JSON.stringify([1, 2]), 1]);
    expectNoTableScan(w.ctx, readMarkSql.expire, [1]);
  });

  test("a forum of many threads is marked with one write", async () => {
    const { w } = await scene();
    fillThreads(w.ctx, w.open.id, w.bobUser.id, 500);
    const before = (
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get() as { n: number }
    ).n;
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    const after = (
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get() as { n: number }
    ).n;
    // The marker rows of the forum and its subforum, and nothing for the 500 threads.
    expect(after - before).toBeLessThan(10);
    expect(await unreadTitles(w, w.carol, w.open.id)).toEqual([]);
  });
});

describe("expiry", () => {
  test("the hourly task removes markers past the 30 days after which every thread counts as read", async () => {
    const { w } = await scene();
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    const count = () =>
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM node_reads").get()!.n;
    expect(count()).toBe(2);
    await runHourlyTasks(w.ctx, () => ({ sessions: 0, apiKeys: 0, verifications: 0 }));
    expect(count()).toBe(2);
    w.ctx.clock.advance(31 * 86_400_000);
    await runHourlyTasks(w.ctx, () => ({ sessions: 0, apiKeys: 0, verifications: 0 }));
    expect(count()).toBe(0);
  });
});

/** A forum of its own with one thread nobody has marked. */
async function scene2(w: World) {
  const forum = insertNode(w.ctx, { parentId: w.category.id, title: "Fresh" });
  invalidate(w.ctx, "node_tree");
  await w.thread(w.bob, forum.id, "O2");
  return forum;
}
