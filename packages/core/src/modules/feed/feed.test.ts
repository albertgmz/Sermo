import { describe, expect, test } from "bun:test";
import {
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { currentActor } from "../../permissions";
import { forumSql } from "../forums";
import { PROFILE_ACCESS_SQL } from "../profiles/shared";
import { feedSql } from "./feed";
import { countStatements, fillPosts, type World, world } from "./fixtures.test";
import { rankingSql, refreshRankings } from "./rankings";
import { viewerSql } from "./viewer";

// biome-ignore lint/suspicious/noExplicitAny: feed items are checked field by field below
type Item = { type: string; createdAt: string; following: boolean } & Record<string, any>;
const plain = (html: string) => html.replace(/<[^>]+>/g, "").trim();
const describeItem = (item: Item) =>
  item.type === "profilePost"
    ? `wall:${plain(item.profilePost.bodyHtml)}`
    : `${item.type}:${plain(item.post.bodyHtml)}`;

async function pageThrough(
  w: World,
  actor: Parameters<World["call"]>[1],
  scope: string,
  limit: number,
) {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 80; guard++) {
    const page = await w.call("feed.list", actor, { scope, limit, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    cursor = page.nextCursor;
  }
  throw new Error("the feed never ended");
}

describe("feed.list latest", () => {
  test("merges threads and wall posts, newest first, a thread at its newest post, for guests too", async () => {
    const w = world();
    const t1 = await w.thread(w.alice, w.open.id, "First");
    await w.wall(w.bob, w.carolUser.id, "hello carol");
    await w.reply(w.bob, t1.thread.id, "a reply");
    await w.thread(w.carol, w.open.id, "Second");
    for (const actor of [w.alice, GUEST]) {
      const page = await w.call("feed.list", actor, {});
      expect(page.nextCursor).toBeNull();
      const described = page.items.map(describeItem);
      // The first thread is one entry, at its reply: its opening post is not listed again.
      const expected = ["thread:Second body", "post:a reply", "wall:hello carol"];
      // Guests only see wall posts if their group may open profiles.
      expect(described).toEqual(
        actor === GUEST && !(await w.call("auth.me", GUEST, {})).permissions.canViewProfiles
          ? expected.filter((entry) => !entry.startsWith("wall:"))
          : expected,
      );
      expect(page.items[0].thread.title).toBe("Second");
      expect(page.items[1].post.threadId).toBe(t1.thread.id);
      expect(page.items[1].thread.title).toBe("First");
      expect(page.items.every((item: Item) => item.following === false)).toBe(true);
    }
  });

  test("leaves out hidden forums, removed posts and threads that are not visible", async () => {
    const w = world();
    const shown = await w.thread(w.alice, w.open.id, "Shown");
    await w.thread(w.admin, w.secret.id, "Secret");
    const gone = await w.thread(w.alice, w.open.id, "Gone");
    await w.call("threads.delete", w.mod, { threadId: gone.thread.id, reason: "x", notify: false });
    const hiddenReply = await w.reply(w.bob, shown.thread.id, "removed reply");
    await w.call("posts.delete", w.mod, { postId: hiddenReply.id, reason: "x", notify: false });
    // With its only reply removed the thread is listed at its opening post again.
    expect((await w.call("feed.list", GUEST, {})).items.map(describeItem)).toEqual([
      "thread:Shown body",
    ]);
    const kept = await w.reply(w.bob, shown.thread.id, "kept reply");
    const guest = await w.call("feed.list", GUEST, {});
    expect(guest.items.map(describeItem)).toEqual(["post:kept reply"]);
    // Staff who may open the secret forum get its posts too; deleted ones stay out for everyone.
    const staff = await w.call("feed.list", w.admin, {});
    expect(staff.items.map(describeItem)).toEqual(["post:kept reply", "thread:Secret body"]);
    // A post awaiting approval is not in the feed.
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(kept.id);
    expect((await w.call("feed.list", GUEST, {})).items).toEqual([]);
  });

  test("a private profile hides its wall posts from those who may not open it", async () => {
    const w = world();
    await w.wall(w.bob, w.carolUser.id, "public wall");
    await w.wall(w.bob, w.aliceUser.id, "private wall");
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.aliceUser.id);
    expect((await w.call("feed.list", w.bob, {})).items.map(describeItem)).toEqual([
      "wall:public wall",
    ]);
    expect((await w.call("feed.list", w.alice, {})).items.map(describeItem)).toEqual([
      "wall:private wall",
      "wall:public wall",
    ]);
    // 'followed': only people the owner follows.
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'followed' WHERE id = ?1")
      .run(w.carolUser.id);
    expect((await w.call("feed.list", w.bob, {})).items).toEqual([]);
    await w.call("users.follow", w.carol, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.bob, {})).items.map(describeItem)).toEqual([
      "wall:public wall",
    ]);
    // Staff bypass privacy.
    expect((await w.call("feed.list", w.admin, {})).items).toHaveLength(2);
  });

  test("a wall that is for members only is left out of the feed for guests", async () => {
    const w = world();
    await w.wall(w.bob, w.carolUser.id, "open wall");
    await w.wall(w.bob, w.aliceUser.id, "members wall");
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'members' WHERE id = ?1")
      .run(w.aliceUser.id);
    expect((await w.call("feed.list", GUEST, {})).items.map(describeItem)).toEqual([
      "wall:open wall",
    ]);
    expect((await w.call("feed.list", w.carol, {})).items.map(describeItem)).toEqual([
      "wall:members wall",
      "wall:open wall",
    ]);
  });

  test("an API-key actor sees the feed its member would", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Open");
    await w.thread(w.admin, w.secret.id, "Secret");
    await w.wall(w.bob, w.carolUser.id, "a wall");
    const viaToken = await w.call("feed.list", tokenActor(w.bobUser), {});
    const viaSession = await w.call("feed.list", w.bob, {});
    expect(viaToken.items.map(describeItem)).toEqual(viaSession.items.map(describeItem));
    expect(viaToken.items.map(describeItem)).toEqual(["wall:a wall", "thread:Open body"]);
    await expect(
      w.call("feed.list", tokenActor(w.bobUser), { scope: "following" }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test("a thread in a forum whose ancestor is hidden is left out of the feed", async () => {
    const w = world();
    const child = insertNode(w.ctx, { parentId: w.secret.id });
    await w.thread(w.alice, w.open.id, "Open");
    const deep = await w.thread(w.admin, child.id, "Deep");
    await w.reply(w.admin, deep.thread.id, "deep reply");
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = '{\"1\":5}' WHERE thread_id = ?1")
      .run(deep.thread.id);
    refreshRankings(w.ctx);
    for (const scope of ["latest", "top"])
      expect((await w.call("feed.list", w.bob, { scope })).items.map(describeItem)).not.toContain(
        "thread:Deep body",
      );
    expect(
      (await w.call("feed.list", w.admin, { scope: "top" })).items.map(describeItem),
    ).toContain("thread:Deep body");
    expect((await w.call("feed.list", w.bob, {})).items.map(describeItem)).toEqual([
      "thread:Open body",
    ]);
  });

  test("wall posts that are not visible are left out", async () => {
    const w = world();
    const one = await w.wall(w.bob, w.carolUser.id, "removed wall");
    await w.wall(w.bob, w.carolUser.id, "kept wall");
    await w.call("profilePosts.delete", w.mod, {
      profilePostId: one.id,
      reason: "x",
      notify: false,
    });
    expect((await w.call("feed.list", w.alice, {})).items.map(describeItem)).toEqual([
      "wall:kept wall",
    ]);
  });

  test("members the viewer ignores are left out, until they can no longer be ignored", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Alices");
    await w.thread(w.bob, w.open.id, "Bobs");
    await w.wall(w.bob, w.carolUser.id, "bob on the wall");
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.carol, {})).items.map(describeItem)).toEqual([
      "thread:Alices body",
    ]);
    expect((await w.call("feed.list", w.alice, {})).items).toHaveLength(3);
    // Promoted to staff, the member can no longer be ignored: the old ignore stops applying.
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(w.bobUser.id);
    invalidate(w.ctx, "permissions");
    expect((await w.call("feed.list", w.carol, {})).items).toHaveLength(3);
  });

  test("pages hold the same items as one long page, without gaps or repeats", async () => {
    const w = world();
    const threads = [];
    for (let i = 0; i < 4; i++) threads.push(await w.thread(w.alice, w.open.id, `T${i}`));
    for (let i = 0; i < 9; i++) {
      // Threads 0 to 2 take the replies in turn; thread 3 stays at its opening post.
      await w.reply(w.bob, threads[i % 3]!.thread.id, `reply ${i}`);
      if (i % 3 === 0) await w.wall(w.carol, w.aliceUser.id, `wall ${i}`);
    }
    await w.thread(w.carol, w.open.id, "T4");
    const whole = (await w.call("feed.list", w.alice, { limit: 100 })).items.map(describeItem);
    expect(whole).toEqual([
      "thread:T4 body",
      "post:reply 8",
      "post:reply 7",
      "wall:wall 6",
      "post:reply 6",
      "wall:wall 3",
      "wall:wall 0",
      "thread:T3 body",
    ]);
    for (const limit of [1, 2, 5])
      expect((await pageThrough(w, w.alice, "latest", limit)).map(describeItem)).toEqual(whole);
  });

  test("a thread is listed once, at its newest post, on one page and across two", async () => {
    const w = world();
    const busy = await w.thread(w.alice, w.open.id, "Busy");
    const quiet = await w.thread(w.carol, w.open.id, "Quiet");
    for (let i = 0; i < 30; i++) await w.reply(i % 2 ? w.alice : w.bob, busy.thread.id, `r${i}`);
    const threadIds = (items: Item[]) => items.map((item) => item.thread.id);
    const whole = await w.call("feed.list", GUEST, { limit: 100 });
    expect(whole.items.map(describeItem)).toEqual(["post:r29", "thread:Quiet body"]);
    expect(threadIds(whole.items)).toEqual([busy.thread.id, quiet.thread.id]);
    const first = await w.call("feed.list", GUEST, { limit: 1 });
    expect(first.items.map(describeItem)).toEqual(["post:r29"]);
    expect(first.nextCursor).not.toBeNull();
    const rest = await pageThrough(w, GUEST, "latest", 1);
    expect(rest.map(describeItem)).toEqual(["post:r29", "thread:Quiet body"]);
    expect(threadIds(rest)).toEqual([busy.thread.id, quiet.thread.id]);
  });

  test("a new reply moves its thread to the top", async () => {
    const w = world();
    const older = await w.thread(w.alice, w.open.id, "Older");
    await w.thread(w.carol, w.open.id, "Newer");
    await w.wall(w.bob, w.carolUser.id, "a wall");
    expect((await w.call("feed.list", w.alice, {})).items.map(describeItem)).toEqual([
      "wall:a wall",
      "thread:Newer body",
      "thread:Older body",
    ]);
    await w.reply(w.bob, older.thread.id, "bump");
    const after = await w.call("feed.list", w.alice, {});
    expect(after.items.map(describeItem)).toEqual([
      "post:bump",
      "wall:a wall",
      "thread:Newer body",
    ]);
    expect(after.items[0].thread.id).toBe(older.thread.id);
  });

  test("a thread whose newest post is by an ignored member is left out", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Alices");
    await w.reply(w.bob, t.thread.id, "bob last");
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.carol, {})).items).toEqual([]);
    expect((await w.call("feed.list", w.alice, {})).items.map(describeItem)).toEqual([
      "post:bob last",
    ]);
  });

  test("a page can be short while nextCursor is set: what the viewer cannot see is skipped in bounded batches", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    fillPosts(w.ctx, secret.thread.id, w.aliceUser.id, 450);
    const first = await w.call("feed.list", w.bob, { limit: 5 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await w.call("feed.list", w.bob, { limit: 5, cursor: first.nextCursor });
    expect(second.items.map(describeItem)).toEqual(["thread:Visible body"]);
    expect(second.items[0].thread.id).toBe(visible.thread.id);
    expect(second.nextCursor).toBeNull();
    expect((await pageThrough(w, w.bob, "latest", 5)).map(describeItem)).toEqual([
      "thread:Visible body",
    ]);
  });

  test("a malformed cursor is refused", async () => {
    const w = world();
    await expect(w.call("feed.list", w.alice, { cursor: "nonsense" })).rejects.toThrow();
  });
});

