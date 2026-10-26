import { describe, expect, test } from "bun:test";
import { insertUser, tokenActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { UnauthenticatedError, ValidationError } from "../../errors";
import { fillThreads, type World, world } from "./fixtures.test";

const EPOCH = new Date(0).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();

const count = async (
  w: World,
  actor: Parameters<World["call"]>[1],
  since: string,
  scope?: "latest" | "following",
) =>
  (await w.call("feed.newCount", actor, { since, ...(scope ? { scope } : {}) })) as {
    count: number;
    more: boolean;
  };

/** The `createdAt` of the newest entry the viewer's feed shows: what a polling client sends. */
const newest = async (w: World, actor: Parameters<World["call"]>[1], scope = "latest") =>
  (await w.call("feed.list", actor, { scope, limit: 1 })).items[0].createdAt as string;

/** How many entries `feed.list` puts above `since`: what the count must agree with. */
const listedAbove = async (
  w: World,
  actor: Parameters<World["call"]>[1],
  since: string,
  scope = "latest",
) =>
  (await w.call("feed.list", actor, { scope, limit: 100 })).items.filter(
    (item: { createdAt: string }) => item.createdAt > since,
  ).length;

describe("feed.newCount latest", () => {
  test("is zero while nothing new happened, and counts threads, replies and wall posts after", async () => {
    const w = world();
    const first = await w.thread(w.alice, w.open.id, "First");
    await w.thread(w.bob, w.open.id, "Second");
    const since = await newest(w, w.carol);
    expect(await count(w, w.carol, since)).toEqual({ count: 0, more: false });
    expect(await count(w, GUEST, since)).toEqual({ count: 0, more: false });

    await w.thread(w.carol, w.open.id, "Third");
    expect(await count(w, w.carol, since)).toEqual({ count: 1, more: false });
    // Two replies to an older thread move it to the top once: it is one entry.
    await w.reply(w.bob, first.thread.id, "bump");
    await w.reply(w.alice, first.thread.id, "bump again");
    await w.wall(w.bob, w.carolUser.id, "hello");
    expect(await count(w, w.carol, since)).toEqual({ count: 3, more: false });
    expect((await count(w, GUEST, since)).count).toBe(await listedAbove(w, GUEST, since));
    // The newest entry is not new to someone who holds it.
    expect(await count(w, w.carol, await newest(w, w.carol))).toEqual({ count: 0, more: false });
    // Nothing is held: everything is new.
    expect((await count(w, w.carol, EPOCH)).count).toBe(
      (await w.call("feed.list", w.carol, {})).items.length,
    );
  });

  test("agrees with what feed.list lists above the same time", async () => {
    const w = world();
    const older = await w.thread(w.alice, w.open.id, "Older");
    await w.thread(w.bob, w.open.id, "Held");
    const since = await newest(w, w.carol);
    await w.reply(w.bob, older.thread.id, "r1");
    await w.wall(w.alice, w.bobUser.id, "w1");
    await w.thread(w.alice, w.open.id, "Another");
    await w.thread(w.admin, w.secret.id, "Secret");
    await w.call("users.block", w.carol, { userId: w.aliceUser.id });
    for (const actor of [w.carol, w.bob, w.alice, w.admin, GUEST])
      expect((await count(w, actor, since)).count).toBe(await listedAbove(w, actor, since));
  });

  test("leaves out what the viewer may not see: hidden forums, hidden threads and posts, ignored members", async () => {
    const w = world();
    const open = await w.thread(w.alice, w.open.id, "Open");
    const since = await newest(w, w.carol);

    await w.thread(w.admin, w.secret.id, "Secret");
    expect((await count(w, w.carol, since)).count).toBe(0);
    expect((await count(w, GUEST, since)).count).toBe(0);
    expect((await count(w, w.admin, since)).count).toBe(1);

    // Awaiting approval: not counted, for its author either, until it is approved.
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const waiting = await w.reply(w.bob, open.thread.id, "waiting");
    expect(waiting.state).toBe("moderated");
    expect((await count(w, w.bob, since)).count).toBe(0);
    expect((await count(w, w.carol, since)).count).toBe(0);
    await w.call("posts.restore", w.mod, { postId: waiting.id });
    expect((await count(w, w.carol, since)).count).toBe(1);
    // A removed thread is not counted.
    const doomed = await w.thread(w.bob, w.open.id, "Doomed");
    expect((await count(w, w.carol, since)).count).toBe(2);
    await w.call("threads.delete", w.mod, {
      threadId: doomed.thread.id,
      reason: "x",
      notify: false,
    });
    expect((await count(w, w.carol, since)).count).toBe(1);

    // A thread an ignored member started does not count; one they only replied to still does.
    await w.call("users.block", w.carol, { userId: w.bobUser.id });
    expect((await count(w, w.carol, since)).count).toBe(1);
    await w.thread(w.bob, w.open.id, "Bobs");
    expect((await count(w, w.carol, since)).count).toBe(1);
    expect((await count(w, w.alice, since)).count).toBe(2);
  });

  test("a wall the viewer may not open does not count", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Anchor");
    const since = await newest(w, w.carol);
    await w.wall(w.bob, w.aliceUser.id, "private wall");
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.aliceUser.id);
    expect((await count(w, w.carol, since)).count).toBe(0);
    expect((await count(w, w.alice, since)).count).toBe(1);
    expect((await count(w, w.admin, since)).count).toBe(1);
  });

  test("stops at 99: more says there are others", async () => {
    const w = world();
    const since = iso(w.ctx.now());
    const author = insertUser(w.ctx).id;
    fillThreads(w.ctx, w.open.id, author, 99, { at: (i) => w.ctx.now() + 1000 + i });
    expect(await count(w, w.carol, since)).toEqual({ count: 99, more: false });
    fillThreads(w.ctx, w.open.id, author, 5, { at: (i) => w.ctx.now() + 5000 + i });
    expect(await count(w, w.carol, since)).toEqual({ count: 99, more: true });
    expect(await count(w, GUEST, since)).toEqual({ count: 99, more: true });
  });

  test("an API-key actor counts what its member would", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Anchor");
    const since = await newest(w, w.carol);
    await w.thread(w.bob, w.open.id, "New");
    expect((await count(w, tokenActor(w.carolUser), since)).count).toBe(1);
  });

  test("a time that is not an ISO timestamp, or any scope but latest and following, is refused", async () => {
    const w = world();
    for (const input of [
      { since: "yesterday" },
      { since: 12345 },
      {},
      { since: EPOCH, scope: "hot" },
      { since: EPOCH, scope: "top" },
    ])
      await expect(w.call("feed.newCount", w.carol, input)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("feed.newCount following", () => {
  test("needs an account; counts only the members the viewer follows", async () => {
    const w = world();
    await expect(count(w, GUEST, EPOCH, "following")).rejects.toBeInstanceOf(UnauthenticatedError);
    await w.call("users.follow", w.carol, { userId: w.aliceUser.id });
    const base = await w.thread(w.alice, w.open.id, "Alices");
    await w.thread(w.bob, w.open.id, "Bobs");
    const since = await newest(w, w.carol, "following");
    expect(await count(w, w.carol, since, "following")).toEqual({ count: 0, more: false });
    // A member who follows nobody has nothing to count.
    expect(await count(w, w.bob, EPOCH, "following")).toEqual({ count: 0, more: false });

    await w.thread(w.bob, w.open.id, "Bobs again");
    expect((await count(w, w.carol, since, "following")).count).toBe(0);
    await w.reply(w.alice, base.thread.id, "alice replies");
    await w.thread(w.alice, w.open.id, "alice again");
    expect(await count(w, w.carol, since, "following")).toEqual({ count: 2, more: false });
    expect((await count(w, w.carol, since)).count).toBe(await listedAbove(w, w.carol, since));
  });

  test("agrees with feed.list, and leaves out hidden forums and ignored members", async () => {
    const w = world();
    await w.call("users.follow", w.carol, { userId: actorUserId(w.admin)! });
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    await w.thread(w.bob, w.open.id, "Anchor");
    const since = await newest(w, w.carol, "following");
    await w.thread(w.admin, w.open.id, "Admin, open");
    await w.thread(w.bob, w.open.id, "Bob, open");
    await w.thread(w.admin, w.secret.id, "Admin, hidden from carol");
    expect(await count(w, w.carol, since, "following")).toEqual({ count: 2, more: false });
    expect(await listedAbove(w, w.carol, since, "following")).toBe(2);
    await w.call("users.block", w.carol, { userId: w.bobUser.id });
    expect(await count(w, w.carol, since, "following")).toEqual({ count: 1, more: false });
    expect(await listedAbove(w, w.carol, since, "following")).toBe(1);
  });
});
