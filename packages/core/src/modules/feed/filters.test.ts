import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { FEED_FILTER_LIMIT, FEED_HIDDEN_LIMIT } from "../../contracts/feed";
import { ConflictError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { customMember, setEntry } from "../permissions/group-fixture";
import { filterSql } from "./filter";
import { countStatements, fillThreads, type World, world } from "./fixtures.test";
import { refreshRankings } from "./rankings";
import { savedSql } from "./saved";

// biome-ignore lint/suspicious/noExplicitAny: feed items are checked field by field below
type Item = Record<string, any>;
type Actor = Parameters<World["call"]>[1];

const titleOf = (item: Item) => (item.type === "profilePost" ? "wall" : item.thread.title);
const feed = async (w: World, actor: Actor, input: object = {}) =>
  ((await w.call("feed.list", actor, { limit: 100, ...input })).items as Item[]).map(titleOf);

/** Every page of a listing with small pages, in order. */
async function paged(w: World, actor: Actor, input: object, limit = 3) {
  const titles: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 80; guard++) {
    const page = await w.call("feed.list", actor, {
      ...input,
      limit,
      ...(cursor ? { cursor } : {}),
    });
    titles.push(...(page.items as Item[]).map(titleOf));
    if (page.nextCursor === null) return titles;
    cursor = page.nextCursor;
  }
  throw new Error("the feed never ended");
}

/** A world with a second forum, a subforum of the open one, and a prefix. */
async function scene() {
  const w = world();
  const other = insertNode(w.ctx, { parentId: w.category.id });
  const sub = insertNode(w.ctx, { parentId: w.open.id });
  invalidate(w.ctx, "node_tree");
  const prefix = await w.call("threadPrefixes.create", w.admin, {
    label: "Solved",
    colorId: w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM palette_colors WHERE kind = 'prefix' AND is_active = 1 ORDER BY position LIMIT 1",
      )
      .get()!.id,
  });
  return { w, other, sub, prefix };
}

const thread = (w: World, actor: Actor, nodeId: number, title: string, extra: object = {}) => {
  w.ctx.clock.advance(60_000);
  return w.call("threads.create", actor, { nodeId, title, body: `${title} body`, ...extra });
};

