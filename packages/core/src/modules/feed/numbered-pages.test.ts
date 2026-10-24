import { describe, expect, test } from "bun:test";
import { AUTHOR_PAGES_MAX } from "../../contracts/feed";
import { fillThreads, type World, world } from "./fixtures.test";

const titles = (page: { items: { title: string }[] }) => page.items.map((thread) => thread.title);
const postBodies = (page: { items: { post: { bodyHtml: string } }[] }) =>
  page.items.map((entry) => entry.post.bodyHtml.replace(/<[^>]+>/g, "").trim());

describe("threads.byAuthor numbered pages", () => {
  test("first, middle and last page, newest first, counting only what the viewer may open", async () => {
    const w = world();
    for (const title of ["a", "b", "c", "d", "e"]) await w.thread(w.alice, w.open.id, title);
    // Alice's thread in the hidden forum, and one deleted: not for a member, counted for staff.
    const secret = await w.thread(w.admin, w.secret.id, "secret");
    w.ctx.sqlite
      .prepare("UPDATE threads SET user_id = ?1 WHERE id = ?2")
      .run(w.aliceUser.id, secret.thread.id);
    const gone = await w.thread(w.alice, w.open.id, "gone");
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(gone.thread.id);
    const at = (viewer: World["bob"], page: number, limit = 2) =>
      w.call("threads.byAuthor", viewer, { userId: w.aliceUser.id, page, limit });
    const [one, two, three, four] = await Promise.all([1, 2, 3, 4].map((n) => at(w.bob, n)));
    expect(titles(one)).toEqual(["e", "d"]);
    expect(titles(two)).toEqual(["c", "b"]);
    expect(titles(three)).toEqual(["a"]);
    expect(titles(four)).toEqual([]);
    for (const list of [one, two, three, four]) expect(list.total).toBe(5);
    expect(one.nextCursor).not.toBeNull();
    expect(three.nextCursor).toBeNull();
    // Staff see the hidden forum's thread and the deleted one as well.
    expect((await at(w.admin, 1, 20)).total).toBe(7);
    // The cursor goes on from the page's last thread; a walk by cursor carries no count.
    const next = await w.call("threads.byAuthor", w.bob, {
      userId: w.aliceUser.id,
      cursor: one.nextCursor,
      limit: 2,
    });
    expect(titles(next)).toEqual(["c", "b"]);
    expect(next.total).toBeNull();
    expect((await w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id })).total).toBeNull();
  });

  test("the numbered pages hold the newest AUTHOR_PAGES_MAX threads, and a cursor goes on", async () => {
    const w = world();
    fillThreads(w.ctx, w.open.id, w.aliceUser.id, AUTHOR_PAGES_MAX + 20);
    const last = AUTHOR_PAGES_MAX / 20;
    const final = await w.call("threads.byAuthor", w.bob, {
      userId: w.aliceUser.id,
      page: last,
      limit: 20,
    });
    expect(final.items).toHaveLength(20);
    expect(final.total).toBe(AUTHOR_PAGES_MAX);
    expect(final.nextCursor).not.toBeNull();
    const beyond = await w.call("threads.byAuthor", w.bob, {
      userId: w.aliceUser.id,
      page: last + 1,
      limit: 20,
    });
    expect(beyond.items).toEqual([]);
    expect(beyond.nextCursor).toBeNull();
    const rest = await w.call("threads.byAuthor", w.bob, {
      userId: w.aliceUser.id,
      cursor: final.nextCursor,
      limit: 50,
    });
    expect(rest.items).toHaveLength(20);
  });

  test("a member whose profile the viewer cannot open is still not found", async () => {
    const w = world();
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(w.aliceUser.id);
    await expect(
      w.call("threads.byAuthor", w.bob, { userId: w.aliceUser.id, page: 1 }),
    ).rejects.toThrow();
  });
});

describe("posts.byAuthor numbered pages", () => {
  test("first, middle and last page, newest first, counting only what the viewer may open", async () => {
    const w = world();
    const t = await w.thread(w.bob, w.open.id, "Open");
    for (const body of ["one", "two", "three", "four"]) await w.reply(w.alice, t.thread.id, body);
    const pending = await w.reply(w.alice, t.thread.id, "pending");
    const removed = await w.reply(w.alice, t.thread.id, "removed");
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(pending.id);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(removed.id);
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    w.ctx.sqlite
      .prepare("UPDATE posts SET user_id = ?1 WHERE id = ?2")
      .run(w.aliceUser.id, secret.post.id);
    const at = (viewer: World["bob"], page: number, limit = 2) =>
      w.call("posts.byAuthor", viewer, { userId: w.aliceUser.id, page, limit });
    const [one, two, three] = await Promise.all([1, 2, 3].map((n) => at(w.carol, n)));
    expect(postBodies(one)).toEqual(["four", "three"]);
    expect(postBodies(two)).toEqual(["two", "one"]);
    expect(postBodies(three)).toEqual([]);
    for (const list of [one, two, three]) expect(list.total).toBe(4);
    expect(one.nextCursor).not.toBeNull();
    expect(two.nextCursor).toBeNull();
    // Alice herself also sees the post held for approval; staff see everything.
    expect((await at(w.alice, 1, 20)).total).toBe(5);
    expect((await at(w.mod, 1, 20)).total).toBe(7);
    const next = await w.call("posts.byAuthor", w.carol, {
      userId: w.aliceUser.id,
      cursor: one.nextCursor,
      limit: 2,
    });
    expect(postBodies(next)).toEqual(["two", "one"]);
    expect(next.total).toBeNull();
  });
});
