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
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { encodeCursor } from "../../pagination";
import { currentActor } from "../../permissions";
import { forumSql } from "../forums";
import { PROFILE_ACCESS_SQL } from "../profiles/shared";
import { feedSql } from "./feed";
import { countStatements, fillPosts, fillThreads, type World, world } from "./fixtures.test";
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
    // A reply awaiting approval is not in the feed, for its author either: the thread stays at
    // its previous visible post until the reply is approved.
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const waiting = await w.reply(w.carol, shown.thread.id, "waiting reply");
    expect(waiting.state).toBe("moderated");
    for (const viewer of [GUEST, w.carol]) {
      const page = await w.call("feed.list", viewer, {});
      expect(page.items.map(describeItem)).toEqual(["post:kept reply"]);
      expect(page.items[0].post.id).toBe(kept.id);
    }
    await w.call("posts.restore", w.mod, { postId: waiting.id });
    expect((await w.call("feed.list", GUEST, {})).items.map(describeItem)).toEqual([
      "post:waiting reply",
    ]);
  });

  test("a thread awaiting approval is not listed, whatever is posted in it, until it is approved", async () => {
    const w = world();
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_thread_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const held = await w.thread(w.alice, w.open.id, "Held");
    expect(held.thread.state).toBe("moderated");
    // A visible reply in it does not list the thread: content follows the thread's state.
    const staffReply = await w.reply(w.mod, held.thread.id, "staff reply");
    expect(staffReply.state).toBe("visible");
    for (const viewer of [GUEST, w.alice, w.mod])
      expect((await w.call("feed.list", viewer, {})).items).toEqual([]);
    await w.call("threads.restore", w.mod, { threadId: held.thread.id });
    const page = await w.call("feed.list", GUEST, {});
    expect(page.items.map(describeItem)).toEqual(["post:staff reply"]);
    expect(page.items[0].thread.id).toBe(held.thread.id);
  });

  test("a merged thread is listed once, as its target; the thread merged away never is", async () => {
    const w = world();
    const target = await w.thread(w.alice, w.open.id, "Target");
    const merged = await w.thread(w.bob, w.open.id, "Merged away");
    await w.reply(w.carol, merged.thread.id, "from the merged thread");
    const done = await w.call("threads.merge", w.mod, {
      threadId: target.thread.id,
      sourceThreadIds: [merged.thread.id],
      reason: "x",
      notify: false,
    });
    expect(done.completed).toBe(true);
    for (const viewer of [GUEST, w.bob, w.mod]) {
      const items = await pageThrough(w, viewer, "latest", 1);
      expect(items.map(describeItem)).toEqual(["post:from the merged thread"]);
      expect(items[0]!.thread.id).toBe(target.thread.id);
    }
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
    for (const scope of ["latest", "hot"])
      expect((await w.call("feed.list", w.bob, { scope })).items.map(describeItem)).not.toContain(
        "thread:Deep body",
      );
    expect(
      (await w.call("feed.list", w.admin, { scope: "hot" })).items.map(describeItem),
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

  test("a thread whose newest post is by an ignored member stays, showing the newest post of anyone else", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Alices");
    await w.reply(w.carol, t.thread.id, "carol middle");
    await w.reply(w.bob, t.thread.id, "bob last");
    await w.reply(w.bob, t.thread.id, "bob again");
    const other = await w.thread(w.alice, w.open.id, "Other");
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    const items = (await w.call("feed.list", w.carol, {})).items;
    expect(items.map(describeItem)).toEqual(["thread:Other body", "post:carol middle"]);
    expect(items[0].thread.id).toBe(other.thread.id);
    expect(items[1].thread.id).toBe(t.thread.id);
    // Nothing older by anyone else but the starter: the thread shows its first post.
    const lone = await w.thread(w.alice, w.open.id, "Lone");
    await w.reply(w.bob, lone.thread.id, "bob alone");
    expect((await w.call("feed.list", w.carol, {})).items.map(describeItem)[0]).toBe(
      "thread:Lone body",
    );
    expect((await w.call("feed.list", w.alice, {})).items.map(describeItem)[0]).toBe(
      "post:bob alone",
    );
    expectNoTableScan(w.ctx, feedSql.olderPosts, [t.thread.id, 3]);
  });

  test("a thread with more ignored posts at its end than the lookback reaches is left out", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Spammed");
    await w.reply(w.carol, t.thread.id, "carol early");
    for (let i = 0; i < 110; i++) await w.reply(w.bob, t.thread.id, `spam ${i}`);
    await w.call("users.ignore", w.carol, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.carol, {})).items).toEqual([]);
    expect((await w.call("feed.list", w.alice, {})).items).toHaveLength(1);
  });

  test("a page can be short while nextCursor is set: what the viewer cannot see is skipped in bounded batches", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    // Threads, each one a candidate: replies in one hidden thread no longer count against the cap.
    fillThreads(w.ctx, w.secret.id, w.aliceUser.id, 450);
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

  test("quiet threads below a thread with far more replies than the cap still fill the page", async () => {
    const w = world();
    for (const title of ["Quiet 1", "Quiet 2", "Quiet 3"])
      await w.thread(w.alice, w.open.id, title);
    const busy = await w.thread(w.bob, w.open.id, "Busy");
    fillPosts(w.ctx, busy.thread.id, w.carolUser.id, 1000);
    await w.reply(w.carol, busy.thread.id, "the newest of a thousand");
    for (const viewer of [GUEST, w.alice]) {
      const page = await w.call("feed.list", viewer, { limit: 5 });
      expect(page.items.map(describeItem)).toEqual([
        "post:the newest of a thousand",
        "thread:Quiet 3 body",
        "thread:Quiet 2 body",
        "thread:Quiet 1 body",
      ]);
      expect(page.nextCursor).toBeNull();
      const paged = await pageThrough(w, viewer, "latest", 1);
      expect(paged.map(describeItem)).toEqual(page.items.map(describeItem));
    }
  });

  test("items of the same instant keep one order across the two sources and across pages", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Earlier");
    w.ctx.clock.advance(60_000);
    // No clock between these: three threads and two wall posts of one instant.
    for (const [i, title] of ["Same a", "Same b", "Same c"].entries()) {
      await w.call("threads.create", w.alice, { nodeId: w.open.id, title, body: `${title} body` });
      if (i < 2)
        await w.call("profilePosts.create", w.bob, { userId: w.carolUser.id, body: `wall ${i}` });
    }
    await w.thread(w.alice, w.open.id, "Later");
    const whole = await w.call("feed.list", w.alice, { limit: 100 });
    // At the same instant the forum side goes first (the higher thread id first), then the walls.
    expect(whole.items.map(describeItem)).toEqual([
      "thread:Later body",
      "thread:Same c body",
      "thread:Same b body",
      "thread:Same a body",
      "wall:wall 1",
      "wall:wall 0",
      "thread:Earlier body",
    ]);
    const same = whole.items.slice(1, 6).map((item: Item) => item.createdAt);
    expect(new Set(same).size).toBe(1);
    for (const limit of [1, 2, 3, 4])
      expect((await pageThrough(w, w.alice, "latest", limit)).map(describeItem)).toEqual(
        whole.items.map(describeItem),
      );
  });

  test("a reply between two pages moves its thread above the cursor: it is not listed again", async () => {
    const w = world();
    const a = await w.thread(w.alice, w.open.id, "A");
    await w.thread(w.alice, w.open.id, "B");
    await w.thread(w.alice, w.open.id, "C");
    const first = await w.call("feed.list", GUEST, { limit: 2 });
    expect(first.items.map(describeItem)).toEqual(["thread:C body", "thread:B body"]);
    await w.reply(w.bob, a.thread.id, "bump");
    const second = await w.call("feed.list", GUEST, { limit: 2, cursor: first.nextCursor });
    expect(second).toEqual({ items: [], nextCursor: null });
    expect((await w.call("feed.list", GUEST, { limit: 2 })).items.map(describeItem)).toEqual([
      "post:bump",
      "thread:C body",
    ]);
  });

  test("the entry's time is the creation time of the post shown", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "a reply");
    const [item] = (await w.call("feed.list", GUEST, {})).items;
    expect(item.createdAt).toBe(reply.createdAt);
    expect(item.createdAt).toBe(item.thread.lastPost.postedAt);
  });

  test("a malformed cursor is refused, and so is one of another scope or of the earlier shape", async () => {
    const w = world();
    for (let i = 0; i < 3; i++) await w.thread(w.alice, w.open.id, `T${i}`);
    await w.call("users.follow", w.bob, { userId: w.aliceUser.id });
    await expect(w.call("feed.list", w.alice, { cursor: "nonsense" })).rejects.toThrow();
    // `latest` once continued from a post id and a wall post id.
    await expect(
      w.call("feed.list", w.bob, { cursor: encodeCursor([5, 5]) }),
    ).rejects.toBeInstanceOf(ValidationError);
    const latest = await w.call("feed.list", w.bob, { limit: 1 });
    const following = await w.call("feed.list", w.bob, { scope: "following", limit: 1 });
    expect(latest.nextCursor).not.toBeNull();
    await expect(
      w.call("feed.list", w.bob, { scope: "following", cursor: latest.nextCursor }),
    ).rejects.toBeInstanceOf(ValidationError);
    if (following.nextCursor !== null)
      await expect(
        w.call("feed.list", w.bob, { cursor: following.nextCursor }),
      ).rejects.toBeInstanceOf(ValidationError);
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

describe("feed.list hot", () => {
  /**
   * Adds visible threads with an opening post and a body to a forum, one per reply count (the
   * count the hot score reads), created now; returns their ids and opening post ids, in order.
   */
  function addHot(w: World, nodeId: number, userId: number, replies: number[]) {
    const thread = w.ctx.sqlite.prepare<{ id: number }, [number, number, number, number]>(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, reply_count, last_post_at, last_poster_id) VALUES (?1, ?2, 'filler', 'visible', ?3, ?4, ?3, ?2) RETURNING id",
    );
    const post = w.ctx.sqlite.prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, 0, 'visible', ?3) RETURNING id",
    );
    const body = w.ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    const link = w.ctx.sqlite.prepare(
      "UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2",
    );
    return replies.map((count) => {
      const id = thread.get(nodeId, userId, w.ctx.now(), count)!.id;
      const postId = post.get(id, userId, w.ctx.now())!.id;
      body.run(postId);
      link.run(postId, id);
      return { id, postId };
    });
  }
  const setReplies = (w: World, threadId: number, replies: number) =>
    w.ctx.sqlite
      .prepare("UPDATE threads SET reply_count = ?1 WHERE id = ?2")
      .run(replies, threadId);
  const hotIds = async (w: World, viewer: Parameters<World["call"]>[1], scope = "hot") =>
    (await w.call("feed.list", viewer, { scope })).items.map((item: Item) => item.thread.id);

  test("lists the hot threads the viewer may open as their opening posts, in ranking order, ignoring the cursor", async () => {
    const w = world();
    const a = await w.thread(w.alice, w.open.id, "A");
    const b = await w.thread(w.bob, w.open.id, "B");
    const secret = await w.thread(w.admin, w.secret.id, "S");
    const quiet = await w.thread(w.alice, w.open.id, "Quiet");
    setReplies(w, a.thread.id, 5);
    setReplies(w, b.thread.id, 8);
    setReplies(w, secret.thread.id, 9);
    setReplies(w, quiet.thread.id, 2);
    refreshRankings(w.ctx);
    const guest = await w.call("feed.list", GUEST, { scope: "hot", cursor: "ignored", limit: 1 });
    expect(guest.nextCursor).toBeNull();
    expect(guest.items.map(describeItem)).toEqual(["thread:B body", "thread:A body"]);
    expect(guest.items[0].post.id).toBe(b.post.id);
    expect((await w.call("feed.list", w.admin, { scope: "hot" })).items.map(describeItem)).toEqual([
      "thread:S body",
      "thread:B body",
      "thread:A body",
    ]);
    // An ignored author is left out; a thread removed since the last refresh is too.
    await w.call("users.ignore", w.alice, { userId: w.bobUser.id });
    expect((await w.call("feed.list", w.alice, { scope: "hot" })).items.map(describeItem)).toEqual([
      "thread:A body",
    ]);
    await w.call("threads.delete", w.mod, { threadId: a.thread.id, reason: "x", notify: false });
    expect((await w.call("feed.list", GUEST, { scope: "hot" })).items.map(describeItem)).toEqual([
      "thread:B body",
    ]);
    expect(await hotIds(w, w.carol)).toEqual([b.thread.id]);
  });

  test("a thread that becomes hot by reactions to its opening post is listed without replies", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Loved");
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = '{\"1\":3}' WHERE id = ?1")
      .run(t.post.id);
    refreshRankings(w.ctx);
    expect(await hotIds(w, GUEST)).toEqual([t.thread.id]);
  });

  test("top, the former name of hot, is refused", async () => {
    const w = world();
    await expect(w.call("feed.list", GUEST, { scope: "top" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("hotter threads in a forum the viewer cannot see do not push out the ones they can", async () => {
    const w = world();
    const [open] = addHot(w, w.open.id, w.aliceUser.id, [3]);
    addHot(
      w,
      w.secret.id,
      w.aliceUser.id,
      Array.from({ length: 200 }, (_, i) => 100 + i),
    );
    refreshRankings(w.ctx);
    for (const viewer of [w.bob, GUEST]) expect(await hotIds(w, viewer)).toEqual([open!.id]);
    const staff = await w.call("feed.list", w.admin, { scope: "hot" });
    expect(staff.items).toHaveLength(50);
    expect(staff.items.every((item: Item) => item.thread.node.id === w.secret.id)).toBe(true);
  });

  test("a viewer who ignores the author of the 60 hottest threads of a forum still gets the others", async () => {
    const w = world();
    addHot(
      w,
      w.open.id,
      w.aliceUser.id,
      Array.from({ length: 60 }, (_, i) => 1000 + i),
    );
    const bobs = addHot(
      w,
      w.open.id,
      w.bobUser.id,
      Array.from({ length: 10 }, (_, i) => i + 3),
    );
    refreshRankings(w.ctx);
    await w.call("users.ignore", w.carol, { userId: w.aliceUser.id });
    expect(await hotIds(w, w.carol)).toEqual(bobs.map((b) => b.id).reverse());
    expect(await hotIds(w, w.bob)).toHaveLength(50);
  });

  test("with several forums the merged list stays in order when an ignored author fills the best places", async () => {
    const w = world();
    const other = insertNode(w.ctx, { parentId: w.category.id });
    const big = (from: number) => Array.from({ length: 60 }, (_, i) => from + i);
    addHot(w, w.open.id, w.aliceUser.id, big(1000));
    addHot(w, other.id, w.aliceUser.id, big(500));
    const inA = addHot(w, w.open.id, w.bobUser.id, [3, 4, 5, 6, 7]);
    const inB = addHot(w, other.id, w.bobUser.id, [8, 9, 10, 11, 12]);
    refreshRankings(w.ctx);
    await w.call("users.ignore", w.carol, { userId: w.aliceUser.id });
    expect(await hotIds(w, w.carol)).toEqual([...inA, ...inB].map((t) => t.id).reverse());
  });

  test("threads removed since the last refresh are replaced by the next best", async () => {
    const w = world();
    const threads = addHot(
      w,
      w.open.id,
      w.aliceUser.id,
      Array.from({ length: 80 }, (_, i) => i + 3),
    );
    refreshRankings(w.ctx);
    const remove = w.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1");
    for (const t of threads.slice(40)) remove.run(t.id);
    expect(await hotIds(w, GUEST)).toEqual(
      threads
        .slice(0, 40)
        .map((t) => t.id)
        .reverse(),
    );
  });

  test("a thread merged into another since the last refresh is left out", async () => {
    const w = world();
    const [kept, merged] = addHot(w, w.open.id, w.aliceUser.id, [4, 6]);
    refreshRankings(w.ctx);
    w.ctx.sqlite
      .prepare("UPDATE threads SET merged_into_id = ?1 WHERE id = ?2")
      .run(kept!.id, merged!.id);
    expect(await hotIds(w, GUEST)).toEqual([kept!.id]);
  });

  test("shows at most 50 and an empty ranking is an empty page", async () => {
    const w = world();
    expect(await w.call("feed.list", GUEST, { scope: "hot" })).toEqual({
      items: [],
      nextCursor: null,
    });
    const threads = addHot(
      w,
      w.open.id,
      w.aliceUser.id,
      Array.from({ length: 55 }, () => 3),
    );
    refreshRankings(w.ctx);
    const hot = await w.call("feed.list", GUEST, { scope: "hot", limit: 100 });
    expect(hot.items).toHaveLength(50);
    expect(hot.items[0].thread.id).toBe(threads.at(-1)!.id);
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
    expect(await canReplyOf(w, w.bob, "hot")).toEqual({ Open: true, Closed: false });
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

  /** The viewer as a new request would resolve them: standing and counters read again. */
  const fresh = (w: World, actor: Parameters<World["call"]>[1]) =>
    writeTx(w.ctx, () => currentActor(w.ctx, actor));
  /** The feed, `threads.get` and `posts.create` must say the same about a reply. */
  async function expectReply(
    w: World,
    actor: Parameters<World["call"]>[1],
    thread: { id: number; title: string },
    allowed: boolean,
  ) {
    expect((await canReplyOf(w, actor))[thread.title]).toBe(allowed);
    expect(await onThreadPage(w, actor, thread.id)).toBe(allowed);
    const attempt = w.call("posts.create", actor, { threadId: thread.id, body: "a try" });
    if (allowed) expect((await attempt).threadId).toBe(thread.id);
    else await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
  }
  const setNode = (w: World, nodeId: number, column: string, value: number) =>
    w.ctx.sqlite.prepare(`UPDATE nodes SET ${column} = ?1 WHERE id = ?2`).run(value, nodeId);

  test("a read-only forum takes replies only from those who bypass its rules", async () => {
    const w = world();
    const t = (await w.thread(w.alice, w.open.id, "Archive")).thread;
    await expectReply(w, w.bob, t, true);
    setNode(w, w.open.id, "is_read_only", 1);
    await expectReply(w, w.bob, t, false);
    await expectReply(w, w.alice, t, false);
    await expectReply(w, w.mod, t, true);
    expect((await canReplyOf(w, GUEST)).Archive).toBe(false);
    expect(await onThreadPage(w, GUEST, t.id)).toBe(false);
    setNode(w, w.open.id, "is_read_only", 0);
    await expectReply(w, w.bob, t, true);
  });

  test("a forum's minimum post count decides canReply, except for those who bypass it", async () => {
    const w = world();
    const t = (await w.thread(w.alice, w.open.id, "Regulars")).thread;
    setNode(w, w.open.id, "min_post_count", 3);
    await expectReply(w, fresh(w, w.bob), t, false);
    await expectReply(w, w.mod, t, true);
    w.ctx.sqlite.prepare("UPDATE users SET post_count = 3 WHERE id = ?1").run(w.bobUser.id);
    await expectReply(w, fresh(w, w.bob), t, true);
    await expectReply(w, fresh(w, w.carol), t, false);
  });

  test("a forum's minimum account age decides canReply, except for those who bypass it", async () => {
    const w = world();
    const t = (await w.thread(w.alice, w.open.id, "Settled")).thread;
    setNode(w, w.open.id, "min_account_age_days", 7);
    await expectReply(w, fresh(w, w.bob), t, false);
    await expectReply(w, w.mod, t, true);
    w.ctx.clock.advance(7 * 86_400_000);
    await expectReply(w, fresh(w, w.bob), t, true);
  });

  test("a permanent thread ban and a posting restriction both answer false", async () => {
    const w = world();
    const banned = (await w.thread(w.alice, w.open.id, "Banned for good")).thread;
    const other = (await w.thread(w.alice, w.open.id, "Other")).thread;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_bans (thread_id, user_id, moderator_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, NULL)",
      )
      .run(banned.id, w.bobUser.id, w.aliceUser.id, w.ctx.now());
    w.ctx.clock.advance(365 * 86_400_000);
    await expectReply(w, w.bob, banned, false);
    await expectReply(w, w.bob, other, true);
    await expectReply(w, w.carol, banned, true);
    await w.call("restrictions.create", w.mod, {
      userId: w.carolUser.id,
      kind: "posting",
      reason: "x",
    });
    await expectReply(w, fresh(w, w.carol), banned, false);
    await expectReply(w, fresh(w, w.carol), other, false);
    await expectReply(w, fresh(w, w.bob), other, true);
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
    expectNoTableScan(w.ctx, rankingSql.latestPosts, [100, 100, 20]);
    expectNoTableScan(w.ctx, feedSql.wall, [100, 20]);
    expectNoTableScan(w.ctx, feedSql.followedPosts, ["[1,2]", 100, 20]);
    expectNoTableScan(w.ctx, feedSql.followedWall, ["[1,2]", 100, 20]);
    expectNoTableScan(w.ctx, PROFILE_ACCESS_SQL, [1, "[1,2]"]);
    expectNoTableScan(w.ctx, feedSql.wallRows, ["[1,2]"]);
    expectNoTableScan(w.ctx, rankingSql.stored, ["hot", "[1,2]"]);
    expectNoTableScan(w.ctx, feedSql.hotPosts, ["[1,2]"]);
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
