import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { FEED_UNREAD_CAP } from "../../contracts/feed";
import { writeTx } from "../../db/tx";
import { currentActor } from "../../permissions";
import { setEntry } from "../permissions/group-fixture";
import { countStatements, fillPosts, type World, world } from "./fixtures.test";
import { unreadSql } from "./unread";

// biome-ignore lint/suspicious/noExplicitAny: feed items are checked field by field below
type Item = Record<string, any>;
type Actor = Parameters<World["call"]>[1];

const items = async (w: World, actor: Actor, input: object = {}) =>
  (await w.call("feed.list", actor, { limit: 50, ...input })).items as Item[];
const unreadOf = async (w: World, actor: Actor, title: string) =>
  (await items(w, actor)).find((item) => item.thread?.title === title)?.unread;
const postAt = (w: World, threadId: number, position: number) =>
  w.ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "SELECT id FROM posts WHERE thread_id = ?1 AND position = ?2",
    )
    .get(threadId, position)!;

/** A thread of bob's with `replies` replies by alice, in the open forum. */
async function busy(w: World, title: string, replies: number) {
  const { thread } = await w.thread(w.bob, w.open.id, title);
  for (let i = 0; i < replies; i++) await w.reply(w.alice, thread.id, `${title} reply ${i}`);
  return thread.id as number;
}

describe("feed.list unread", () => {
  test("a member who never read the thread has all of it unread, and a guest has no count", async () => {
    const w = world();
    const id = await busy(w, "Fresh", 3);
    expect(await unreadOf(w, w.carol, "Fresh")).toEqual({
      count: 4,
      more: false,
      firstPostId: postAt(w, id, 0).id,
      firstPosition: 0,
    });
    expect(await unreadOf(w, GUEST, "Fresh")).toBeNull();
  });

  test("reading moves the first unread post and shrinks the count; reading all clears it", async () => {
    const w = world();
    const id = await busy(w, "Read me", 4);
    await w.call("threads.markRead", w.carol, { threadId: id, position: 1 });
    expect(await unreadOf(w, w.carol, "Read me")).toEqual({
      count: 3,
      more: false,
      firstPostId: postAt(w, id, 2).id,
      firstPosition: 2,
    });
    // Someone else's read state does not show.
    // (bob wrote the opening post, which counts as read to him.)
    expect((await unreadOf(w, w.bob, "Read me"))?.count).toBe(4);
    await w.call("threads.markRead", w.carol, { threadId: id, position: 4 });
    expect(await unreadOf(w, w.carol, "Read me")).toBeNull();
    // A new reply is the one unread post.
    await w.reply(w.alice, id, "again");
    expect(await unreadOf(w, w.carol, "Read me")).toMatchObject({ count: 1, firstPosition: 5 });
  });

  test("hidden posts are not counted and the first unread skips them", async () => {
    const w = world();
    const id = await busy(w, "Pruned", 3);
    await w.call("threads.markRead", w.carol, { threadId: id, position: 0 });
    w.ctx.sqlite
      .prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1")
      .run(postAt(w, id, 1).id);
    expect(await unreadOf(w, w.carol, "Pruned")).toMatchObject({ count: 2, firstPosition: 2 });
  });

  test("the count stops at 99 and says there are more", async () => {
    const w = world();
    const id = await busy(w, "Long", 1);
    fillPosts(w.ctx, id, w.aliceUser.id, 150);
    expect(await unreadOf(w, w.carol, "Long")).toMatchObject({
      count: FEED_UNREAD_CAP,
      more: true,
      firstPosition: 0,
    });
  });

  test("a thread older than the unread window has none", async () => {
    const w = world();
    await busy(w, "Old", 2);
    w.ctx.clock.advance(31 * 86_400_000);
    expect(await unreadOf(w, w.carol, "Old")).toBeNull();
  });

  test("posts of an ignored member count where the thread shows them, but a thread they ended is not listed", async () => {
    const w = world();
    const mixed = await busy(w, "Mixed", 2);
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    // The opening post is bob's, the replies alice's: the thread is listed and all three count.
    expect((await unreadOf(w, w.carol, "Mixed"))?.count).toBe(3);
    await w.reply(w.bob, mixed, "bob last");
    expect((await items(w, w.carol)).some((item) => item.thread?.title === "Mixed")).toBe(false);
  });

  test("a forum open for titles only gives no count and no position to anyone who may not read it", async () => {
    const w = world();
    const id = await busy(w, "Closed", 1);
    // Carol's own reply ends the thread, so it is listed even where text is closed to her; her
    // read mark is dropped so that it is unread for her.
    await w.reply(w.carol, id, "carol last");
    w.ctx.sqlite.prepare("DELETE FROM thread_reads WHERE thread_id = ?1").run(id);
    expect((await unreadOf(w, w.carol, "Closed"))?.count).toBe(3);
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    const closed = (await items(w, w.carol)).find((item) => item.thread?.title === "Closed");
    expect(closed?.thread.isUnread).toBe(true);
    expect(closed?.unread).toBeNull();
    // Staff read it.
    expect((await unreadOf(w, w.mod, "Closed"))?.count).toBe(3);
  });

  test("a wall post carries no unread", async () => {
    const w = world();
    await w.wall(w.alice, w.bobUser.id, "hello");
    const [wall] = await items(w, w.carol);
    expect(wall?.type).toBe("profilePost");
    expect(wall).not.toHaveProperty("unread");
  });

  test("the following tab carries it too", async () => {
    const w = world();
    const id = await busy(w, "Followed", 3);
    await w.call("users.follow", w.carol, { userId: w.aliceUser.id });
    const following = await items(w, w.carol, { scope: "following" });
    expect(following.find((item) => item.thread?.id === id)?.unread?.count).toBe(4);
  });

  test("a page of unread threads runs as many statements as one thread", async () => {
    const one = world();
    const many = world();
    await busy(one, "T", 2);
    for (let i = 0; i < 10; i++) await busy(many, `T${i}`, 2);
    // As a request's actor arrives: the principal is already resolved, so checks run no query.
    const read = (w: World) => {
      const viewer = writeTx(w.ctx, () => currentActor(w.ctx, w.carol));
      return () => w.call("feed.list", viewer, { limit: 10 });
    };
    const withOne = await countStatements(one.ctx, read(one));
    const withMany = await countStatements(many.ctx, read(many));
    expect((await read(many)()).items.filter((item: Item) => item.unread)).toHaveLength(10);
    expect(withMany).toBe(withOne);
  });

  test("the statement reads indexes only", () => {
    const w = world();
    expectNoTableScan(w.ctx, unreadSql.firstUnread, ["[1,2]", 1, FEED_UNREAD_CAP + 1]);
  });
});

