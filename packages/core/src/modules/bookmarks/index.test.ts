import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { conversationsCreateOp, conversationsLeaveOp } from "../conversations";
import {
  postsCreateOp,
  postsDeleteOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsMoveOp,
} from "../forums";
import { bookmarksListOp, bookmarksSetOp, bookmarksSql, bookmarksStatusOp } from "./index";

function fixture() {
  const ctx = createTestContext();
  const author = userActor(insertUser(ctx));
  const reader = userActor(insertUser(ctx));
  const other = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const forum = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  return { ctx, author, reader, other, moderator, forum };
}
type Fixture = ReturnType<typeof fixture>;
type Actor = Fixture["author"];
type Type = "thread" | "post" | "conversation";

const set = (f: Fixture, actor: Actor, contentType: Type, contentId: number, bookmarked = true) =>
  execute(f.ctx, bookmarksSetOp, actor, { contentType, contentId, bookmarked });
const list = (f: Fixture, actor: Actor, more: Record<string, unknown> = {}) =>
  execute(f.ctx, bookmarksListOp, actor, { limit: 20, ...more });
const status = (f: Fixture, actor: Actor, contentType: Type, ids: number[]) =>
  execute(f.ctx, bookmarksStatusOp, actor, { contentType, ids }).then((r) => r.bookmarked);
const thread = (f: Fixture, nodeId = f.forum.id, body = "First body") =>
  execute(f.ctx, threadsCreateOp, f.author, { nodeId, title: "A thread", body });
const hideNode = (f: Fixture, nodeId: number) => {
  f.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'node.view'), ?1, 2, 0, -1)",
    )
    .run(nodeId);
  f.ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
};
const conversation = (f: Fixture) =>
  execute(f.ctx, conversationsCreateOp, f.author, {
    title: "Private",
    recipientIds: [(f.reader as { userId: number }).userId],
    body: "hello",
  }).then((r) => r.conversation.id);