describe("feed.list following", () => {
  test("needs an account; a member who follows nobody gets an empty feed", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Anything");
    await expect(w.call("feed.list", GUEST, { scope: "following" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await w.call("feed.list", w.bob, { scope: "following" })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test("shows only the followed members' threads, replies and wall posts, flagged as followed", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Alice alone");
    const t = await w.thread(w.alice, w.open.id, "By alice");
    await w.thread(w.carol, w.open.id, "By carol");
    await w.reply(w.alice, t.thread.id, "alice again");
    await w.reply(w.carol, t.thread.id, "carol reply");
    await w.wall(w.alice, w.carolUser.id, "alice wall");
    await w.wall(w.carol, w.aliceUser.id, "carol wall");
    await w.call("users.follow", w.bob, { userId: w.aliceUser.id });
    // "By alice" is one entry, at the newest post alice wrote in it (not the thread's newest).
    const following = await w.call("feed.list", w.bob, { scope: "following" });
    expect(following.items.map(describeItem)).toEqual([
      "wall:alice wall",
      "post:alice again",
      "thread:Alice alone body",
    ]);
    expect(following.items.every((item: Item) => item.following)).toBe(true);
    expect(following.nextCursor).toBeNull();
    // In the latest feed the flag marks only the followed author's items: "By alice" is listed
    // there at carol's reply, which is not flagged.
    const latest = await w.call("feed.list", w.bob, {});
    expect(latest.items.filter((item: Item) => item.following).map(describeItem)).toEqual([
      "wall:alice wall",
      "thread:Alice alone body",
    ]);
    expect(latest.items.some((item: Item) => !item.following)).toBe(true);
  });

  test("a thread is listed once per answer; a later page may bring it back with older activity", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Long");
    const other = await w.thread(w.alice, w.open.id, "Other");
    for (let i = 0; i < 12; i++) await w.reply(w.alice, t.thread.id, `r${i}`);
    await w.call("users.follow", w.bob, { userId: w.aliceUser.id });
    const whole = await w.call("feed.list", w.bob, { scope: "following", limit: 100 });
    expect(whole.items.map(describeItem)).toEqual(["post:r11", "thread:Other body"]);
    expect(whole.items.map((item: Item) => item.thread.id)).toEqual([t.thread.id, other.thread.id]);
    // A page of one examines ten posts: the next answer starts below them and lists the thread
    // again, at the newest of the older posts.
    const first = await w.call("feed.list", w.bob, { scope: "following", limit: 1 });
    expect(first.items.map(describeItem)).toEqual(["post:r11"]);
    const second = await w.call("feed.list", w.bob, {
      scope: "following",
      limit: 10,
      cursor: first.nextCursor,
    });
    expect(second.items.map(describeItem)).toEqual(["post:r1", "thread:Other body"]);
  });

  test("pages through several followed authors without gaps, hiding what the viewer cannot open", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Base");
    const secret = await w.thread(w.admin, w.secret.id, "Hidden");
    // One thread per reply: each is its own conversation, so none is folded into another.
    for (let i = 0; i < 5; i++) {
      const t = await w.thread(w.mod, w.open.id, `T${i}`);
      await w.reply(i % 2 ? w.alice : w.carol, t.thread.id, `r${i}`);
      fillPosts(w.ctx, secret.thread.id, w.aliceUser.id, 1);
    }
    await w.call("users.follow", w.bob, { userId: w.aliceUser.id });
    await w.call("users.follow", w.bob, { userId: w.carolUser.id });
    const whole = (await w.call("feed.list", w.bob, { scope: "following", limit: 100 })).items.map(
      describeItem,
    );
    expect(whole).toEqual([
      "post:r4",
      "post:r3",
      "post:r2",
      "post:r1",
      "post:r0",
      "thread:Base body",
    ]);
    for (const limit of [1, 2, 4])
      expect((await pageThrough(w, w.bob, "following", limit)).map(describeItem)).toEqual(whole);
    // Ignoring one of them removes theirs.
    await w.call("users.ignore", w.bob, { userId: w.carolUser.id });
    expect((await pageThrough(w, w.bob, "following", 3)).map(describeItem)).toEqual([
      "post:r3",
      "post:r1",
      "thread:Base body",
    ]);
  });
});

describe("feed.list top", () => {
  test("lists the ranked posts the viewer may open, in ranking order, ignoring the cursor", async () => {
    const w = world();
    const a = await w.thread(w.alice, w.open.id, "A");
    const b = await w.reply(w.bob, a.thread.id, "B reply");
    const secret = await w.thread(w.admin, w.secret.id, "S");
    const set = (id: number, counts: string) =>
      w.ctx.sqlite.prepare("UPDATE posts SET reaction_counts = ?1 WHERE id = ?2").run(counts, id);
    set(a.post.id, '{"1":2}');
    set(b.id, '{"1":3,"2":1}');
    set(secret.post.id, '{"1":9}');
    refreshRankings(w.ctx);
    const guest = await w.call("feed.list", GUEST, { scope: "top", cursor: "ignored", limit: 1 });
    expect(guest.nextCursor).toBeNull();
    expect(guest.items.map(describeItem)).toEqual(["post:B reply", "thread:A body"]);
    expect((await w.call("feed.list", w.admin, { scope: "top" })).items.map(describeItem)).toEqual([
      "thread:S body",
      "post:B reply",
      "thread:A body",
    ]);
    // An ignored author is left out; a post removed since the last refresh is too.
    await w.call("users.ignore", w.alice, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.alice, { scope: "top" })).items.map(describeItem)).toEqual([
      "thread:A body",
    ]);
    await w.call("posts.delete", w.mod, { postId: b.id, reason: "x", notify: false });
    expect((await w.call("feed.list", GUEST, { scope: "top" })).items.map(describeItem)).toEqual([
      "thread:A body",
    ]);
  });

  test("better posts in a forum the viewer cannot see do not push out the ones they can", async () => {
    const w = world();
    const open = await w.thread(w.alice, w.open.id, "Open");
    const hidden = await w.thread(w.admin, w.secret.id, "Hidden");
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = '{\"1\":1}' WHERE id = ?1")
      .run(open.post.id);
    const insert = w.ctx.sqlite.prepare<{ id: number }, [number, number, number, number, string]>(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at, reaction_counts) VALUES (?1, ?2, ?3, 'visible', ?4, ?5) RETURNING id",
    );
    const body = w.ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let i = 1; i <= 200; i++)
      body.run(insert.get(hidden.thread.id, w.aliceUser.id, i, w.ctx.now(), `{"1":${i + 10}}`)!.id);
    refreshRankings(w.ctx);
    for (const viewer of [w.bob, GUEST])
      expect((await w.call("feed.list", viewer, { scope: "top" })).items.map(describeItem)).toEqual(
        ["thread:Open body"],
      );
    const staff = await w.call("feed.list", w.admin, { scope: "top" });
    expect(staff.items).toHaveLength(50);
    expect(staff.items.every((item: Item) => item.thread.node.id === w.secret.id)).toBe(true);
  });

  /** Adds visible posts with bodies to a thread, one per score; returns their ids, in order. */
  function addScored(w: World, threadId: number, userId: number, scores: number[]): number[] {
    const insert = w.ctx.sqlite.prepare<{ id: number }, [number, number, number, number, string]>(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at, reaction_counts) VALUES (?1, ?2, ?3, 'visible', ?4, ?5) RETURNING id",
    );
    const body = w.ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    const start =
      w.ctx.sqlite
        .prepare<{ p: number }, [number]>(
          "SELECT max(position) AS p FROM posts WHERE thread_id = ?1",
        )
        .get(threadId)!.p + 1;
    return scores.map((score, i) => {
      const id = insert.get(threadId, userId, start + i, w.ctx.now(), `{"1":${score}}`)!.id;
      body.run(id);
      return id;
    });
  }
  const topIds = async (w: World, viewer: Parameters<World["call"]>[1]) =>
    (await w.call("feed.list", viewer, { scope: "top" })).items.map((item: Item) => item.post.id);

  test("a viewer who ignores the author of the 60 best posts of a forum still gets the others", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Busy");
    addScored(
      w,
      t.thread.id,
      w.aliceUser.id,
      Array.from({ length: 60 }, (_, i) => 1000 + i),
    );
    const bobs = addScored(
      w,
      t.thread.id,
      w.bobUser.id,
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    refreshRankings(w.ctx);
    await w.call("users.ignore", w.carol, { userId: w.aliceUser.id });
    expect(await topIds(w, w.carol)).toEqual([...bobs].reverse());
    expect(await topIds(w, w.bob)).toHaveLength(50);
  });

  test("with several forums the merged top stays in order when an ignored author fills the best places", async () => {
    const w = world();
    const other = insertNode(w.ctx, { parentId: w.category.id });
    const a = await w.thread(w.alice, w.open.id, "A");
    const b = await w.thread(w.alice, other.id, "B");
    addScored(
      w,
      a.thread.id,
      w.aliceUser.id,
      Array.from({ length: 60 }, (_, i) => 1000 + i),
    );
    addScored(
      w,
      b.thread.id,
      w.aliceUser.id,
      Array.from({ length: 60 }, (_, i) => 500 + i),
    );
    const inA = addScored(w, a.thread.id, w.bobUser.id, [3, 1, 2, 5, 4]);
    const inB = addScored(w, b.thread.id, w.bobUser.id, [8, 6, 10, 7, 9]);
    refreshRankings(w.ctx);
    await w.call("users.ignore", w.carol, { userId: w.aliceUser.id });
    const scoreOf = new Map([
      ...inA.map((id, i) => [id, [3, 1, 2, 5, 4][i]!] as const),
      ...inB.map((id, i) => [id, [8, 6, 10, 7, 9][i]!] as const),
    ]);
    const expected = [...scoreOf].sort((x, y) => y[1] - x[1] || y[0] - x[0]).map(([id]) => id);
    expect(await topIds(w, w.carol)).toEqual(expected);
  });

  test("posts removed since the last refresh are replaced by the next best", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Busy");
    const posts = addScored(
      w,
      t.thread.id,
      w.aliceUser.id,
      Array.from({ length: 80 }, (_, i) => i + 1),
    );
    refreshRankings(w.ctx);
    const remove = w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1");
    for (const id of posts.slice(40)) remove.run(id);
    expect(await topIds(w, GUEST)).toEqual(posts.slice(0, 40).reverse());
  });

  test("shows at most 50 and an empty ranking is an empty page", async () => {
    const w = world();
    expect(await w.call("feed.list", GUEST, { scope: "top" })).toEqual({
      items: [],
      nextCursor: null,
    });
    const t = await w.thread(w.alice, w.open.id, "Many");
    const ids: number[] = [t.post.id];
    for (let i = 0; i < 55; i++) ids.push((await w.reply(w.bob, t.thread.id, `p${i}`)).id);
    for (const id of ids)
      w.ctx.sqlite.prepare("UPDATE posts SET reaction_counts = '{\"1\":1}' WHERE id = ?1").run(id);
    refreshRankings(w.ctx);
    const top = await w.call("feed.list", GUEST, { scope: "top", limit: 100 });
    expect(top.items).toHaveLength(50);
    expect(top.items[0].post.id).toBe(ids.at(-1));
  });
});

