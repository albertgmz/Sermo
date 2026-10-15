import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { fillPosts, type World, world } from "../feed/fixtures.test";
import { setEntry } from "../permissions/group-fixture";
import { forumSql } from "./index";

const MEMBERS = 2;
const grant = (w: World, key: string, nodeId = 0) => setEntry(w.ctx, MEMBERS, key, 1, nodeId);
const logged = (w: World, action: string) =>
  w.ctx.sqlite
    .prepare<{ n: number }, [string]>("SELECT count(*) AS n FROM moderator_log WHERE action = ?1")
    .get(action)!.n;
const threadRow = (w: World, id: number) =>
  w.ctx.sqlite
    .prepare<{ state: string; is_locked: number; reply_count: number } | null, [number]>(
      "SELECT state, is_locked, reply_count FROM threads WHERE id = ?1",
    )
    .get(id);
const postState = (w: World, id: number) =>
  w.ctx.sqlite
    .prepare<{ state: string } | null, [number]>("SELECT state FROM posts WHERE id = ?1")
    .get(id)?.state ?? null;
const counts = (w: World, userId: number) =>
  w.ctx.sqlite
    .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
    .get(userId)!.post_count;

describe("forum.deleteOwnThread", () => {
  test("is off for members until a group is given it, and then hides only their own thread", async () => {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs");
    await expect(w.call("threads.delete", w.alice, { threadId: mine.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(
      (await w.call("threads.get", w.alice, { threadId: mine.thread.id })).permissions.canDelete,
    ).toBe(false);
    grant(w, "forum.deleteOwnThread");
    expect(
      (await w.call("threads.get", w.alice, { threadId: mine.thread.id })).permissions.canDelete,
    ).toBe(true);
    expect(
      (await w.call("threads.get", w.alice, { threadId: theirs.thread.id })).permissions.canDelete,
    ).toBe(false);
    await expect(w.call("threads.delete", w.alice, { threadId: theirs.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
    await w.call("threads.delete", w.alice, { threadId: mine.thread.id });
    expect(threadRow(w, mine.thread.id)!.state).toBe("deleted");
    expect(threadRow(w, theirs.thread.id)!.state).toBe("visible");
    // A member hiding their own thread leaves no moderator log entry, as with posts.
    expect(logged(w, "thread.delete")).toBe(0);
    // Guests are asked to sign in; staff restore it.
    await expect(
      w.call("threads.delete", { kind: "guest" }, { threadId: theirs.thread.id }),
    ).rejects.toThrow(UnauthenticatedError);
    await w.call("threads.restore", w.mod, { threadId: mine.thread.id });
    expect(threadRow(w, mine.thread.id)!.state).toBe("visible");
  });

  test("a locked thread cannot be hidden by its author, and staff still can", async () => {
    const w = world();
    grant(w, "forum.deleteOwnThread");
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    await w.call("threads.setLocked", w.mod, { threadId: mine.thread.id, isLocked: true });
    await expect(w.call("threads.delete", w.alice, { threadId: mine.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
    await w.call("threads.delete", w.mod, { threadId: mine.thread.id });
    expect(logged(w, "thread.delete")).toBe(1);
  });

  test("a batch judges each thread with the same rule", async () => {
    const w = world();
    grant(w, "forum.deleteOwnThread");
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs");
    const result = await w.call("threads.batchUpdate", w.alice, {
      threadIds: [mine.thread.id, theirs.thread.id],
      update: { action: "delete" },
    });
    expect(result.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, false]);
    expect(result.results[1].error.code).toBe("forbidden");
    expect(threadRow(w, mine.thread.id)!.state).toBe("deleted");
  });

  test("a forum entry overrides the global one", async () => {
    const w = world();
    grant(w, "forum.deleteOwnThread");
    setEntry(w.ctx, MEMBERS, "forum.deleteOwnThread", -1, w.open.id);
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    await expect(w.call("threads.delete", w.alice, { threadId: mine.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("forum.lockOwn", () => {
  test("an author with it locks and unlocks their own thread and nobody else's", async () => {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs");
    await expect(
      w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: true }),
    ).rejects.toThrow(ForbiddenError);
    grant(w, "forum.lockOwn");
    expect(
      (await w.call("threads.get", w.alice, { threadId: mine.thread.id })).permissions.canLock,
    ).toBe(true);
    await w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: true });
    expect(threadRow(w, mine.thread.id)!.is_locked).toBe(1);
    expect(logged(w, "thread.lock")).toBe(1);
    await w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: false });
    expect(threadRow(w, mine.thread.id)!.is_locked).toBe(0);
    await expect(
      w.call("threads.setLocked", w.alice, { threadId: theirs.thread.id, isLocked: true }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("threads.setLocked", { kind: "guest" }, { threadId: mine.thread.id, isLocked: true }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  test("a lock staff set stays: the author cannot lift it, nor take it over by locking again", async () => {
    const w = world();
    grant(w, "forum.lockOwn");
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    await w.call("threads.setLocked", w.mod, { threadId: mine.thread.id, isLocked: true });
    expect(
      (await w.call("threads.get", w.alice, { threadId: mine.thread.id })).permissions.canLock,
    ).toBe(false);
    await expect(
      w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: false }),
    ).rejects.toThrow(ForbiddenError);
    const before = logged(w, "thread.lock");
    await w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: true });
    expect(logged(w, "thread.lock")).toBe(before);
    await expect(
      w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: false }),
    ).rejects.toThrow(ForbiddenError);
    expect(threadRow(w, mine.thread.id)!.is_locked).toBe(1);
    await w.call("threads.setLocked", w.mod, { threadId: mine.thread.id, isLocked: false });
  });

  test("a lock the author set and staff then lifted and set again is staff's", async () => {
    const w = world();
    grant(w, "forum.lockOwn");
    const mine = await w.thread(w.alice, w.open.id, "Mine");
    await w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: true });
    await w.call("threads.setLocked", w.mod, { threadId: mine.thread.id, isLocked: false });
    await w.call("threads.setLocked", w.mod, { threadId: mine.thread.id, isLocked: true });
    await expect(
      w.call("threads.setLocked", w.alice, { threadId: mine.thread.id, isLocked: false }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("the lock lookup is an index seek on the log", () => {
    const w = world();
    expectNoTableScan(w.ctx, forumSql.newestLock, [1]);
  });
});

describe("forum.hardDeleteOwn", () => {
  test("hide and delete for good are separate: hiding alone cannot erase", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.alice, t.thread.id, "Mine");
    await w.call("posts.delete", w.alice, { postId: reply.id });
    expect(postState(w, reply.id)).toBe("deleted");
    const other = await w.reply(w.alice, t.thread.id, "Another");
    await expect(w.call("posts.hardDelete", w.alice, { postId: other.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(postState(w, other.id)).toBe("visible");
  });

  test("an author with it removes their own reply in one step and the figures follow", async () => {
    const w = world();
    grant(w, "forum.hardDeleteOwn");
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.alice, t.thread.id, "Mine");
    const theirs = await w.reply(w.bob, t.thread.id, "Theirs");
    expect(threadRow(w, t.thread.id)!.reply_count).toBe(2);
    const posts = counts(w, w.aliceUser.id);
    expect(
      (await w.call("posts.list", w.alice, { threadId: t.thread.id })).items[1].canHardDelete,
    ).toBe(true);
    await w.call("posts.hardDelete", w.alice, { postId: reply.id });
    expect(postState(w, reply.id)).toBeNull();
    expect(threadRow(w, t.thread.id)!.reply_count).toBe(1);
    expect(counts(w, w.aliceUser.id)).toBe(posts - 1);
    expect(logged(w, "post.hardDelete")).toBe(1);
    // Someone else's post, the opening post and a guest are refused.
    await expect(w.call("posts.hardDelete", w.alice, { postId: theirs.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("posts.hardDelete", w.alice, { postId: t.post.id })).rejects.toThrow();
    await expect(
      w.call("posts.hardDelete", { kind: "guest" }, { postId: theirs.id }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  test("never in a locked thread, and never what staff hid", async () => {
    const w = world();
    grant(w, "forum.hardDeleteOwn");
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.alice, t.thread.id, "Mine");
    const hidden = await w.reply(w.alice, t.thread.id, "Hidden");
    await w.call("posts.delete", w.mod, { postId: hidden.id });
    // The author cannot open a post staff hid, so it is not found.
    await expect(w.call("posts.hardDelete", w.alice, { postId: hidden.id })).rejects.toThrow(
      NotFoundError,
    );
    await w.call("threads.setLocked", w.mod, { threadId: t.thread.id, isLocked: true });
    await expect(w.call("posts.hardDelete", w.alice, { postId: reply.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(postState(w, reply.id)).toBe("visible");
    expect((await w.call("posts.get", w.alice, { postId: reply.id })).canHardDelete).toBe(false);
  });

  test("staff keep the two-step rule, and an administrator can still erase hidden content", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "Theirs");
    await expect(w.call("posts.hardDelete", w.admin, { postId: reply.id })).rejects.toThrow(
      ConflictError,
    );
    await w.call("posts.delete", w.admin, { postId: reply.id });
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    expect(postState(w, reply.id)).toBeNull();
  });

  test("an author removes a whole thread that is only theirs", async () => {
    const w = world();
    grant(w, "forum.hardDeleteOwn");
    const t = await w.thread(w.alice, w.open.id, "Gone");
    await w.reply(w.alice, t.thread.id, "More");
    const result = await w.call("threads.hardDelete", w.alice, { threadId: t.thread.id });
    expect(result).toEqual({ completed: true, removedPosts: 2 });
    expect(threadRow(w, t.thread.id)).toBeNull();
    const node = w.ctx.sqlite
      .prepare<{ thread_count: number; post_count: number }, [number]>(
        "SELECT thread_count, post_count FROM nodes WHERE id = ?1",
      )
      .get(w.open.id)!;
    expect(node).toEqual({ thread_count: 0, post_count: 0 });
    expect(counts(w, w.aliceUser.id)).toBe(0);
  });

  test("a thread holding other members' posts, a long one, and someone else's are refused", async () => {
    const w = world();
    grant(w, "forum.hardDeleteOwn");
    const shared = await w.thread(w.alice, w.open.id, "Shared");
    await w.reply(w.bob, shared.thread.id, "Hello");
    await expect(
      w.call("threads.hardDelete", w.alice, { threadId: shared.thread.id }),
    ).rejects.toThrow(ConflictError);
    const long = await w.thread(w.alice, w.open.id, "Long");
    fillPosts(w.ctx, long.thread.id, w.aliceUser.id, 501);
    await expect(
      w.call("threads.hardDelete", w.alice, { threadId: long.thread.id }),
    ).rejects.toThrow(ConflictError);
    // Nothing of the refused attempts stuck.
    expect(threadRow(w, shared.thread.id)!.state).toBe("visible");
    expect(threadRow(w, long.thread.id)!.state).toBe("visible");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs");
    await expect(
      w.call("threads.hardDelete", w.alice, { threadId: theirs.thread.id }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("threads.setLocked", w.mod, { threadId: long.thread.id, isLocked: true });
    await expect(
      w.call("threads.hardDelete", w.alice, { threadId: long.thread.id }),
    ).rejects.toThrow(ForbiddenError);
  });
});