describe("feed filters: forum, prefix, type, tag", () => {
  test("a forum filter takes the forum and the forums under it", async () => {
    const { w, other, sub } = await scene();
    await thread(w, w.alice, w.open.id, "In open");
    await thread(w, w.alice, other.id, "In other");
    await thread(w, w.bob, sub.id, "In sub");
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual(["In sub", "In open"]);
    expect(await feed(w, w.carol, { forumIds: [other.id] })).toEqual(["In other"]);
    expect(await feed(w, w.carol, { forumIds: [other.id, sub.id] })).toEqual([
      "In sub",
      "In other",
    ]);
    expect(await feed(w, w.carol, { forumIds: [w.category.id] })).toEqual([
      "In sub",
      "In other",
      "In open",
    ]);
    expect(await feed(w, w.carol)).toEqual(["In sub", "In other", "In open"]);
  });

  test("naming a forum the viewer cannot see lists nothing, staff see it", async () => {
    const { w } = await scene();
    await thread(w, w.admin, w.secret.id, "Secret one");
    await thread(w, w.alice, w.open.id, "Open one");
    for (const viewer of [w.alice, GUEST])
      expect(await feed(w, viewer, { forumIds: [w.secret.id] })).toEqual([]);
    expect(await feed(w, w.alice, { forumIds: [w.secret.id, w.open.id] })).toEqual(["Open one"]);
    expect(await feed(w, w.admin, { forumIds: [w.secret.id] })).toEqual(["Secret one"]);
  });

  test("a prefix filter lists the threads that carry it, across forums", async () => {
    const { w, other, prefix } = await scene();
    await thread(w, w.alice, w.open.id, "Plain");
    await thread(w, w.alice, w.open.id, "Marked open", { prefixId: prefix.id });
    await thread(w, w.bob, other.id, "Marked other", { prefixId: prefix.id });
    expect(await feed(w, w.carol, { prefixId: prefix.id })).toEqual([
      "Marked other",
      "Marked open",
    ]);
    expect(await feed(w, w.carol, { prefixId: prefix.id, forumIds: [other.id] })).toEqual([
      "Marked other",
    ]);
    expect(await feed(w, w.carol, { prefixId: 9999 })).toEqual([]);
  });

  test("sticky, locked and featured threads", async () => {
    const { w, other } = await scene();
    const a = await thread(w, w.alice, w.open.id, "A");
    const b = await thread(w, w.alice, other.id, "B");
    await thread(w, w.alice, w.open.id, "C");
    await w.call("threads.setSticky", w.mod, {
      threadId: a.thread.id,
      isSticky: true,
      reason: "x",
      notify: false,
    });
    await w.call("threads.setLocked", w.mod, {
      threadId: b.thread.id,
      isLocked: true,
      reason: "x",
      notify: false,
    });
    await w.call("threads.setFeatured", w.mod, {
      threadId: b.thread.id,
      isFeatured: true,
      reason: "pick",
    });
    expect(await feed(w, w.carol, { type: "sticky" })).toEqual(["A"]);
    expect(await feed(w, w.carol, { type: "locked" })).toEqual(["B"]);
    expect(await feed(w, w.carol, { type: "featured" })).toEqual(["B"]);
    expect(await feed(w, w.carol, { type: "featured", forumIds: [w.open.id] })).toEqual([]);
    expect(await feed(w, w.carol, { type: "sticky", forumIds: [w.open.id] })).toEqual(["A"]);
    // A feature that has ended is no longer one.
    w.ctx.sqlite.prepare("UPDATE thread_features SET ends_at = ?1").run(w.ctx.now() - 1);
    expect(await feed(w, w.carol, { type: "featured" })).toEqual([]);
  });

  test("a tag filter follows the tag, its aliases and the thread's visibility", async () => {
    const { w, other } = await scene();
    await thread(w, w.alice, w.open.id, "Rusty", { tags: ["Rust"] });
    await thread(w, w.bob, other.id, "Zippy", { tags: ["zig"] });
    await thread(w, w.bob, other.id, "Both", { tags: ["rust", "zig"] });
    expect(await feed(w, w.carol, { tag: "#Rust" })).toEqual(["Both", "Rusty"]);
    expect(await feed(w, w.carol, { tag: "ZIG", forumIds: [other.id] })).toEqual(["Both", "Zippy"]);
    expect(await feed(w, w.carol, { tag: "nobody" })).toEqual([]);
    expect(await feed(w, w.carol, { tag: "not a tag!" })).toEqual([]);
    // A rename keeps the old name working.
    const tag = (await w.call("tags.list", w.admin, {})).items.find(
      (entry: { name: string }) => entry.name === "zig",
    );
    await w.call("tags.rename", w.admin, { tagId: tag.id, name: "zigzag" });
    expect(await feed(w, w.carol, { tag: "zig" })).toEqual(["Both", "Zippy"]);
    expect(await feed(w, w.carol, { tag: "zigzag" })).toEqual(["Both", "Zippy"]);
    // A deleted thread leaves the tag's listing.
    const gone = (await feed(w, w.carol, { tag: "rust" }))[1];
    expect(gone).toBe("Rusty");
    await w.call("threads.delete", w.mod, {
      threadId: (await w.call("threads.list", w.carol, { nodeId: w.open.id })).items[0].id,
      reason: "x",
      notify: false,
    });
    expect(await feed(w, w.carol, { tag: "rust" })).toEqual(["Both"]);
  });

  test("a tag the opening post's hashtags gave is closed to a viewer who may not read that text", async () => {
    const { w } = await scene();
    await thread(w, w.alice, w.open.id, "Hashed", { body: "About #quiet things" });
    await thread(w, w.alice, w.open.id, "Listed", { tags: ["quiet"] });
    await thread(w, w.alice, w.open.id, "Listed2", { tags: ["quiet"] });
    // Bob replies to two of them: his reply is then the newest post, which he may read.
    const id = async (title: string) =>
      (await w.call("threads.list", w.bob, { nodeId: w.open.id })).items.find(
        (item: { title: string }) => item.title === title,
      ).id;
    for (const title of ["Hashed", "Listed2"]) {
      w.ctx.clock.advance(60_000);
      await w.call("posts.create", w.bob, { threadId: await id(title), body: "Bob adds" });
    }
    expect(await feed(w, w.carol, { tag: "quiet" })).toEqual(["Listed2", "Hashed", "Listed"]);
    // Titles only for members: a thread opens in lists, its text does not.
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    expect(await feed(w, w.carol, { tag: "quiet" })).toEqual([]);
    // Bob reads his own replies, not the opening text that gave "Hashed" its tag: that thread
    // stays out, and "Listed2", whose tag was listed, does not need the text.
    expect(await feed(w, w.bob, { tag: "quiet" })).toEqual(["Listed2"]);
    // Alice reads her own posts only; staff read all.
    expect(await feed(w, w.alice, { tag: "quiet" })).toEqual(["Listed"]);
    expect(await feed(w, w.mod, { tag: "quiet" })).toEqual(["Listed2", "Hashed", "Listed"]);
  });
});