describe("the poll badge", () => {
  test("a thread with a poll or a quiz says so in the feed and the lists", async () => {
    const w = world();
    const created = async (title: string, poll: object) =>
      (await w.call("threads.create", w.bob, { nodeId: w.open.id, title, body: "body", poll }))
        .thread.id as number;
    await created("Poll", {
      questions: [{ text: "Best?", answers: [{ text: "A" }, { text: "B" }] }],
    });
    await created("Quiz", {
      kind: "quiz",
      questions: [
        { text: "Two?", explanation: "", answers: [{ text: "2", correct: true }, { text: "3" }] },
      ],
    });
    await w.thread(w.bob, w.open.id, "Plain");
    const kinds = async (actor: Actor) =>
      Object.fromEntries(
        (await items(w, actor)).map((item) => [item.thread.title, item.thread.pollKind]),
      );
    expect(await kinds(w.carol)).toEqual({ Poll: "poll", Quiz: "quiz", Plain: null });
    expect(await kinds(GUEST)).toEqual({ Poll: "poll", Quiz: "quiz", Plain: null });
    const listed = await w.call("threads.list", w.carol, { nodeId: w.open.id });
    expect(listed.items.map((thread: Item) => thread.pollKind).sort()).toEqual([
      null,
      "poll",
      "quiz",
    ]);
    // Titles only: the poll is a part of the opening post, which is closed.
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    const titles = await w.call("threads.list", w.carol, { nodeId: w.open.id });
    expect(titles.items.map((thread: Item) => thread.pollKind)).toEqual([null, null, null]);
    expect(await kinds(w.mod)).toEqual({ Poll: "poll", Quiz: "quiz", Plain: null });
  });

  test("a poll being removed in batches shows no badge", async () => {
    const w = world();
    const { thread } = await w.call("threads.create", w.bob, {
      nodeId: w.open.id,
      title: "Going",
      body: "body",
      poll: { questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }] },
    });
    w.ctx.sqlite.prepare("UPDATE polls SET max_choices = 0 WHERE thread_id = ?1").run(thread.id);
    expect((await items(w, w.carol))[0]?.thread.pollKind).toBeNull();
  });

  test("a page of threads with polls runs as many statements as a page without", async () => {
    const plain = world();
    const polls = world();
    for (let i = 0; i < 8; i++) {
      await plain.thread(plain.bob, plain.open.id, `P${i}`);
      polls.ctx.clock.advance(60_000);
      await polls.call("threads.create", polls.bob, {
        nodeId: polls.open.id,
        title: `P${i}`,
        body: "body",
        poll: { questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }] },
      });
    }
    const read = (w: World) => {
      const viewer = writeTx(w.ctx, () => currentActor(w.ctx, w.carol));
      return () => w.call("feed.list", viewer, { limit: 8 });
    };
    expect(await countStatements(polls.ctx, read(polls))).toBe(
      await countStatements(plain.ctx, read(plain)),
    );
  });
});
