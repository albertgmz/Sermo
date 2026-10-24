import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import type { nodesList } from "../../contracts/forums";
import { execute } from "../../operation";
import { nodesListOp, postsCreateOp, threadsCreateOp } from "./index";
import { subtreeTotals } from "./subtree-totals";

// parent > child > grandchild, and a second child under the parent that only staff may open.
async function forumTree() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const parent = insertNode(ctx, {});
  const child = insertNode(ctx, { parentId: parent.id });
  const grandchild = insertNode(ctx, { parentId: child.id });
  const secret = insertNode(ctx, { parentId: parent.id });
  for (const groupId of [1, 2])
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, ?2, 0)")
      .run(secret.id, groupId);
  invalidate(ctx, "node_tree");
  invalidate(ctx, "permissions");
  // A thread with some replies in a forum; each call is later than the one before.
  const post = async (nodeId: number, replies: number, title: string) => {
    ctx.clock.advance(60_000);
    const created = await execute(ctx, threadsCreateOp, admin, { nodeId, title, body: "Body" });
    for (let i = 0; i < replies; i += 1) {
      ctx.clock.advance(60_000);
      await execute(ctx, postsCreateOp, admin, { threadId: created.thread.id, body: "Reply" });
    }
  };
  await post(parent.id, 1, "Parent thread");
  await post(grandchild.id, 3, "Grandchild thread");
  await post(child.id, 2, "Child thread");
  await post(secret.id, 4, "Private thread");
  return { ctx, admin, parent, child, grandchild, secret };
}

type Listed = z.output<typeof nodesList.output>["items"][number];

async function totalsAs(ctx: Ctx, actor: Actor, id: number) {
  const { items } = await execute(ctx, nodesListOp, actor, {});
  const byParent = new Map<number | null, Listed[]>();
  for (const node of items)
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const node = items.find((n) => n.id === id)!;
  const totals = subtreeTotals(node, (parentId) => byParent.get(parentId) ?? []);
  return { ...totals, lastTitle: totals.lastPost?.threadTitle ?? null };
}

test("a forum adds the threads and posts of every forum under it, over two levels, and takes the newest last post", async () => {
  const { ctx, parent, child, grandchild } = await forumTree();
  const viewer = userActor(insertUser(ctx));
  // Each forum holds its threads' first posts plus replies: parent 2, child 3, grandchild 4.
  expect(await totalsAs(ctx, viewer, grandchild.id)).toMatchObject({
    threadCount: 1,
    postCount: 4,
  });
  expect(await totalsAs(ctx, viewer, child.id)).toMatchObject({
    threadCount: 2,
    postCount: 3 + 4,
    lastTitle: "Child thread",
  });
  expect(await totalsAs(ctx, viewer, parent.id)).toMatchObject({
    threadCount: 3,
    postCount: 2 + 3 + 4,
    lastTitle: "Child thread",
  });
});

test("a viewer who cannot open a child forum does not get its counts or last post added", async () => {
  const { ctx, admin, parent } = await forumTree();
  const asMember = await totalsAs(ctx, userActor(insertUser(ctx)), parent.id);
  expect(asMember).toMatchObject({ threadCount: 3, postCount: 9, lastTitle: "Child thread" });
  const asStaff = await totalsAs(ctx, admin, parent.id);
  expect(asStaff).toMatchObject({ threadCount: 4, postCount: 9 + 5, lastTitle: "Private thread" });
});