describe("bookmarks.set and bookmarks.status", () => {
  test("a member bookmarks and removes each type, repeating is harmless", async () => {
    const f = fixture();
    const made = await thread(f);
    const reply = await execute(f.ctx, postsCreateOp, f.author, {
      threadId: made.thread.id,
      body: "Second",
    });
    const conv = await conversation(f);
    for (const [type, id] of [
      ["thread", made.thread.id],
      ["post", reply.id],
      ["conversation", conv],
    ] as const) {
      expect(await status(f, f.reader, type, [id])).toEqual([]);
      await set(f, f.reader, type, id);
      await set(f, f.reader, type, id);
      expect(await status(f, f.reader, type, [id, id + 1000])).toEqual([id]);
      expect(await status(f, f.other, type, [id])).toEqual([]);
      await set(f, f.reader, type, id, false);
      await set(f, f.reader, type, id, false);
      expect(await status(f, f.reader, type, [id])).toEqual([]);
    }
    const count = f.ctx.sqlite
      .prepare<{ n: number }, []>("SELECT count(*) AS n FROM bookmarks")
      .get()!.n;
    expect(count).toBe(0);
  });

  test("types do not mix: a thread bookmark is not a post bookmark with the same id", async () => {
    const f = fixture();
    const made = await thread(f);
    await set(f, f.reader, "thread", made.thread.id);
    expect(await status(f, f.reader, "post", [made.thread.id])).toEqual([]);
  });

  test("guests cannot set and get an empty status", async () => {
    const f = fixture();
    const made = await thread(f);
    await expect(set(f, GUEST, "thread", made.thread.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await status(f, GUEST, "thread", [made.thread.id])).toEqual([]);
    await expect(list(f, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("an item the viewer cannot see is not found", async () => {
    const f = fixture();
    const hidden = insertNode(f.ctx, {});
    invalidate(f.ctx, "node_tree");
    const inHidden = await thread(f, hidden.id);
    const visibleThread = await thread(f);
    const reply = await execute(f.ctx, postsCreateOp, f.author, {
      threadId: visibleThread.thread.id,
      body: "Reply",
    });
    const deletedThread = await thread(f);
    await execute(f.ctx, threadsDeleteOp, f.moderator, { threadId: deletedThread.thread.id });
    await execute(f.ctx, postsDeleteOp, f.moderator, { postId: reply.id });
    const conv = await conversation(f);
    hideNode(f, hidden.id);

    for (const [type, id] of [
      ["thread", inHidden.thread.id],
      ["post", inHidden.post.id],
      ["thread", deletedThread.thread.id],
      ["post", reply.id],
      ["thread", 99999],
      ["post", 99999],
      ["conversation", conv],
      ["conversation", 99999],
    ] as const) {
      const viewer = type === "conversation" && id === conv ? f.other : f.reader;
      await expect(set(f, viewer, type, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Staff who may see deleted content can bookmark it; the member who may not, cannot.
    await set(f, f.moderator, "thread", deletedThread.thread.id);
    await set(f, f.moderator, "post", reply.id);
    // A participant can; after leaving, a new bookmark is refused.
    await set(f, f.reader, "conversation", conv);
    await execute(f.ctx, conversationsLeaveOp, f.reader, { conversationId: conv });
    await set(f, f.reader, "conversation", conv, false);
    await expect(set(f, f.reader, "conversation", conv)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a bookmark on an item since hidden can still be removed", async () => {
    const f = fixture();
    const made = await thread(f);
    await set(f, f.reader, "thread", made.thread.id);
    await execute(f.ctx, threadsDeleteOp, f.moderator, { threadId: made.thread.id });
    await set(f, f.reader, "thread", made.thread.id, false);
    expect(await status(f, f.reader, "thread", [made.thread.id])).toEqual([]);
  });

  test("hot queries use an index", () => {
    const f = fixture();
    expectNoTableScan(f.ctx, bookmarksSql.status, [1, "thread", "[1,2]"]);
    expectNoTableScan(f.ctx, bookmarksSql.page, [1, 100, 20]);
    expectNoTableScan(f.ctx, bookmarksSql.remove, [1, "thread", 1]);
    expectNoTableScan(f.ctx, bookmarksSql.posts, ["[1,2]"]);
    expectNoTableScan(f.ctx, bookmarksSql.conversations, [1, "[1,2]"]);
    expectNoTableScan(f.ctx, bookmarksSql.conversationOne, [1, 1]);
  });
});

describe("bookmarks.list", () => {
  test("lists every type newest first with title, author, position and excerpt", async () => {
    const f = fixture();
    const made = await thread(
      f,
      f.forum.id,
      "Opening [B]words[/B] with [ISPOILER]a secret[/ISPOILER] inside",
    );
    const reply = await execute(f.ctx, postsCreateOp, f.other, {
      threadId: made.thread.id,
      body: "Reply [spoiler]hidden[/spoiler] visible text",
    });
    const conv = await conversation(f);
    await set(f, f.reader, "thread", made.thread.id);
    await set(f, f.reader, "post", reply.id);
    await set(f, f.reader, "conversation", conv);

    const page = await list(f, f.reader);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.contentType)).toEqual(["conversation", "post", "thread"]);
    const [c, p, t] = page.items;
    expect(c).toMatchObject({
      contentId: conv,
      title: "Private",
      threadId: null,
      postPosition: null,
      excerpt: "",
      author: { id: (f.author as { userId: number }).userId },
    });
    expect(p).toMatchObject({
      contentId: reply.id,
      title: "A thread",
      threadId: made.thread.id,
      postPosition: 1,
      author: { id: (f.other as { userId: number }).userId },
    });
    expect(p!.excerpt).toContain("visible text");
    expect(p!.excerpt).not.toContain("hidden[");
    expect(p!.excerpt).not.toContain("hidden ");
    expect(t).toMatchObject({ contentId: made.thread.id, threadId: made.thread.id });
    expect(t!.excerpt).toContain("Opening words");
    expect(t!.excerpt).not.toContain("secret");
    expect(await list(f, f.other)).toEqual({ items: [], nextCursor: null });
  });

  test("pages by keyset", async () => {
    const f = fixture();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const made = await thread(f);
      ids.push(made.thread.id);
      await set(f, f.reader, "thread", made.thread.id);
    }
    const first = await list(f, f.reader, { limit: 2 });
    expect(first.items.map((item) => item.contentId)).toEqual([ids[2]!, ids[1]!]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(f, f.reader, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.contentId)).toEqual([ids[0]!]);
    expect(second.nextCursor).toBeNull();
  });

  test("skips items the viewer can no longer see and each viewer sees their own view", async () => {
    const f = fixture();
    const moved = insertNode(f.ctx, {});
    invalidate(f.ctx, "node_tree");
    const keep = await thread(f);
    const toHide = await thread(f);
    const toDelete = await thread(f);
    const post = await execute(f.ctx, postsCreateOp, f.author, {
      threadId: keep.thread.id,
      body: "later deleted",
    });
    const conv = await conversation(f);
    for (const [type, id] of [
      ["thread", keep.thread.id],
      ["thread", toHide.thread.id],
      ["thread", toDelete.thread.id],
      ["post", post.id],
      ["conversation", conv],
    ] as const) {
      await set(f, f.reader, type, id);
      await set(f, f.moderator, type === "conversation" ? "thread" : type, id);
    }
    await execute(f.ctx, threadsMoveOp, f.moderator, {
      threadId: toHide.thread.id,
      nodeId: moved.id,
    });
    hideNode(f, moved.id);
    await execute(f.ctx, threadsDeleteOp, f.moderator, { threadId: toDelete.thread.id });
    await execute(f.ctx, postsDeleteOp, f.moderator, { postId: post.id });
    await execute(f.ctx, conversationsLeaveOp, f.reader, { conversationId: conv });

    const mine = await list(f, f.reader);
    expect(mine.items.map((item) => [item.contentType, item.contentId])).toEqual([
      ["thread", keep.thread.id],
    ]);
    expect(mine.nextCursor).toBeNull();
    const staff = await list(f, f.moderator);
    expect(staff.items.map((item) => item.contentId)).toEqual(
      expect.arrayContaining([toDelete.thread.id, post.id]),
    );
  });

  test("a scan limit gives a short page with a cursor that continues", async () => {
    const f = fixture();
    const visibleThread = await thread(f);
    await set(f, f.reader, "thread", visibleThread.thread.id);
    const insert = f.ctx.sqlite.prepare(
      "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', ?2, 1)",
    );
    const userId = (f.reader as { userId: number }).userId;
    for (let i = 0; i < 350; i++) insert.run(userId, 100000 + i);
    const short = await list(f, f.reader, { limit: 5 });
    expect(short.items).toEqual([]);
    expect(short.nextCursor).not.toBeNull();
    const rest = await list(f, f.reader, { limit: 5, cursor: short.nextCursor });
    expect(rest.items.map((item) => item.contentId)).toEqual([visibleThread.thread.id]);
    expect(rest.nextCursor).toBeNull();
  });

  test("list queries are bounded by the index", () => {
    const f = fixture();
    expectNoTableScan(f.ctx, bookmarksSql.page, [1, Number.MAX_SAFE_INTEGER, 100]);
    expectNoTableScan(f.ctx, bookmarksSql.mergedAmong, ["[1,2]"]);
    expectNoTableScan(f.ctx, bookmarksSql.mergedBookmarks, [1, 2000]);
  });
});

describe("bookmarks edge cases", () => {
  test("a merged thread is bookmarked and listed as the thread it became", async () => {
    const f = fixture();
    const old = await thread(f);
    const target = await thread(f);
    const other = await thread(f);
    await set(f, f.reader, "thread", old.thread.id);
    await set(f, f.reader, "thread", other.thread.id);
    f.ctx.sqlite
      .prepare("UPDATE threads SET state = 'deleted', merged_into_id = ?1 WHERE id = ?2")
      .run(target.thread.id, old.thread.id);

    const page = await list(f, f.reader);
    expect(page.items.map((item) => [item.contentId, item.threadId])).toEqual([
      [other.thread.id, other.thread.id],
      [old.thread.id, target.thread.id],
    ]);
    // Row id and cursor stay the row's own.
    const rowId = page.items[1]!.id;
    const first = await list(f, f.reader, { limit: 1 });
    const second = await list(f, f.reader, { limit: 1, cursor: first.nextCursor });
    expect(second.items[0]).toMatchObject({ id: rowId, contentId: old.thread.id });

    // Bookmarking the old id stores the target; removing by the old id clears both rows.
    await set(f, f.other, "thread", old.thread.id);
    expect(await status(f, f.other, "thread", [old.thread.id, target.thread.id])).toEqual([
      target.thread.id,
    ]);
    await set(f, f.other, "thread", old.thread.id, false);
    expect(await status(f, f.other, "thread", [target.thread.id])).toEqual([]);
    // A chain is followed to its end.
    const last = await thread(f);
    f.ctx.sqlite
      .prepare("UPDATE threads SET merged_into_id = ?1 WHERE id = ?2")
      .run(last.thread.id, target.thread.id);
    expect((await list(f, f.reader)).items[1]!.threadId).toBe(last.thread.id);
    await set(f, f.other, "thread", old.thread.id);
    expect(await status(f, f.other, "thread", [last.thread.id])).toEqual([last.thread.id]);
  });

  test("a bookmark made before a merge is reported as the thread it became, and removing it clears it", async () => {
    const f = fixture();
    const first = await thread(f);
    const second = await thread(f);
    const target = await thread(f);
    const unrelated = await thread(f);
    const elsewhere = await thread(f);
    for (const made of [first, second, unrelated]) await set(f, f.reader, "thread", made.thread.id);
    const merge = (from: number, into: number) =>
      f.ctx.sqlite
        .prepare("UPDATE threads SET state = 'deleted', merged_into_id = ?1 WHERE id = ?2")
        .run(into, from);
    expect(await status(f, f.reader, "thread", [target.thread.id])).toEqual([]);
    merge(first.thread.id, target.thread.id);
    merge(second.thread.id, first.thread.id);
    merge(unrelated.thread.id, elsewhere.thread.id);
    // The rows are still under the old ids; the answer names the thread they became.
    expect(await status(f, f.reader, "thread", [target.thread.id])).toEqual([target.thread.id]);
    expect(await status(f, f.reader, "thread", [second.thread.id])).toEqual([target.thread.id]);
    expect(
      await status(f, f.reader, "thread", [target.thread.id, elsewhere.thread.id, 999_999]),
    ).toEqual([target.thread.id, elsewhere.thread.id]);
    expect(await status(f, f.other, "thread", [target.thread.id])).toEqual([]);
    // Other kinds of item are untouched.
    expect(await status(f, f.reader, "post", [target.thread.id])).toEqual([]);
    // Removing it clears the rows of every thread merged into it, and no other.
    await set(f, f.reader, "thread", target.thread.id, false);
    expect(await status(f, f.reader, "thread", [target.thread.id])).toEqual([]);
    expect(await status(f, f.reader, "thread", [elsewhere.thread.id])).toEqual([
      elsewhere.thread.id,
    ]);
  });

  test("moderated content is the author's alone", async () => {
    const f = fixture();
    const made = await thread(f);
    const reply = await execute(f.ctx, postsCreateOp, f.author, {
      threadId: made.thread.id,
      body: "Waiting",
    });
    f.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(reply.id);
    await expect(set(f, f.other, "post", reply.id)).rejects.toBeInstanceOf(NotFoundError);
    await set(f, f.author, "post", reply.id);
    expect((await list(f, f.author)).items.map((item) => item.contentId)).toEqual([reply.id]);
    // Bookmarked by someone who could see it, it is skipped for another member.
    await set(f, f.moderator, "post", reply.id);
    expect((await list(f, f.moderator)).items).toHaveLength(1);

    const pending = await thread(f);
    f.ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(pending.thread.id);
    await expect(set(f, f.other, "thread", pending.thread.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await set(f, f.author, "thread", pending.thread.id);
    expect((await list(f, f.author)).items.map((item) => item.contentId)).toEqual([
      pending.thread.id,
      reply.id,
    ]);
    await set(f, f.moderator, "thread", pending.thread.id);
    f.ctx.sqlite
      .prepare(
        "INSERT OR IGNORE INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', ?2, 1)",
      )
      .run((f.other as { userId: number }).userId, pending.thread.id);
    expect((await list(f, f.other)).items).toEqual([]);
  });

  test("a banned viewer sees nothing and cannot bookmark", async () => {
    const f = fixture();
    const made = await thread(f);
    await set(f, f.reader, "thread", made.thread.id);
    const userId = (f.reader as { userId: number }).userId;
    f.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(userId);
    const banned = userActor({ id: userId, groupId: 2 });
    expect((await list(f, banned)).items).toEqual([]);
    await expect(set(f, banned, "thread", made.thread.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a deleted author is shown as the deleted user", async () => {
    const f = fixture();
    const made = await thread(f);
    await set(f, f.reader, "thread", made.thread.id);
    f.ctx.sqlite.exec("PRAGMA foreign_keys = OFF");
    f.ctx.sqlite.prepare("UPDATE threads SET user_id = 999999 WHERE id = ?1").run(made.thread.id);
    const [item] = (await list(f, f.reader)).items;
    expect(item!.author).toMatchObject({ id: 999999, username: "User #999999" });
  });

  test("a mixed page of visible and skipped rows pages without duplicates", async () => {
    const f = fixture();
    const kept: number[] = [];
    for (let i = 0; i < 6; i++) {
      const made = await thread(f);
      await set(f, f.reader, "thread", made.thread.id);
      if (i % 2 === 0) {
        await execute(f.ctx, threadsDeleteOp, f.moderator, { threadId: made.thread.id });
      } else kept.push(made.thread.id);
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page: Awaited<ReturnType<typeof list>> = await list(f, f.reader, {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((item) => item.contentId));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(kept.reverse());
  });
});
