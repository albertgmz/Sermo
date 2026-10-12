import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { NotFoundError } from "../../errors";
import { authorSql } from "./authors";
import { fillPosts, type World, world } from "./fixtures.test";

const titles = (page: { items: { title: string }[] }) => page.items.map((thread) => thread.title);
const bodies = (page: { items: { post: { bodyHtml: string }; thread: { title: string } }[] }) =>
  page.items.map(
    (entry) => `${entry.thread.title}:${entry.post.bodyHtml.replace(/<[^>]+>/g, "").trim()}`,
  );

async function paged(
  w: World,
  name: string,
  actor: Parameters<World["call"]>[1],
  userId: number,
  limit: number,
) {
  const items: unknown[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 60; guard++) {
    const page = await w.call(name, actor, { userId, limit, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    cursor = page.nextCursor;
  }
  throw new Error("never ended");
}

describe("by-author reads and a hidden ancestor", () => {
  test("content in a forum whose ancestor is hidden is not listed", async () => {
    const w = world();
    const child = insertNode(w.ctx, { parentId: w.secret.id });
    await w.thread(w.alice, w.open.id, "Open");
    // Alice cannot open the forum, so staff start the thread and it is then handed to her.
    const deep = await w.thread(w.admin, child.id, "Deep");
    w.ctx.sqlite
      .prepare("UPDATE threads SET user_id = ?1 WHERE id = ?2")
      .run(w.aliceUser.id, deep.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE posts SET user_id = ?1 WHERE thread_id = ?2")
      .run(w.aliceUser.id, deep.thread.id);
    const posts = (viewer: typeof w.bob) =>
      w
        .call("posts.byAuthor", viewer, { userId: w.aliceUser.id })
        .then((page) =>
          page.items.map((entry: { thread: { title: string } }) => entry.thread.title),
        );
    expect(titles(await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id }))).toEqual([
      "Open",
    ]);
    expect(await posts(w.bob)).toEqual(["Open"]);
    expect(titles(await w.call("threads.byAuthor", w.admin, { userId: w.aliceUser.id }))).toEqual([
      "Deep",
      "Open",
    ]);
    expect(await posts(w.admin)).toEqual(["Deep", "Open"]);
  });
});

describe("threads.byAuthor", () => {
  test("lists the member's threads newest first, with paging", async () => {
    const w = world();
    for (const title of ["a", "b", "c", "d", "e"]) await w.thread(w.alice, w.open.id, title);
    await w.thread(w.bob, w.open.id, "not alice");
    const all = await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id });
    expect(titles(all)).toEqual(["e", "d", "c", "b", "a"]);
    expect(all.nextCursor).toBeNull();
    const first = await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id, limit: 2 });
    expect(titles(first)).toEqual(["e", "d"]);
    expect(first.nextCursor).not.toBeNull();
    const rest = await paged(w, "threads.byAuthor", w.bob, w.aliceUser.id, 2);
    expect(rest.map((thread) => (thread as { title: string }).title)).toEqual([
      "e",
      "d",
      "c",
      "b",
      "a",
    ]);
    expect(await w.call("threads.byAuthor", w.bob, { userId: w.carolUser.id })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test("a member whose profile the viewer cannot open is not found", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Mine");
    await expect(w.call("threads.byAuthor", w.bob, { userId: 99_999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.aliceUser.id);
    await expect(
      w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.call("threads.byAuthor", GUEST, { userId: w.aliceUser.id })).rejects.toThrow();
    expect(titles(await w.call("threads.byAuthor", w.alice, { userId: w.aliceUser.id }))).toEqual([
      "Mine",
    ]);
    expect(titles(await w.call("threads.byAuthor", w.admin, { userId: w.aliceUser.id }))).toEqual([
      "Mine",
    ]);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'members' WHERE id = ?1")
      .run(w.aliceUser.id);
    expect(titles(await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id }))).toEqual([
      "Mine",
    ]);
    await expect(w.call("threads.byAuthor", GUEST, { userId: w.aliceUser.id })).rejects.toThrow();
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'followed' WHERE id = ?1")
      .run(w.aliceUser.id);
    await expect(
      w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.call("users.follow", w.alice, { userId: w.bobUser.id });
    expect(titles(await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id }))).toEqual([
      "Mine",
    ]);
  });

  test("without profile.view, a missing member and an existing one look the same", async () => {
    const w = world();
    const pid = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM permission_definitions WHERE key = 'profile.view'",
      )
      .get()!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 2, 0, -1) ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = -1",
      )
      .run(pid);
    invalidate(w.ctx, "permissions");
    for (const name of ["threads.byAuthor", "posts.byAuthor"]) {
      const real = await w.call(name, w.bob, { userId: w.aliceUser.id }).catch((e: unknown) => e);
      const missing = await w.call(name, w.bob, { userId: 99_999 }).catch((e: unknown) => e);
      expect(real).toBeInstanceOf(Error);
      expect((missing as Error).constructor).toBe((real as Error).constructor);
    }
  });

  test("guests need profile.view like everyone else", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Mine");
    const allowed = (await w.call("auth.me", GUEST, {})).permissions.canViewProfiles;
    const attempt = w.call("threads.byAuthor", GUEST, { userId: w.aliceUser.id });
    if (allowed) expect(titles(await attempt)).toEqual(["Mine"]);
    else await expect(attempt).rejects.toThrow(/./);
  });

  test("hidden forums, unapproved, deleted and merged threads follow the per-forum listing rule", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Visible");
    const pending = await w.thread(w.alice, w.open.id, "Pending");
    const deleted = await w.thread(w.alice, w.open.id, "Deleted");
    const merged = await w.thread(w.alice, w.open.id, "Merged");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    w.ctx.sqlite
      .prepare("UPDATE threads SET user_id = ?1 WHERE id = ?2")
      .run(w.aliceUser.id, secret.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(pending.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1")
      .run(deleted.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'deleted', merged_into_id = ?2 WHERE id = ?1")
      .run(merged.thread.id, pending.thread.id);
    const of = (actor: Parameters<World["call"]>[1]) =>
      w.call("threads.byAuthor", actor, { userId: w.aliceUser.id }).then(titles);
    // Members and guests: visible only. The author also sees her own awaiting approval.
    expect(await of(w.bob)).toEqual(["Visible"]);
    expect(await of(w.alice)).toEqual(["Pending", "Visible"]);
    // Moderators see what the forum listing shows them: moderated and deleted, plus the hidden forum.
    expect(await of(w.mod)).toEqual(["Secret", "Deleted", "Pending", "Visible"]);
    expect(await of(w.admin)).toEqual(["Secret", "Deleted", "Pending", "Visible"]);
    const forumListing = await w.call("threads.list", w.mod, { nodeId: w.open.id });
    expect(titles(forumListing).sort()).toEqual(["Deleted", "Pending", "Visible"]);
  });

  test("a page can be short while nextCursor is set when the member's recent threads are hidden", async () => {
    const w = world();
    await w.thread(w.alice, w.open.id, "Old and visible");
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'h', 'visible', ?3, ?3, ?2)",
    );
    for (let i = 0; i < 450; i++) insert.run(w.secret.id, w.aliceUser.id, w.ctx.now());
    const first = await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    expect(
      titles(
        await w.call("threads.byAuthor", w.bob, {
          userId: w.aliceUser.id,
          cursor: first.nextCursor,
        }),
      ),
    ).toEqual(["Old and visible"]);
  });

  test("the query reads the author index", () => {
    const w = world();
    expectNoTableScan(w.ctx, authorSql.threads, [1, 100, 40]);
  });
});

