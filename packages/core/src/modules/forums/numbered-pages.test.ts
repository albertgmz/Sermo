import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { setEntry } from "../permissions/group-fixture";
import {
  forumSql,
  ownThreadSql,
  threadsCreateOp,
  threadsDeleteOp,
  threadsListOp,
  threadsSetStickyOp,
} from "./index";

const MEMBERS = 2;

// A forum of seven threads by one member (t[0] oldest), one more pinned, three to a page.
async function forum() {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const authorUser = insertUser(ctx);
  const author = userActor(authorUser);
  const other = userActor(insertUser(ctx));
  const mod = userActor(insertUser(ctx, { groupId: 3 }));
  const thread = async (actor: Actor, extra: object = {}) => {
    ctx.clock.advance(60_000);
    return (
      await execute(ctx, threadsCreateOp, actor, {
        nodeId: node.id,
        title: "Title",
        body: "Body",
        ...extra,
      })
    ).thread;
  };
  const t: number[] = [];
  for (let i = 0; i < 7; i++) t.push((await thread(author)).id);
  const pinned = (await thread(author)).id;
  await execute(ctx, threadsSetStickyOp, mod, { threadId: pinned, isSticky: true });
  const list = (actor: Actor, input: object) =>
    execute(ctx, threadsListOp, actor, { nodeId: node.id, limit: 3, ...input } as never);
  const ids = (page: { items: { id: number }[] }) => page.items.map((item) => item.id);
  return { ctx, node, author, authorUser, other, mod, thread, t, pinned, list, ids };
}

