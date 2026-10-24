import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { conversationsCreateOp, conversationsLeaveOp } from "../conversations";
import { threadsCreateOp, threadsDeleteOp, threadsMoveOp } from "../forums";
import { bookmarksListOp, bookmarksSetOp } from "./index";

function fixture() {
  const ctx = createTestContext();
  const author = userActor(insertUser(ctx));
  const readerUser = insertUser(ctx);
  const reader = userActor(readerUser);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const forum = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  return { ctx, author, reader, readerUser, moderator, forum };
}
type Fixture = ReturnType<typeof fixture>;

const thread = async (f: Fixture, nodeId = f.forum.id) => {
  f.ctx.clock.advance(1000);
  return (await execute(f.ctx, threadsCreateOp, f.author, { nodeId, title: "T", body: "body" }))
    .thread.id;
};
const mark = (
  f: Fixture,
  actor: Fixture["reader"],
  contentType: "thread" | "conversation",
  contentId: number,
) => {
  f.ctx.clock.advance(1000);
  return execute(f.ctx, bookmarksSetOp, actor, { contentType, contentId, bookmarked: true });
};
const page = (f: Fixture, actor: Fixture["reader"], number: number, limit = 2) =>
  execute(f.ctx, bookmarksListOp, actor, { page: number, limit });
const contentIds = (list: { items: { contentId: number }[] }) =>
  list.items.map((item) => item.contentId);
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

describe("bookmarks.list numbered pages", () => {
  test("first, middle and last page, newest first, with the count of what the viewer can see", async () => {
    const f = fixture();
    const made: number[] = [];
    for (let i = 0; i < 5; i++) {
      made.push(await thread(f));
      await mark(f, f.reader, "thread", made[i]!);
    }
    const [one, two, three, four] = await Promise.all(
      [1, 2, 3, 4].map((n) => page(f, f.reader, n)),
    );
    expect(contentIds(one!)).toEqual([made[4]!, made[3]!]);
    expect(contentIds(two!)).toEqual([made[2]!, made[1]!]);
    expect(contentIds(three!)).toEqual([made[0]!]);
    expect(contentIds(four!)).toEqual([]);
    for (const list of [one, two, three, four]) expect(list!.total).toBe(5);
    expect(one!.nextCursor).not.toBeNull();
    expect(three!.nextCursor).toBeNull();
    // The cursor goes on from the page's last bookmark; a walk by cursor carries no count.
    const next = await execute(f.ctx, bookmarksListOp, f.reader, {
      cursor: one!.nextCursor!,
      limit: 2,
    });
    expect(contentIds(next)).toEqual(contentIds(two!));
    expect(next.total).toBeNull();
    expect((await execute(f.ctx, bookmarksListOp, f.reader, { limit: 2 })).total).toBeNull();
  });

  test("an item the viewer cannot see is neither shown nor counted, and each viewer has their own total", async () => {
    const f = fixture();
    const secret = insertNode(f.ctx, {});
    invalidate(f.ctx, "node_tree");
    const open = await thread(f);
    const inSecret = await thread(f, secret.id);
    const deleted = await thread(f);
    const left = (
      await execute(f.ctx, conversationsCreateOp, f.author, {
        title: "Private",
        recipientIds: [f.readerUser.id],
        body: "hello",
      })
    ).conversation.id;
    const lastOpen = await thread(f);
    for (const [type, id] of [
      ["thread", open],
      ["thread", inSecret],
      ["thread", deleted],
      ["conversation", left],
      ["thread", lastOpen],
    ] as const) {
      await mark(f, f.reader, type, id);
      if (type === "thread") await mark(f, f.moderator, type, id);
    }
    hideNode(f, secret.id);
    await execute(f.ctx, threadsDeleteOp, f.moderator, { threadId: deleted });
    await execute(f.ctx, conversationsLeaveOp, f.reader, { conversationId: left });
    // Moved out of sight, then back: the bookmark follows the thread.
    await execute(f.ctx, threadsMoveOp, f.moderator, { threadId: open, nodeId: secret.id });
    await execute(f.ctx, threadsMoveOp, f.moderator, { threadId: open, nodeId: f.forum.id });

    const mine = await page(f, f.reader, 1, 20);
    expect(contentIds(mine)).toEqual([lastOpen, open]);
    expect(mine.total).toBe(2);
    // Two items on a page of one: the second page holds the second, the count is the same.
    const second = await page(f, f.reader, 2, 1);
    expect(contentIds(second)).toEqual([open]);
    expect(second.total).toBe(2);
    // The moderator sees the deleted thread and the one in the hidden forum as well.
    const staff = await page(f, f.moderator, 1, 20);
    expect(staff.total).toBe(4);
    expect(contentIds(staff)).toEqual([lastOpen, deleted, inSecret, open]);
  });

  test("the numbered pages hold the newest bookmarks found within the scan, and a cursor goes on", async () => {
    const f = fixture();
    const only = await thread(f);
    await mark(f, f.reader, "thread", only);
    // Many bookmarks of threads that do not exist, newer than the one that does.
    const insert = f.ctx.sqlite.prepare(
      "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', ?2, 1)",
    );
    for (let i = 0; i < 350; i++) insert.run(f.readerUser.id, 100000 + i);
    // Newer than the 350 above they are not (the table orders by id), so the real one is last.
    const list = await page(f, f.reader, 1, 5);
    expect(contentIds(list)).toEqual([only]);
    expect(list.total).toBe(1);
    expect(list.nextCursor).toBeNull();
  });
});
