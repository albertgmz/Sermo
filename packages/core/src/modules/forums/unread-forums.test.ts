import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError } from "../../errors";
import { fillThreads, world } from "../feed/fixtures.test";
import { setEntry } from "../permissions/group-fixture";
import { readMarkSql, UNREAD_SCAN } from "./read-marks";

async function scene() {
  const w = world();
  const sub = insertNode(w.ctx, { parentId: w.open.id, title: "Sub" });
  const other = insertNode(w.ctx, { parentId: w.category.id, title: "Other" });
  invalidate(w.ctx, "node_tree");
  const a = (await w.thread(w.bob, w.open.id, "A")).thread;
  await w.thread(w.bob, sub.id, "S");
  const unread = async (actor: Parameters<typeof w.call>[1]) =>
    ((await w.call("nodes.unread", actor, {})).nodeIds as number[]).sort((x, y) => x - y);
  return { w, sub, other, a, unread };
}

describe("nodes.unread", () => {
  test("lists the forums with a thread the viewer has not read; a guest gets none", async () => {
    const { w, sub, unread } = await scene();
    expect(await unread(w.carol)).toEqual([w.open.id, sub.id].sort((x, y) => x - y));
    expect(await unread(GUEST)).toEqual([]);
  });

  test("a forum read marker clears it for that member alone, and a later post brings it back", async () => {
    const { w, sub, a, unread } = await scene();
    w.ctx.clock.advance(60_000);
    await w.call("nodes.markRead", w.carol, { nodeId: w.open.id });
    expect(await unread(w.carol)).toEqual([]);
    expect(await unread(w.alice)).toEqual([w.open.id, sub.id].sort((x, y) => x - y));
    await w.reply(w.bob, a.id, "again");
    expect(await unread(w.carol)).toEqual([w.open.id]);
  });

  test("opening the only unread thread clears the forum; another unread thread keeps it", async () => {
    const { w, a, unread } = await scene();
    const b = (await w.thread(w.bob, w.open.id, "B")).thread;
    await w.call("threads.markRead", w.carol, { threadId: a.id, position: 1 });
    expect(await unread(w.carol)).toContain(w.open.id);
    await w.call("threads.markRead", w.carol, { threadId: b.id, position: 1 });
    expect(await unread(w.carol)).not.toContain(w.open.id);
  });

  test("a forum the viewer cannot see is left out", async () => {
    const { w, unread } = await scene();
    await w.thread(w.mod, w.secret.id, "Hidden");
    expect(await unread(w.carol)).not.toContain(w.secret.id);
    expect(await unread(w.admin)).toContain(w.secret.id);
  });

  test("the lookup hits its indexes", async () => {
    const { w } = await scene();
    // `c` is the capped list of recent threads, read from the threads index with no sort.
    expectNoTableScan(w.ctx, readMarkSql.unread, [1, JSON.stringify([1, 2]), 0], { allow: ["c"] });
  });

  test("a guest gets an empty list even where the site is closed to guests", async () => {
    const { w, unread } = await scene();
    setEntry(w.ctx, 1, "site.view", -1);
    expect(await unread(GUEST)).toEqual([]);
  });

  test("a forum whose other members' threads the viewer may not open is not reported", async () => {
    const { w, unread } = await scene();
    for (const group of [1, 2]) setEntry(w.ctx, group, "forum.viewOthers", -1, w.open.id);
    expect(await unread(w.carol)).not.toContain(w.open.id);
    // Staff still may open them.
    expect(await unread(w.mod)).toContain(w.open.id);
  });

  test("a thread that is not visible does not make a forum unread", async () => {
    const { w, a, unread } = await scene();
    for (const state of ["moderated", "deleted"]) {
      w.ctx.sqlite.prepare("UPDATE threads SET state = ?1 WHERE id = ?2").run(state, a.id);
      expect(await unread(w.carol), state).not.toContain(w.open.id);
    }
  });

  test("a thread last posted more than 30 days ago counts as read", async () => {
    const { w, unread } = await scene();
    w.ctx.clock.advance(31 * 86_400_000);
    expect(await unread(w.carol)).toEqual([]);
  });

  test("a banned member is refused, and a member awaiting approval is told no more than a guest", async () => {
    const { w, unread } = await scene();
    const banned = insertUser(w.ctx, { groupId: 2 });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned.id);
    await expect(w.call("nodes.unread", userActor(banned as never), {})).rejects.toThrow(
      ForbiddenError,
    );
    // A forum only members may see stays out of the awaiting member's list.
    for (const permission of ["node.view"]) setEntry(w.ctx, 1, permission, -1, w.open.id);
    const awaiting = insertUser(w.ctx, { groupId: 2 });
    w.ctx.sqlite
      .prepare("UPDATE users SET signup_review = 'pending' WHERE id = ?1")
      .run(awaiting.id);
    const ids = await unread(userActor(awaiting as never));
    expect(ids).not.toContain(w.open.id);
    expect(await unread(w.carol)).toContain(w.open.id);
  });

  test("only the newest threads of a forum are looked at: a read newest hundred hide older unread ones", async () => {
    const { w, unread } = await scene();
    const node = insertNode(w.ctx, { parentId: w.category.id, title: "Busy" });
    invalidate(w.ctx, "node_tree");
    const now = w.ctx.now();
    const ids = fillThreads(w.ctx, node.id, w.bobUser.id, UNREAD_SCAN + 1, {
      at: (i) => now - i * 1000,
    });
    expect(await unread(w.carol)).toContain(node.id);
    const read = w.ctx.sqlite.prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) SELECT ?1, id, last_post_id, 0, ?2 FROM threads WHERE id = ?3",
    );
    for (const id of ids.slice(0, UNREAD_SCAN)) read.run(w.carolUser.id, now, id);
    expect(await unread(w.carol)).not.toContain(node.id);
  });
});