describe("threads.list numbered pages", () => {
  test("pages run from the newest, sticky threads only on page 1 and not counted", async () => {
    const f = await forum();
    const [one, two, three, past] = await Promise.all(
      [1, 2, 3, 4].map((page) => f.list(f.other, { page })),
    );
    const t = f.t;
    expect(f.ids(one!)).toEqual([t[6]!, t[5]!, t[4]!]);
    expect(one!.sticky.map((s) => s.id)).toEqual([f.pinned]);
    expect(f.ids(two!)).toEqual([t[3]!, t[2]!, t[1]!]);
    expect(two!.sticky).toEqual([]);
    expect(f.ids(three!)).toEqual([t[0]!]);
    expect(three!.nextCursor).toBeNull();
    expect(f.ids(past!)).toEqual([]);
    for (const page of [one, two, three, past]) expect(page!.total).toBe(7);
    // The cursor of a numbered page goes on where the next numbered page starts.
    const next = await f.list(f.other, { cursor: one!.nextCursor });
    expect(f.ids(next)).toEqual(f.ids(two!));
    expect(next.total).toBeNull();
  });

  test("every numbered page, placed from the nearer end of the list, is the cursor walk's page", async () => {
    const f = await forum();
    await execute(f.ctx, threadsDeleteOp, f.mod, { threadId: f.t[1]! });
    for (const actor of [f.other, f.mod]) {
      const walked: number[][] = [];
      let cursor: string | undefined;
      do {
        const step = await f.list(actor, { limit: 2, cursor });
        walked.push(f.ids(step));
        cursor = step.nextCursor ?? undefined;
      } while (cursor);
      const numbered: number[][] = [];
      for (let number = 1; number <= walked.length; number++)
        numbered.push(f.ids(await f.list(actor, { limit: 2, page: number })));
      expect(numbered).toEqual(walked);
    }
  });

  test("deleted threads are counted and listed only for those who may see them", async () => {
    const f = await forum();
    await execute(f.ctx, threadsDeleteOp, f.mod, { threadId: f.t[5]! });
    const member = await f.list(f.other, { page: 1 });
    expect(member.total).toBe(6);
    expect(f.ids(member)).toEqual([f.t[6]!, f.t[4]!, f.t[3]!]);
    expect(f.ids(await f.list(f.other, { page: 2 }))).toEqual([f.t[2]!, f.t[1]!, f.t[0]!]);
    const staff = await f.list(f.mod, { page: 1 });
    expect(staff.total).toBe(7);
    expect(f.ids(staff)).toEqual([f.t[6]!, f.t[5]!, f.t[4]!]);
  });

  test("a thread held for approval counts for its author and moderators only", async () => {
    const f = await forum();
    f.ctx.sqlite
      .prepare("UPDATE nodes SET require_thread_approval = 1 WHERE id = ?1")
      .run(f.node.id);
    invalidate(f.ctx, "node_tree");
    const held = await f.thread(f.other);
    expect(held.state).toBe("moderated");
    const mine = await f.list(f.other, { page: 1 });
    expect(mine.total).toBe(8);
    expect(f.ids(mine)[0]).toBe(held.id);
    const someoneElse = await f.list(f.author, { page: 1 });
    expect(someoneElse.total).toBe(7);
    expect(f.ids(someoneElse)).not.toContain(held.id);
    expect((await f.list(f.mod, { page: 1 })).total).toBe(8);
  });

  test("a prefix narrows the pages and their total", async () => {
    const f = await forum();
    const admin = userActor(insertUser(f.ctx, { groupId: 4 }));
    const color = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM palette_colors WHERE kind = 'prefix' AND is_active = 1 ORDER BY position LIMIT 1",
      )
      .get()!.id;
    // biome-ignore lint/suspicious/noExplicitAny: an operation called by name is loosely typed
    const prefix: any = await execute(f.ctx, getOperation("threadPrefixes.create"), admin, {
      label: "News",
      colorId: color,
    });
    const tagged = [f.t[0], f.t[2], f.t[3], f.t[6]];
    f.ctx.sqlite
      .prepare("UPDATE threads SET prefix_id = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
      .run(prefix.id, JSON.stringify(tagged));
    const one = await f.list(f.other, { page: 1, prefixId: prefix.id });
    expect(one.total).toBe(4);
    expect(f.ids(one)).toEqual([f.t[6]!, f.t[3]!, f.t[2]!]);
    expect(f.ids(await f.list(f.other, { page: 2, prefixId: prefix.id }))).toEqual([f.t[0]!]);
    expect((await f.list(f.other, { page: 1 })).total).toBe(7);
  });

  test("where other members' threads are closed, only the viewer's own are paged and counted", async () => {
    const f = await forum();
    const own = [(await f.thread(f.other)).id, (await f.thread(f.other)).id];
    setEntry(f.ctx, MEMBERS, "forum.viewOthers", -1, f.node.id);
    const page = await f.list(f.other, { page: 1 });
    expect(page.total).toBe(2);
    expect(f.ids(page)).toEqual([own[1]!, own[0]!]);
    expect(f.ids(await f.list(f.other, { page: 2 }))).toEqual([]);
  });

  test("the numbered page reads seek an index", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, forumSql.threadKey, [1, 0, 0, 1, 40]);
    expectNoTableScan(ctx, forumSql.threadKeyByPrefix, [1, 0, 0, 1, 40, 3]);
    // The pages nearer the oldest thread are placed from that end, through the same index.
    expectNoTableScan(ctx, forumSql.threadKeyFromOldest, [1, 0, 0, 1, 40]);
    expectNoTableScan(ctx, forumSql.threadKeyByPrefixFromOldest, [1, 0, 0, 1, 40, 3]);
    expect(forumSql.threadKeyFromOldest).toContain("ORDER BY sort_at, id LIMIT 1 OFFSET ?5");
    expectNoTableScan(ctx, forumSql.threadCount, [1, 0, 0, 1]);
    expectNoTableScan(ctx, forumSql.threadCountByPrefix, [1, 0, 0, 1, 3]);
    expectNoTableScan(ctx, forumSql.nodeThreadCount, [1]);
    expectNoTableScan(ctx, forumSql.visibleStickyCount, [1]);
    expectNoTableScan(ctx, forumSql.hiddenThreadCount, [1, "deleted", 1, 1]);
    // The viewer's own threads, through the author index and sorted, as their listing is.
    const own = { allowTempBTree: true };
    expectNoTableScan(ctx, ownThreadSql.threadKey, [1, 0, 0, 1, 40], own);
    expectNoTableScan(ctx, ownThreadSql.threadKeyByPrefix, [1, 0, 0, 1, 40, 3], own);
    expectNoTableScan(ctx, ownThreadSql.threadCount, [1, 0, 0, 1], own);
    expectNoTableScan(ctx, ownThreadSql.threadCountByPrefix, [1, 0, 0, 1, 3], own);
    for (const key of [
      "threadKey",
      "threadKeyByPrefix",
      "threadCount",
      "threadCountByPrefix",
    ] as const)
      expect(ownThreadSql[key]).toContain("INDEXED BY threads_user_id WHERE user_id = ?4");
  });
});