describe("feed filters: watched and unread", () => {
  test("watched lists the threads the viewer watches, and only an account may ask", async () => {
    const { w, other } = await scene();
    const a = await thread(w, w.bob, w.open.id, "A");
    await thread(w, w.bob, w.open.id, "B");
    const c = await thread(w, w.bob, other.id, "C");
    await w.call("threads.watch", w.carol, { threadId: a.thread.id, email: false });
    await w.call("threads.watch", w.carol, { threadId: c.thread.id, email: false });
    expect(await feed(w, w.carol, { watched: true })).toEqual(["C", "A"]);
    expect(await feed(w, w.carol, { watched: true, forumIds: [other.id] })).toEqual(["C"]);
    expect(await feed(w, w.bob, { watched: true })).toEqual([]);
    await expect(feed(w, GUEST, { watched: true })).rejects.toThrow(UnauthenticatedError);
    // `false` is off.
    expect(await feed(w, GUEST, { watched: false })).toEqual(["C", "B", "A"]);
  });

  test("a watched thread the viewer can no longer open stays out", async () => {
    const { w } = await scene();
    const a = await thread(w, w.bob, w.open.id, "A");
    await w.call("threads.watch", w.carol, { threadId: a.thread.id, email: false });
    await w.call("threads.delete", w.mod, { threadId: a.thread.id, reason: "x", notify: false });
    expect(await feed(w, w.carol, { watched: true })).toEqual([]);
  });

  test("unread lists threads with posts the viewer has not read, and reading takes one off", async () => {
    const { w, other } = await scene();
    const a = await thread(w, w.bob, w.open.id, "A");
    await thread(w, w.bob, other.id, "B");
    expect(await feed(w, w.carol, { unread: true })).toEqual(["B", "A"]);
    await w.call("threads.markRead", w.carol, { threadId: a.thread.id, position: 0 });
    expect(await feed(w, w.carol, { unread: true })).toEqual(["B"]);
    // A reply makes it unread again, for the viewer who had read it.
    w.ctx.clock.advance(60_000);
    await w.call("posts.create", w.bob, { threadId: a.thread.id, body: "more" });
    expect(await feed(w, w.carol, { unread: true })).toEqual(["A", "B"]);
    expect(await feed(w, w.carol, { unread: true, forumIds: [other.id] })).toEqual(["B"]);
    await expect(feed(w, GUEST, { unread: true })).rejects.toThrow(UnauthenticatedError);
  });

  test("a thread whose last post is over 30 days old counts as read", async () => {
    const { w } = await scene();
    await thread(w, w.bob, w.open.id, "Old");
    w.ctx.clock.advance(31 * 86_400_000);
    await thread(w, w.bob, w.open.id, "New");
    expect(await feed(w, w.carol, { unread: true })).toEqual(["New"]);
    // The same in the scopes that do not walk by activity: following, watched and hot.
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    expect(await feed(w, w.carol, { scope: "following", unread: true })).toEqual(["New"]);
    expect(await feed(w, w.carol, { scope: "following" })).toEqual(["New", "Old"]);
    const old = (await w.call("threads.list", w.bob, { nodeId: w.open.id })).items.find(
      (item: { title: string }) => item.title === "Old",
    );
    await w.call("threads.watch", w.carol, { threadId: old.id, email: false });
    expect(await feed(w, w.carol, { watched: true })).toEqual(["Old"]);
    expect(await feed(w, w.carol, { watched: true, unread: true })).toEqual([]);
  });

  test("unread works in the following scope and in hot", async () => {
    const { w } = await scene();
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    const a = await thread(w, w.bob, w.open.id, "A");
    await thread(w, w.bob, w.open.id, "B");
    await w.call("threads.markRead", w.carol, { threadId: a.thread.id, position: 0 });
    expect(await feed(w, w.carol, { scope: "following", unread: true })).toEqual(["B"]);
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 5").run();
    refreshRankings(w.ctx);
    expect((await feed(w, w.carol, { scope: "hot" })).sort()).toEqual(["A", "B"]);
    expect(await feed(w, w.carol, { scope: "hot", unread: true })).toEqual(["B"]);
  });
});