describe("posts.byAuthor", () => {
  test("lists the member's posts with their threads, newest first, with paging", async () => {
    const w = world();
    const t1 = await w.thread(w.alice, w.open.id, "T1");
    const t2 = await w.thread(w.bob, w.open.id, "T2");
    await w.reply(w.alice, t2.thread.id, "alice in T2");
    await w.reply(w.bob, t1.thread.id, "bob in T1");
    await w.reply(w.alice, t1.thread.id, "alice in T1");
    const page = await w.call("posts.byAuthor", w.carol, { userId: w.aliceUser.id });
    expect(bodies(page)).toEqual(["T1:alice in T1", "T2:alice in T2", "T1:T1 body"]);
    expect(page.items[0].post.threadId).toBe(page.items[0].thread.id);
    expect(page.items[0].thread.node.id).toBe(w.open.id);
    const everything = await paged(w, "posts.byAuthor", w.carol, w.aliceUser.id, 1);
    expect(everything).toHaveLength(3);
    expect(
      (await w.call("posts.byAuthor", w.carol, { userId: w.aliceUser.id, limit: 1 })).nextCursor,
    ).not.toBeNull();
  });

  test("honours profile visibility, hidden forums and content states", async () => {
    const w = world();
    const t = await w.thread(w.bob, w.open.id, "Open");
    const kept = await w.reply(w.alice, t.thread.id, "kept");
    const pending = await w.reply(w.alice, t.thread.id, "pending");
    const removed = await w.reply(w.alice, t.thread.id, "removed");
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(pending.id);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(removed.id);
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    w.ctx.sqlite
      .prepare("UPDATE posts SET user_id = ?1 WHERE id = ?2")
      .run(w.aliceUser.id, secret.post.id);
    const of = (actor: Parameters<World["call"]>[1]) =>
      w.call("posts.byAuthor", actor, { userId: w.aliceUser.id }).then(bodies);
    expect(await of(w.carol)).toEqual(["Open:kept"]);
    expect(await of(w.alice)).toEqual(["Open:pending", "Open:kept"]);
    expect(await of(w.mod)).toEqual([
      "Secret:Secret body",
      "Open:removed",
      "Open:pending",
      "Open:kept",
    ]);
    // A post in a thread that is not visible follows the thread's state.
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(t.thread.id);
    expect(await of(w.carol)).toEqual([]);
    expect(await of(w.mod)).toEqual([
      "Secret:Secret body",
      "Open:removed",
      "Open:pending",
      "Open:kept",
    ]);
    expect(kept.id).toBeGreaterThan(0);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.aliceUser.id);
    await expect(
      w.call("posts.byAuthor", w.carol, { userId: w.aliceUser.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.call("posts.byAuthor", w.carol, { userId: 99_999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await of(w.alice)).toEqual([]);
  });

  test("a page can be short while nextCursor is set when the member's recent posts are hidden", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    fillPosts(w.ctx, secret.thread.id, w.aliceUser.id, 450);
    const first = await w.call("posts.byAuthor", w.bob, { userId: w.aliceUser.id });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const next = await w.call("posts.byAuthor", w.bob, {
      userId: w.aliceUser.id,
      cursor: first.nextCursor,
    });
    expect(next.items.map((entry: { post: { id: number } }) => entry.post.id)).toEqual([
      visible.post.id,
    ]);
    expect(next.nextCursor).toBeNull();
  });

  test("the query reads the author index", () => {
    const w = world();
    expectNoTableScan(w.ctx, authorSql.posts, [1, 100, 40]);
  });
});
