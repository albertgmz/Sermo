import { describe, expect, test } from "bun:test";
import { expectNoTableScan, tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError, ValidationError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { forumSql } from "./index";

type Listed = {
  items: { id: number; position: number; bodyHtml: string }[];
  nextCursor: string | null;
  afterPostId?: number | null;
};
const plain = (html: string) => html.replace(/<[^>]+>/g, "").trim();
const bodies = (page: Listed) => page.items.map((post) => plain(post.bodyHtml));

const after = (
  w: World,
  actor: Parameters<World["call"]>[1],
  threadId: number,
  afterPosition: number,
  extra: object = {},
) => w.call("posts.list", actor, { threadId, afterPosition, ...extra }) as Promise<Listed>;

async function thread(w: World, replies: string[]) {
  const made = await w.thread(w.alice, w.open.id, "Polled");
  for (const body of replies) await w.reply(w.bob, made.thread.id, body);
  return made.thread.id as number;
}

describe("posts.list afterPosition", () => {
  test("lists the posts above the position, and nothing when there is nothing new", async () => {
    const w = world();
    const id = await thread(w, ["one", "two", "three"]);
    const posts = (await w.call("posts.list", w.alice, { threadId: id })).items.map(
      (post: { id: number }) => post.id,
    );
    expect((await w.call("posts.list", w.alice, { threadId: id })).afterPostId).toBeUndefined();
    for (const actor of [w.carol, GUEST, w.alice, tokenActor(w.carolUser)]) {
      const page = await after(w, actor, id, 1);
      expect(bodies(page)).toEqual(["two", "three"]);
      expect(page.items.map((post) => post.position)).toEqual([2, 3]);
      expect(page.nextCursor).toBeNull();
      // The answer names the post now at the position held, so a poller can tell a renumbering.
      expect(page.afterPostId).toBe(posts[1]);
      expect(await after(w, actor, id, 3)).toEqual({
        items: [],
        nextCursor: null,
        afterPostId: posts[3],
      });
      expect(await after(w, actor, id, 40)).toEqual({
        items: [],
        nextCursor: null,
        afterPostId: null,
      });
    }
    // A reply after the poll shows up on the next one.
    await w.reply(w.alice, id, "four");
    expect(bodies(await after(w, w.carol, id, 3))).toEqual(["four"]);
    // Position 0 asks for everything after the opening post.
    expect(bodies(await after(w, w.carol, id, 0))).toEqual(["one", "two", "three", "four"]);
  });

  test("pages of limit posts, and the cursor continues them; it wins over afterPosition and page", async () => {
    const w = world();
    const id = await thread(w, ["a", "b", "c", "d", "e"]);
    const first = await after(w, w.carol, id, 0, { limit: 2 });
    expect(bodies(first)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await w.call("posts.list", w.carol, {
      threadId: id,
      cursor: first.nextCursor,
      afterPosition: 0,
      page: 9,
      limit: 2,
    });
    expect(bodies(second)).toEqual(["c", "d"]);
    const last = await after(w, w.carol, id, 4, { limit: 2 });
    expect(bodies(last)).toEqual(["e"]);
    expect(last.nextCursor).toBeNull();
    // afterPosition takes precedence over page.
    expect(bodies(await after(w, w.carol, id, 3, { page: 1, limit: 2 }))).toEqual(["d", "e"]);
  });

  test("gives each viewer the posts they may see: moderated, deleted", async () => {
    const w = world();
    const id = await thread(w, ["visible"]);
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const waiting = await w.reply(w.carol, id, "waiting");
    expect(waiting.state).toBe("moderated");
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 0 WHERE id = ?1")
      .run(w.open.id);
    const doomed = await w.reply(w.bob, id, "doomed");
    await w.call("posts.delete", w.mod, { postId: doomed.id, reason: "x", notify: false });
    await w.reply(w.bob, id, "last");

    expect(bodies(await after(w, w.alice, id, 0))).toEqual(["visible", "last"]);
    expect(bodies(await after(w, GUEST, id, 0))).toEqual(["visible", "last"]);
    // The author sees their own unapproved post; moderators see every state.
    expect(bodies(await after(w, w.carol, id, 0))).toEqual(["visible", "waiting", "last"]);
    expect(bodies(await after(w, w.mod, id, 0))).toEqual(["visible", "waiting", "doomed", "last"]);
    // Positions 2 and 3 are hidden from a member who holds position 1: the poll skips them.
    expect(bodies(await after(w, w.alice, id, 1))).toEqual(["last"]);
    expect(bodies(await after(w, w.alice, id, 3))).toEqual(["last"]);
    expect(bodies(await after(w, w.alice, id, 4))).toEqual([]);
  });

  test("a thread the viewer cannot open is not found, a hidden one included", async () => {
    const w = world();
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    await w.reply(w.admin, secret.thread.id, "inside");
    await expect(after(w, w.carol, secret.thread.id, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(after(w, GUEST, secret.thread.id, 0)).rejects.toBeInstanceOf(NotFoundError);
    expect(bodies(await after(w, w.admin, secret.thread.id, 0))).toEqual(["inside"]);

    const id = await thread(w, ["x"]);
    await w.call("threads.delete", w.mod, { threadId: id, reason: "x", notify: false });
    await expect(after(w, w.carol, id, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(after(w, w.mod, id, 0)).resolves.toBeDefined();
    await expect(after(w, w.carol, 99999, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a merged-away thread is not found; the target lists the posts that came in", async () => {
    const w = world();
    const target = await thread(w, ["t1"]);
    const source = await thread(w, ["s1"]);
    const done = await w.call("threads.merge", w.mod, {
      threadId: target,
      sourceThreadIds: [source],
      reason: "x",
      notify: false,
    });
    expect(done.completed).toBe(true);
    await expect(after(w, w.carol, source, 0)).rejects.toBeInstanceOf(NotFoundError);
    const all = await after(w, w.carol, target, 0, { limit: 20 });
    expect(all.items.map((post) => post.position)).toEqual(
      Array.from({ length: all.items.length }, (_, i) => i + 1),
    );
    expect(all.items).toHaveLength(3);
  });

  test("a negative position is refused", async () => {
    const w = world();
    const id = await thread(w, []);
    await expect(after(w, w.carol, id, -1)).rejects.toBeInstanceOf(ValidationError);
    await expect(after(w, w.carol, id, 1.5)).rejects.toBeInstanceOf(ValidationError);
  });

  test("the page reads the thread's position index", () => {
    const w = world();
    expectNoTableScan(w.ctx, forumSql.postPage, [1, 5, 24, 0, 0, 1]);
    expectNoTableScan(w.ctx, forumSql.postBeyond, [1, 24, 0, 0, 1]);
    expectNoTableScan(w.ctx, forumSql.postAt, [1, 5]);
    expectNoTableScan(w.ctx, forumSql.decodedPostAt, [1, 5]);
  });
});