describe("feed filters: combinations and scopes", () => {
  test("every field must hold", async () => {
    const { w, other, prefix } = await scene();
    const a = await thread(w, w.bob, w.open.id, "A", { prefixId: prefix.id, tags: ["x"] });
    await thread(w, w.bob, w.open.id, "B", { prefixId: prefix.id });
    await thread(w, w.bob, other.id, "C", { prefixId: prefix.id, tags: ["x"] });
    await w.call("threads.watch", w.carol, { threadId: a.thread.id, email: false });
    const all = {
      forumIds: [w.open.id],
      prefixId: prefix.id,
      tag: "x",
      watched: true,
      unread: true,
    };
    expect(await feed(w, w.carol, all)).toEqual(["A"]);
    await w.call("threads.markRead", w.carol, { threadId: a.thread.id, position: 0 });
    expect(await feed(w, w.carol, all)).toEqual([]);
    expect(await feed(w, w.carol, { ...all, unread: false })).toEqual(["A"]);
    expect(
      await feed(w, w.carol, { ...all, forumIds: [other.id], watched: false, unread: false }),
    ).toEqual(["C"]);
  });

  test("wall posts leave the feed once a field is on", async () => {
    const { w } = await scene();
    await thread(w, w.bob, w.open.id, "A");
    await w.wall(w.bob, w.carolUser.id, "hello");
    expect(await feed(w, w.alice)).toEqual(["wall", "A"]);
    expect(await feed(w, w.alice, { forumIds: [w.open.id] })).toEqual(["A"]);
    expect(await feed(w, w.alice, { type: "sticky" })).toEqual([]);
  });

  test("the following scope takes the same fields", async () => {
    const { w, other, prefix } = await scene();
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    await thread(w, w.bob, w.open.id, "Mine", { prefixId: prefix.id });
    await thread(w, w.bob, other.id, "Other");
    await thread(w, w.alice, w.open.id, "Stranger", { prefixId: prefix.id });
    expect(await feed(w, w.carol, { scope: "following" })).toEqual(["Other", "Mine"]);
    expect(await feed(w, w.carol, { scope: "following", forumIds: [w.open.id] })).toEqual(["Mine"]);
    expect(await feed(w, w.carol, { scope: "following", prefixId: prefix.id })).toEqual(["Mine"]);
    expect(await feed(w, w.carol, { prefixId: prefix.id })).toEqual(["Stranger", "Mine"]);
  });

  test("hot takes the same fields, featured threads included", async () => {
    const { w, other } = await scene();
    const a = await thread(w, w.bob, w.open.id, "A");
    const b = await thread(w, w.bob, other.id, "B");
    const c = await thread(w, w.bob, other.id, "C");
    for (const id of [a.thread.id, b.thread.id])
      w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 6 WHERE id = ?1").run(id);
    await w.call("threads.setFeatured", w.mod, {
      threadId: c.thread.id,
      isFeatured: true,
      reason: "pick",
    });
    refreshRankings(w.ctx);
    expect((await feed(w, w.carol, { scope: "hot" })).sort()).toEqual(["A", "B", "C"]);
    expect((await feed(w, w.carol, { scope: "hot", forumIds: [other.id] })).sort()).toEqual([
      "B",
      "C",
    ]);
    expect(await feed(w, w.carol, { scope: "hot", forumIds: [w.open.id] })).toEqual(["A"]);
    expect(await feed(w, w.carol, { scope: "hot", type: "featured" })).toEqual(["C"]);
  });

  test("read gates, ignores and hidden forums stay in force under every filter", async () => {
    const { w } = await scene();
    await thread(w, w.admin, w.secret.id, "Secret");
    await thread(w, w.bob, w.open.id, "Bob");
    await thread(w, w.alice, w.open.id, "Alice");
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    for (const filter of [{}, { forumIds: [w.open.id, w.secret.id] }, { type: "sticky" }])
      expect(await feed(w, w.carol, filter)).not.toContain("Secret");
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual(["Alice"]);
    // Titles only: the post is not readable, so the entry is not drawn.
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual([]);
    expect(await feed(w, w.mod, { forumIds: [w.open.id] })).toEqual(["Alice", "Bob"]);
    // Others' threads closed: the viewer keeps their own.
    setEntry(w.ctx, 2, "forum.viewContent", 1, w.open.id);
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewOthers", -1, w.open.id);
    expect(await feed(w, w.alice, { forumIds: [w.open.id] })).toEqual(["Alice"]);
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual([]);
  });

  test("pages join up with a filter, in every walk", async () => {
    const { w, other, sub, prefix } = await scene();
    for (let i = 0; i < 14; i++) {
      const forum = [w.open.id, other.id, sub.id][i % 3]!;
      const created = await thread(w, i % 2 ? w.alice : w.bob, forum, `T${i}`, {
        ...(i % 4 === 0 ? { prefixId: prefix.id } : {}),
        ...(i % 5 === 0 ? { tags: ["five"] } : {}),
      });
      if (i % 3 === 0)
        await w.call("threads.watch", w.carol, { threadId: created.thread.id, email: false });
      if (i === 2 || i === 9)
        await w.call("threads.setSticky", w.mod, {
          threadId: created.thread.id,
          isSticky: true,
          reason: "x",
          notify: false,
        });
      if (i === 3 || i === 7)
        await w.call("threads.setLocked", w.mod, {
          threadId: created.thread.id,
          isLocked: true,
          reason: "x",
          notify: false,
        });
      if (i === 4 || i === 11)
        await w.call("threads.setFeatured", w.mod, {
          threadId: created.thread.id,
          isFeatured: true,
          reason: "x",
        });
    }
    // A reply moves a thread to the top of every walk.
    w.ctx.clock.advance(60_000);
    await w.call("posts.create", w.bob, { threadId: 1, body: "bump" });
    const filters: object[] = [
      { forumIds: [w.open.id] },
      { forumIds: [other.id, sub.id] },
      { prefixId: prefix.id },
      { type: "sticky" },
      { type: "locked" },
      { type: "featured" },
      { tag: "five" },
      { watched: true },
      { unread: true },
      { forumIds: [w.open.id], prefixId: prefix.id },
    ];
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    for (const filter of filters) {
      const whole = await feed(w, w.carol, filter);
      expect(whole.length).toBeGreaterThan(0);
      expect(new Set(whole).size).toBe(whole.length);
      expect(await paged(w, w.carol, filter, 2)).toEqual(whole);
      expect(await paged(w, w.carol, filter, 5)).toEqual(whole);
    }
    // Following lists a thread once per answer, so a later page may repeat one: compare the sets.
    const following = { scope: "following", forumIds: [w.open.id] };
    const bobsInOpen = new Set(await feed(w, w.carol, following));
    expect(bobsInOpen.size).toBeGreaterThan(0);
    expect(new Set(await paged(w, w.carol, following, 2))).toEqual(bobsInOpen);
    // The newest activity is first: T0 got the reply.
    expect((await feed(w, w.carol, { forumIds: [w.open.id] }))[0]).toBe("T0");
    expect((await feed(w, w.carol, { forumIds: [other.id, sub.id] }))[0]).toBe("T13");
  });

  test("feed.newCount counts only what the filter lets through", async () => {
    const { w, other } = await scene();
    await thread(w, w.bob, w.open.id, "Before");
    const since = new Date(w.ctx.now()).toISOString();
    w.ctx.clock.advance(60_000);
    await thread(w, w.bob, w.open.id, "In open");
    await thread(w, w.bob, other.id, "In other");
    expect(await w.call("feed.newCount", w.carol, { since })).toEqual({ count: 2, more: false });
    expect(await w.call("feed.newCount", w.carol, { since, forumIds: [other.id] })).toEqual({
      count: 1,
      more: false,
    });
    expect(await w.call("feed.newCount", w.carol, { since, tag: "nobody" })).toEqual({
      count: 0,
      more: false,
    });
    expect(await w.call("feed.newCount", w.carol, { since, unread: true })).toEqual({
      count: 2,
      more: false,
    });
    await expect(w.call("feed.newCount", GUEST, { since, watched: true })).rejects.toThrow(
      UnauthenticatedError,
    );
  });
});