describe("feed.list following with more than 100 follows", () => {
  test("the following scope walks the 100 most recent follows; items elsewhere still flag every followed author", async () => {
    const w = world();
    const members = Array.from({ length: 101 }, (_, i) =>
      insertUser(w.ctx, { username: `followed${i}` }),
    );
    const follow = w.ctx.sqlite.prepare(
      "INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)",
    );
    for (const [i, member] of members.entries()) follow.run(w.bobUser.id, member.id, i + 1);
    const oldest = members[0]!;
    const newest = members[100]!;
    await w.thread(userActor(oldest), w.open.id, "From the oldest follow");
    await w.thread(userActor(newest), w.open.id, "From the newest follow");
    const following = await w.call("feed.list", w.bob, { scope: "following", limit: 20 });
    expect(following.items.map(describeItem)).toEqual(["thread:From the newest follow body"]);
    const latest = await w.call("feed.list", w.bob, { limit: 20 });
    expect(latest.items.map((item: Item) => [describeItem(item), item.following])).toEqual([
      ["thread:From the newest follow body", true],
      ["thread:From the oldest follow body", true],
    ]);
  });
});

describe("feed.list canReply", () => {
  const canReplyOf = async (w: World, actor: Parameters<World["call"]>[1], scope = "latest") =>
    Object.fromEntries(
      (await w.call("feed.list", actor, { scope })).items.map((item: Item) => [
        item.type === "profilePost" ? "wall" : item.thread.title,
        item.canReply,
      ]),
    );
  /** What `threads.get` answers for the same thread: the feed must agree with it. */
  const onThreadPage = async (w: World, actor: Parameters<World["call"]>[1], threadId: number) =>
    (await w.call("threads.get", actor, { threadId })).permissions.canReply;

  test("a member may reply, a guest may not; a wall post carries no canReply", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Open");
    await w.reply(w.carol, t.thread.id, "a reply");
    await w.thread(w.alice, w.open.id, "Fresh");
    await w.wall(w.bob, w.carolUser.id, "a wall");
    expect(await canReplyOf(w, w.bob)).toEqual({ wall: undefined, Fresh: true, Open: true });
    expect(await canReplyOf(w, tokenActor(w.bobUser))).toEqual({
      wall: undefined,
      Fresh: true,
      Open: true,
    });
    const guest = await canReplyOf(w, GUEST);
    expect(guest.Fresh).toBe(false);
    expect(guest.Open).toBe(false);
    expect(await onThreadPage(w, w.bob, t.thread.id)).toBe(true);
    expect(await onThreadPage(w, GUEST, t.thread.id)).toBe(false);
  });

  test("a locked thread takes replies only from those who may reply to locked threads", async () => {
    const w = world();
    const locked = await w.thread(w.alice, w.open.id, "Locked");
    await w.thread(w.alice, w.open.id, "Unlocked");
    await w.call("threads.setLocked", w.mod, { threadId: locked.thread.id, isLocked: true });
    expect(await canReplyOf(w, w.bob)).toEqual({ Unlocked: true, Locked: false });
    expect(await canReplyOf(w, w.mod)).toEqual({ Unlocked: true, Locked: true });
    expect(await onThreadPage(w, w.bob, locked.thread.id)).toBe(false);
    expect(await onThreadPage(w, w.mod, locked.thread.id)).toBe(true);
    await expect(w.reply(w.bob, locked.thread.id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    await w.reply(w.mod, locked.thread.id, "yes");
  });

  test("a forum where the member may not reply answers false, in every scope", async () => {
    const w = world();
    const readOnly = insertNode(w.ctx, { parentId: w.category.id });
    invalidate(w.ctx, "node_tree");
    const closed = await w.thread(w.alice, readOnly.id, "Closed");
    await w.thread(w.alice, w.open.id, "Open");
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'forum.reply'), ?1, 2, 0, -1)",
      )
      .run(readOnly.id);
    invalidate(w.ctx, "permissions");
    expect(await canReplyOf(w, w.bob)).toEqual({ Open: true, Closed: false });
    expect(await canReplyOf(w, w.mod)).toEqual({ Open: true, Closed: true });
    expect(await onThreadPage(w, w.bob, closed.thread.id)).toBe(false);
    await expect(w.reply(w.bob, closed.thread.id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    await w.call("users.follow", w.bob, { userId: w.aliceUser.id });
    expect(await canReplyOf(w, w.bob, "following")).toEqual({ Open: true, Closed: false });
    w.ctx.sqlite.prepare("UPDATE posts SET reaction_counts = '{\"1\":5}'").run();
    refreshRankings(w.ctx);
    expect(await canReplyOf(w, w.bob, "top")).toEqual({ Open: true, Closed: false });
  });

  test("a member banned from a thread may not reply to it, until the ban ends", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Banned here");
    await w.thread(w.alice, w.open.id, "Elsewhere");
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_bans (thread_id, user_id, moderator_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(t.thread.id, w.bobUser.id, w.aliceUser.id, w.ctx.now(), w.ctx.now() + 600_000);
    expect(await canReplyOf(w, w.bob)).toEqual({ Elsewhere: true, "Banned here": false });
    expect(await canReplyOf(w, w.carol)).toEqual({ Elsewhere: true, "Banned here": true });
    expect(await onThreadPage(w, w.bob, t.thread.id)).toBe(false);
    await expect(w.reply(w.bob, t.thread.id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    w.ctx.clock.advance(600_000);
    expect(await canReplyOf(w, w.bob)).toEqual({ Elsewhere: true, "Banned here": true });
  });

  test("the thread bans of a page are one statement, whatever the number of threads", async () => {
    const one = world();
    const many = world();
    await one.thread(one.alice, one.open.id, "T");
    for (let i = 0; i < 10; i++) await many.thread(many.alice, many.open.id, `T${i}`);
    const read = (w: World) => {
      const viewer = writeTx(w.ctx, () => currentActor(w.ctx, w.bob));
      return () => w.call("feed.list", viewer, { limit: 10 });
    };
    const withOne = await countStatements(one.ctx, read(one));
    const withMany = await countStatements(many.ctx, read(many));
    expect((await read(many)()).items).toHaveLength(10);
    expect(withMany).toBe(withOne);
  });
});

describe("feed.list wall posts", () => {
  test("a page of wall posts on many walls runs about as many statements as one wall", async () => {
    const one = world();
    const many = world();
    const owners = Array.from({ length: 30 }, (_, i) => {
      const user = insertUser(many.ctx, { username: `owner${i}` });
      return { user, actor: userActor(user) };
    });
    const solo = insertUser(one.ctx, { username: "solo" });
    for (let i = 0; i < 30; i++) await one.wall(userActor(solo), solo.id, `w${i}`);
    for (const [i, owner] of owners.entries()) await many.wall(owner.actor, owner.user.id, `w${i}`);
    // As a request's actor arrives: the principal is already resolved, so checks run no query.
    const read = (w: World) => {
      const viewer = writeTx(w.ctx, () => currentActor(w.ctx, w.bob));
      return () => w.call("feed.list", viewer, { limit: 30 });
    };
    const withOne = await countStatements(one.ctx, read(one));
    const withMany = await countStatements(many.ctx, read(many));
    expect((await read(many)()).items).toHaveLength(30);
    expect(withMany - withOne).toBeLessThanOrEqual(10);
    expect(withMany).toBeLessThan(150);
  });
});

describe("the feed queries read their indexes", () => {
  test("no table scan, and the followed walk uses the per-author index", () => {
    const w = world();
    expectNoTableScan(w.ctx, feedSql.posts, [100, 20]);
    expectNoTableScan(w.ctx, feedSql.wall, [100, 20]);
    expectNoTableScan(w.ctx, feedSql.followedPosts, ["[1,2]", 100, 20]);
    expectNoTableScan(w.ctx, feedSql.followedWall, ["[1,2]", 100, 20]);
    expectNoTableScan(w.ctx, PROFILE_ACCESS_SQL, [1, "[1,2]"]);
    expectNoTableScan(w.ctx, feedSql.wallRows, ["[1,2]"]);
    expectNoTableScan(w.ctx, rankingSql.stored, ["feedTop", "[1,2]"]);
    expectNoTableScan(w.ctx, feedSql.topPosts, ["[1,2]"]);
    expectNoTableScan(w.ctx, viewerSql.ignored, [1, "[1,2]"]);
    expectNoTableScan(w.ctx, viewerSql.principals, ["[1,2]"]);
    expectNoTableScan(w.ctx, viewerSql.followedAmong, [1, "[1,2]"]);
    expectNoTableScan(w.ctx, viewerSql.followed, [1, 100]);
    expectNoTableScan(w.ctx, forumSql.threadBansAmong, [1, "[1,2]", 0]);
    for (const [sql, index] of [
      [feedSql.followedPosts, "posts_user_id"],
      [feedSql.followedWall, "profile_posts_user_id"],
    ] as const) {
      const plan = w.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(["[1,2]", 100, 20] as never[]))
        .map((row) => row.detail)
        .join("\n");
      expect(plan).toContain(index);
    }
  });
});
