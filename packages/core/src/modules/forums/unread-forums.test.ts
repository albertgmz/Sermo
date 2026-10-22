import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { world } from "../feed/fixtures.test";
import { readMarkSql } from "./read-marks";

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
    expectNoTableScan(w.ctx, readMarkSql.unread, [1, JSON.stringify([1, 2]), 0]);
  });
});