describe("site-wide exclusion and members hiding forums", () => {
  const exclude = (w: World, ids: number[]) =>
    w.call("settings.update", w.admin, { feedExcludedForumIds: ids });

  test("an excluded forum and the forums under it are left out for everyone, even when named", async () => {
    const { w, other, sub } = await scene();
    await thread(w, w.alice, w.open.id, "In open");
    await thread(w, w.alice, other.id, "In other");
    await thread(w, w.alice, sub.id, "In sub");
    await exclude(w, [w.open.id]);
    for (const viewer of [w.carol, GUEST, w.admin])
      for (const scope of ["latest", "hot"])
        expect(await feed(w, viewer, { scope })).not.toContain("In open");
    expect(await feed(w, w.carol)).toEqual(["In other"]);
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual([]);
    expect(await feed(w, w.carol, { forumIds: [w.open.id, other.id] })).toEqual(["In other"]);
    // The forum itself is still listed and open.
    expect((await w.call("threads.list", w.carol, { nodeId: w.open.id })).items).toHaveLength(1);
    await exclude(w, []);
    expect(await feed(w, w.carol)).toEqual(["In sub", "In other", "In open"]);
  });

  test("an excluded forum leaves the count and the following scope too", async () => {
    const { w } = await scene();
    await w.call("users.follow", w.carol, { userId: actorUserId(w.alice)! });
    const since = new Date(w.ctx.now()).toISOString();
    await thread(w, w.alice, w.open.id, "In open");
    await exclude(w, [w.open.id]);
    expect(await w.call("feed.newCount", w.carol, { since })).toEqual({ count: 0, more: false });
    expect(await feed(w, w.carol, { scope: "following" })).toEqual([]);
  });

  test("the setting names forums that exist, and only administrators change it", async () => {
    const { w } = await scene();
    await expect(exclude(w, [9999])).rejects.toThrow(ValidationError);
    await expect(
      w.call("settings.update", w.alice, { feedExcludedForumIds: [w.open.id] }),
    ).rejects.toThrow();
    expect((await exclude(w, [w.open.id, w.open.id])).feedExcludedForumIds).toEqual([w.open.id]);
    expect((await w.call("feed.options", GUEST, {})).excludedForumIds).toEqual([w.open.id]);
  });

  test("a member hides a forum from their own feed only, and naming it lists it", async () => {
    const { w, other, sub } = await scene();
    await thread(w, w.alice, w.open.id, "In open");
    await thread(w, w.alice, other.id, "In other");
    await thread(w, w.alice, sub.id, "In sub");
    expect(await w.call("feed.hideForum", w.carol, { nodeId: w.open.id, hidden: true })).toEqual({
      hidden: true,
    });
    // Hiding twice is the same row.
    await w.call("feed.hideForum", w.carol, { nodeId: w.open.id, hidden: true });
    expect(await feed(w, w.carol)).toEqual(["In other"]);
    expect(await feed(w, w.carol, { scope: "hot" })).toEqual([]);
    expect(await feed(w, w.bob)).toEqual(["In sub", "In other", "In open"]);
    expect(await feed(w, w.carol, { forumIds: [w.open.id] })).toEqual(["In sub", "In open"]);
    expect((await w.call("feed.options", w.carol, {})).hiddenForumIds).toEqual([w.open.id]);
    expect((await w.call("feed.options", w.bob, {})).hiddenForumIds).toEqual([]);
    await w.call("feed.hideForum", w.carol, { nodeId: w.open.id, hidden: false });
    expect(await feed(w, w.carol)).toEqual(["In sub", "In other", "In open"]);
  });

  test("hiding needs an account and a forum the member can see, showing always works", async () => {
    const { w } = await scene();
    await expect(
      w.call("feed.hideForum", GUEST, { nodeId: w.open.id, hidden: true }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      w.call("feed.hideForum", w.alice, { nodeId: w.secret.id, hidden: true }),
    ).rejects.toThrow(NotFoundError);
    await expect(w.call("feed.hideForum", w.alice, { nodeId: 9999, hidden: true })).rejects.toThrow(
      NotFoundError,
    );
    expect(await w.call("feed.hideForum", w.alice, { nodeId: w.secret.id, hidden: false })).toEqual(
      {
        hidden: false,
      },
    );
    // A forum that closes to a member after they hid it stays hidden and can be shown.
    await w.call("feed.hideForum", w.alice, { nodeId: w.open.id, hidden: true });
    for (const group of [1, 2])
      w.ctx.sqlite
        .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, ?2, 0)")
        .run(w.open.id, group);
    invalidate(w.ctx, "permissions");
    await w.call("feed.hideForum", w.alice, { nodeId: w.open.id, hidden: false });
    expect((await w.call("feed.options", w.alice, {})).hiddenForumIds).toEqual([]);
  });

  test("a member hides up to the limit, and hiding one already hidden still works at it", async () => {
    const { w } = await scene();
    const forums = Array.from({ length: FEED_HIDDEN_LIMIT }, () =>
      insertNode(w.ctx, { parentId: w.category.id }),
    );
    const extra = insertNode(w.ctx, { parentId: w.category.id });
    invalidate(w.ctx, "node_tree");
    invalidate(w.ctx, "permissions");
    for (const forum of forums)
      await w.call("feed.hideForum", w.alice, { nodeId: forum.id, hidden: true });
    await expect(
      w.call("feed.hideForum", w.alice, { nodeId: extra.id, hidden: true }),
    ).rejects.toThrow(ConflictError);
    expect(
      await w.call("feed.hideForum", w.alice, { nodeId: forums[0]!.id, hidden: true }),
    ).toEqual({ hidden: true });
    await w.call("feed.hideForum", w.alice, { nodeId: forums[0]!.id, hidden: false });
    await w.call("feed.hideForum", w.alice, { nodeId: extra.id, hidden: true });
  });

  test("with few forums left the walk visits them one by one, with many it reads the whole feed", async () => {
    const { w, other } = await scene();
    for (let i = 0; i < 6; i++) await thread(w, w.alice, i % 2 ? other.id : w.open.id, `T${i}`);
    await w.call("feed.hideForum", w.carol, { nodeId: other.id, hidden: true });
    expect(await feed(w, w.carol)).toEqual(["T4", "T2", "T0"]);
    expect(await paged(w, w.carol, {}, 2)).toEqual(["T4", "T2", "T0"]);
  });
});

describe("saved filters", () => {
  const save = (w: World, actor: Actor, name: string, extra: object = {}) =>
    w.call("feed.saveFilter", actor, { name, scope: "latest", filter: {}, ...extra });

  test("a member saves, lists, replaces and deletes filters of their own", async () => {
    const { w, other } = await scene();
    const first = await save(w, w.alice, " Quiet corner ", {
      scope: "following",
      filter: { forumIds: [other.id, other.id], tag: "rust", unread: true, watched: false },
    });
    expect(first).toMatchObject({
      name: "Quiet corner",
      scope: "following",
      filter: { forumIds: [other.id], tag: "rust", unread: true },
    });
    expect(first.filter.watched).toBeUndefined();
    const second = await save(w, w.alice, "Second", { filter: { prefixId: 3 } });
    const same = await save(w, w.alice, "QUIET corner", { filter: { type: "sticky" } });
    expect(same.id).toBe(first.id);
    const options = await w.call("feed.options", w.alice, {});
    expect(options.filterLimit).toBe(FEED_FILTER_LIMIT);
    expect(options.filters.map((entry: { name: string }) => entry.name)).toEqual([
      "QUIET corner",
      "Second",
    ]);
    expect(options.filters[0].filter).toEqual({ type: "sticky" });
    expect((await w.call("feed.options", w.bob, {})).filters).toEqual([]);
    expect(await w.call("feed.deleteFilter", w.alice, { filterId: second.id })).toEqual({
      deleted: true,
    });
    expect((await w.call("feed.options", w.alice, {})).filters).toHaveLength(1);
  });

  test("a filter is the member's own: others cannot delete it, guests cannot save", async () => {
    const { w } = await scene();
    const mine = await save(w, w.alice, "Mine");
    await expect(w.call("feed.deleteFilter", w.bob, { filterId: mine.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(w.call("feed.deleteFilter", w.alice, { filterId: 9999 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(save(w, GUEST, "Nope")).rejects.toThrow(UnauthenticatedError);
    await expect(w.call("feed.deleteFilter", GUEST, { filterId: mine.id })).rejects.toThrow(
      UnauthenticatedError,
    );
    // The same name for two members is two filters.
    await save(w, w.bob, "Mine");
    expect((await w.call("feed.options", w.alice, {})).filters).toHaveLength(1);
  });

  test("the cap is ten: the eleventh name is a conflict, a replacement is not", async () => {
    const { w } = await scene();
    for (let i = 0; i < FEED_FILTER_LIMIT; i++) await save(w, w.alice, `Filter ${i}`);
    await expect(save(w, w.alice, "One too many")).rejects.toThrow(ConflictError);
    await save(w, w.alice, "filter 3", { scope: "hot" });
    expect((await w.call("feed.options", w.alice, {})).filters).toHaveLength(FEED_FILTER_LIMIT);
    const first = (await w.call("feed.options", w.alice, {})).filters[0];
    await w.call("feed.deleteFilter", w.alice, { filterId: first.id });
    await save(w, w.alice, "One too many");
  });

  test("names are 1 to 40 characters and the filter is checked", async () => {
    const { w } = await scene();
    await expect(save(w, w.alice, "   ")).rejects.toThrow(ValidationError);
    await expect(save(w, w.alice, "x".repeat(41))).rejects.toThrow(ValidationError);
    await expect(save(w, w.alice, "Bad", { filter: { type: "pinned" } })).rejects.toThrow(
      ValidationError,
    );
    await expect(save(w, w.alice, "Bad", { scope: "top" })).rejects.toThrow(ValidationError);
    await expect(
      save(w, w.alice, "Bad", {
        filter: { forumIds: Array.from({ length: 21 }, (_, i) => i + 1) },
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("a stale member cannot save: the write reads the member again", async () => {
    const { w } = await scene();
    const gone = customMember(w.ctx, ["site.view"]);
    w.ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(gone.row.id);
    await expect(save(w, gone.actor, "Late")).rejects.toThrow();
  });
});

describe("plans and statements", () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  const plans: [string, string, unknown[]][] = [
    ["all", filterSql.all, [MAX, MAX, 20]],
    ["forums", filterSql.forums, ["[1,2,3]", MAX, MAX, 20]],
    ["prefix", filterSql.prefix, [1, MAX, MAX, 20]],
    ["sticky", filterSql.sticky, [MAX, MAX, 20]],
    ["locked", filterSql.locked, [MAX, MAX, 20]],
    ["watched", filterSql.watched, [1, 500]],
    ["watchedAmong", filterSql.watchedAmong, [1, "[1,2]"]],
    ["taggedAmong", filterSql.taggedAmong, [1, "[1,2]", 1]],
    ["reads", filterSql.reads, [1, "[1,2]"]],
    ["hidden", filterSql.hidden, [1]],
    ["savedList", savedSql.list, [1]],
    ["savedByName", savedSql.byName, [1, "x"]],
    ["savedCount", savedSql.count, [1]],
    ["hiddenCount", savedSql.hiddenCount, [1]],
  ];
  test.each(plans)("%s reads through an index, never a table scan", (_name, sql, params) => {
    const w = world();
    expectNoTableScan(w.ctx, sql, params);
  });

  test("the filters add a few statements to a page, whatever the page holds", async () => {
    const { w, other, prefix } = await scene();
    for (let i = 0; i < 30; i++)
      await thread(w, w.bob, i % 2 ? other.id : w.open.id, `T${i}`, {
        prefixId: prefix.id,
        tags: ["all"],
      });
    const fields = {
      forumIds: [w.open.id, other.id],
      prefixId: prefix.id,
      tag: "all",
      unread: true,
      watched: false,
    };
    for (const limit of [4, 20]) {
      const plain = await countStatements(w.ctx, () => w.call("feed.list", w.carol, { limit }));
      const narrowed = await countStatements(w.ctx, () =>
        w.call("feed.list", w.carol, { limit, ...fields }),
      );
      // Each field costs one probe per batch of candidates (a page reads one or two batches).
      expect(narrowed - plain).toBeLessThanOrEqual(10);
    }
  });

  test("a named forum is read on its own, not found among everyone's newer threads", async () => {
    const { w, other } = await scene();
    await thread(w, w.bob, other.id, "Old in other");
    // Newer threads of another forum: more than one request examines of the whole feed.
    fillThreads(w.ctx, w.open.id, w.bobUser.id, 450, { at: () => w.ctx.now() + 1000 });
    const everything = await w.call("feed.list", w.carol, { limit: 5 });
    expect(everything.items).toEqual([]);
    expect(everything.nextCursor).not.toBeNull();
    expect(await feed(w, w.carol, { forumIds: [other.id] })).toEqual(["Old in other"]);
  });
});
