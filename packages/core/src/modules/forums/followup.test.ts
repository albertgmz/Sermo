import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import {
  nodesGetOp,
  nodesListOp,
  nodesUpdateOp,
  postsCreateOp,
  postsDeleteOp,
  postsGetOp,
  postsListOp,
  postsRestoreOp,
  postsUpdateOp,
  reactablePost,
  threadsCreateOp,
  threadsDeleteOp,
  threadsGetOp,
  threadsListOp,
  threadsMarkReadOp,
  threadsMoveOp,
  threadsRestoreOp,
  threadsSetLockedOp,
  threadsSetStickyOp,
  threadsUpdateOp,
} from "./index";

const call = execute;
function setup() {
  const ctx = createTestContext();
  const category = insertNode(ctx, { type: "category" });
  const forum = insertNode(ctx, { parentId: category.id });
  const target = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const member = userActor(insertUser(ctx));
  const other = userActor(insertUser(ctx));
  const mod = userActor(insertUser(ctx, { groupId: 3 }));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  return { ctx, category, forum, target, member, other, mod, admin };
}
const deny = async (promise: Promise<unknown>, error: unknown) =>
  expect(promise).rejects.toBeInstanceOf(error);

describe("forum follow-up coverage", () => {
  test("guests get authentication errors on every write and can read visible content", async () => {
    const { ctx, forum, member } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    const writes = [
      call(ctx, threadsCreateOp, GUEST, { nodeId: forum.id, title: "x", body: "x" }),
      call(ctx, threadsUpdateOp, GUEST, { threadId: t.thread.id, title: "x" }),
      call(ctx, threadsSetStickyOp, GUEST, { threadId: t.thread.id, isSticky: true }),
      call(ctx, threadsSetLockedOp, GUEST, { threadId: t.thread.id, isLocked: true }),
      call(ctx, threadsMoveOp, GUEST, { threadId: t.thread.id, nodeId: forum.id }),
      call(ctx, threadsDeleteOp, GUEST, { threadId: t.thread.id }),
      call(ctx, threadsRestoreOp, GUEST, { threadId: t.thread.id }),
      call(ctx, threadsMarkReadOp, GUEST, { threadId: t.thread.id, position: 0 }),
      call(ctx, postsCreateOp, GUEST, { threadId: t.thread.id, body: "x" }),
      call(ctx, postsUpdateOp, GUEST, { postId: p.id, body: "x" }),
      call(ctx, postsDeleteOp, GUEST, { postId: t.post.id }),
      call(ctx, postsRestoreOp, GUEST, { postId: p.id }),
    ];
    for (const promise of writes) await deny(promise, UnauthenticatedError);
    expect((await call(ctx, threadsListOp, GUEST, { nodeId: forum.id })).items).toHaveLength(1);
    expect((await call(ctx, postsListOp, GUEST, { threadId: t.thread.id })).items).toHaveLength(2);
    expect((await call(ctx, postsGetOp, GUEST, { postId: p.id })).id).toBe(p.id);
  });

  test("admin and token actors use node permissions on threads and posts", async () => {
    const { ctx, forum, member, admin, mod } = setup();
    const token = tokenActor({ id: actorUserId(member)!, groupId: 2 });
    const t = await call(ctx, threadsCreateOp, token, {
      nodeId: forum.id,
      title: "Token",
      body: "Body",
    });
    expect(t.thread.author.id).toBe(actorUserId(member)!);
    expect(t.post.author.id).toBe(actorUserId(member)!);
    expect(
      (await call(ctx, threadsGetOp, admin, { threadId: t.thread.id })).permissions.canModerate,
    ).toBe(true);
    const p = await call(ctx, postsCreateOp, admin, { threadId: t.thread.id, body: "Admin" });
    expect([p.author.id, p.position]).toEqual([actorUserId(admin)!, 1]);
    const tokenPost = await call(ctx, postsCreateOp, token, {
      threadId: t.thread.id,
      body: "Token reply",
    });
    expect(
      (await call(ctx, postsUpdateOp, token, { postId: tokenPost.id, body: "Token edit" }))
        .bodySource,
    ).toBe("Token edit");
    expect((await call(ctx, postsDeleteOp, token, { postId: tokenPost.id })).state).toBe("deleted");
    await call(ctx, threadsSetLockedOp, mod, { threadId: t.thread.id, isLocked: true });
    await deny(
      call(ctx, postsCreateOp, token, { threadId: t.thread.id, body: "No" }),
      ForbiddenError,
    );
    expect(
      (await call(ctx, postsUpdateOp, admin, { postId: p.id, body: "Changed" })).bodySource,
    ).toBe("Changed");
    expect((await call(ctx, threadsDeleteOp, admin, { threadId: t.thread.id })).state).toBe(
      "deleted",
    );
    expect((await call(ctx, threadsRestoreOp, admin, { threadId: t.thread.id })).state).toBe(
      "visible",
    );
  });

  test("node details, reparenting, visibility and permission flags", async () => {
    const { ctx, category, forum, target, member, admin, mod } = setup();
    const nodes = (await call(ctx, nodesListOp, member, {})).items;
    expect(nodes.find((n) => n.id === category.id)?.permissions.canPost).toBe(false);
    expect(nodes.find((n) => n.id === forum.id)?.lastPost).toBeNull();
    expect(
      (await call(ctx, nodesListOp, mod, {})).items.find((n) => n.id === forum.id)?.permissions
        .canModerate,
    ).toBe(true);
    await deny(call(ctx, nodesUpdateOp, member, { nodeId: forum.id, title: "No" }), ForbiddenError);
    await deny(
      call(ctx, nodesUpdateOp, admin, { nodeId: forum.id, parentId: 999999 }),
      NotFoundError,
    );
    expect(
      (await call(ctx, nodesUpdateOp, admin, { nodeId: forum.id, parentId: target.id })).parentId,
    ).toBe(target.id);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(target.id);
    invalidate(ctx, "permissions");
    expect((await call(ctx, nodesListOp, member, {})).items.map((n) => n.id)).not.toContain(
      forum.id,
    );
    await deny(call(ctx, nodesGetOp, member, { nodeId: forum.id }), NotFoundError);
  });

  test("hidden nodes are nonexistent to thread and post operations", async () => {
    const { ctx, forum, target, member, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await deny(call(ctx, threadsListOp, member, { nodeId: forum.id }), NotFoundError);
    await deny(
      call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "X", body: "X" }),
      NotFoundError,
    );
    await deny(call(ctx, postsListOp, member, { threadId: t.thread.id }), NotFoundError);
    await deny(call(ctx, postsGetOp, member, { postId: p.id }), NotFoundError);
    await deny(
      call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "X" }),
      NotFoundError,
    );
    await deny(call(ctx, postsUpdateOp, member, { postId: p.id, body: "X" }), NotFoundError);
    await deny(call(ctx, postsDeleteOp, member, { postId: p.id }), NotFoundError);
    await deny(call(ctx, postsRestoreOp, member, { postId: p.id }), NotFoundError);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 3, 0)")
      .run(target.id);
    invalidate(ctx, "permissions");
    await deny(
      call(ctx, threadsMoveOp, mod, { threadId: t.thread.id, nodeId: target.id }),
      NotFoundError,
    );
  });

  test("thread lists apply state, sticky, cursor and read filters", async () => {
    const { ctx, category, forum, member, other, mod } = setup();
    await deny(call(ctx, threadsListOp, member, { nodeId: category.id }), ValidationError);
    const own = await call(ctx, threadsCreateOp, member, {
      nodeId: forum.id,
      title: "Own",
      body: "B",
    });
    const foreign = await call(ctx, threadsCreateOp, other, {
      nodeId: forum.id,
      title: "Foreign",
      body: "B",
    });
    const third = await call(ctx, threadsCreateOp, other, {
      nodeId: forum.id,
      title: "Third",
      body: "B",
    });
    await call(ctx, threadsDeleteOp, mod, { threadId: third.thread.id });
    ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(own.thread.id);
    ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(foreign.thread.id);
    expect(
      (await call(ctx, threadsListOp, member, { nodeId: forum.id })).items.map((t) => t.id),
    ).toEqual([own.thread.id]);
    expect((await call(ctx, threadsListOp, mod, { nodeId: forum.id })).items).toHaveLength(3);
    await call(ctx, threadsRestoreOp, mod, { threadId: own.thread.id });
    await call(ctx, threadsRestoreOp, mod, { threadId: foreign.thread.id });
    await call(ctx, threadsRestoreOp, mod, { threadId: third.thread.id });
    await call(ctx, threadsSetStickyOp, mod, { threadId: own.thread.id, isSticky: true });
    const first = await call(ctx, threadsListOp, member, { nodeId: forum.id, limit: 1 });
    expect(first.sticky.map((t) => t.id)).toEqual([own.thread.id]);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.isUnread).toBe(true);
    expect(first.items[0]?.readPosition).toBeNull();
    const next = await call(ctx, threadsListOp, member, {
      nodeId: forum.id,
      cursor: first.nextCursor!,
      limit: 1,
    });
    expect(next.sticky).toEqual([]);
    await call(ctx, threadsMarkReadOp, member, { threadId: first.items[0]!.id, position: 0 });
    const read = (await call(ctx, threadsListOp, member, { nodeId: forum.id })).items.find(
      (t) => t.id === first.items[0]!.id,
    )!;
    expect([read.isUnread, read.readPosition]).toEqual([false, 0]);
  });

  test("thread write permissions and flags track owner, lock, target and state", async () => {
    const { ctx, category, forum, target, member, other, mod } = setup();
    await deny(
      call(ctx, threadsCreateOp, member, { nodeId: category.id, title: "X", body: "B" }),
      ValidationError,
    );
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    expect((await call(ctx, threadsGetOp, member, { threadId: t.thread.id })).permissions).toEqual({
      canReply: true,
      canEditTitle: true,
      canModerate: false,
    });
    expect(
      (await call(ctx, threadsGetOp, other, { threadId: t.thread.id })).permissions.canEditTitle,
    ).toBe(false);
    await deny(
      call(ctx, threadsUpdateOp, other, { threadId: t.thread.id, title: "No" }),
      ForbiddenError,
    );
    for (const op of [
      call(ctx, threadsSetStickyOp, member, { threadId: t.thread.id, isSticky: true }),
      call(ctx, threadsSetLockedOp, member, { threadId: t.thread.id, isLocked: true }),
      call(ctx, threadsDeleteOp, member, { threadId: t.thread.id }),
      call(ctx, threadsRestoreOp, member, { threadId: t.thread.id }),
    ])
      await deny(op, ForbiddenError);
    await call(ctx, threadsSetLockedOp, mod, { threadId: t.thread.id, isLocked: true });
    expect((await call(ctx, threadsGetOp, member, { threadId: t.thread.id })).permissions).toEqual({
      canReply: false,
      canEditTitle: false,
      canModerate: false,
    });
    expect(
      (await call(ctx, threadsGetOp, mod, { threadId: t.thread.id })).permissions.canReply,
    ).toBe(true);
    await deny(
      call(ctx, threadsUpdateOp, member, { threadId: t.thread.id, title: "No" }),
      ForbiddenError,
    );
    await deny(
      call(ctx, threadsMoveOp, mod, { threadId: t.thread.id, nodeId: category.id }),
      ValidationError,
    );
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_moderate) VALUES (?1, 3, 0)")
      .run(target.id);
    invalidate(ctx, "permissions");
    await deny(
      call(ctx, threadsMoveOp, mod, { threadId: t.thread.id, nodeId: target.id }),
      ForbiddenError,
    );
    ctx.sqlite
      .prepare("UPDATE node_permissions SET can_moderate = 1 WHERE node_id = ?1 AND group_id = 3")
      .run(target.id);
    invalidate(ctx, "permissions");
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    expect(
      (await call(ctx, threadsMoveOp, mod, { threadId: t.thread.id, nodeId: target.id })).nodeId,
    ).toBe(target.id);
  });

  test("posting override, locked thread and post edit permissions", async () => {
    const { ctx, forum, member, other, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    await deny(call(ctx, postsUpdateOp, other, { postId: p.id, body: "No" }), ForbiddenError);
    await deny(call(ctx, postsDeleteOp, other, { postId: p.id }), ForbiddenError);
    expect((await call(ctx, postsUpdateOp, mod, { postId: p.id, body: "Mod" })).bodySource).toBe(
      "Mod",
    );
    await deny(call(ctx, postsRestoreOp, member, { postId: p.id }), ForbiddenError);
    await call(ctx, threadsSetLockedOp, mod, { threadId: t.thread.id, isLocked: true });
    await deny(call(ctx, postsUpdateOp, member, { postId: p.id, body: "No" }), ForbiddenError);
    await deny(call(ctx, postsDeleteOp, member, { postId: p.id }), ForbiddenError);
    expect(
      (await call(ctx, postsCreateOp, mod, { threadId: t.thread.id, body: "Mod reply" })).position,
    ).toBe(2);
    await call(ctx, threadsSetLockedOp, mod, { threadId: t.thread.id, isLocked: false });
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_post) VALUES (?1, 2, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await deny(
      call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "No", body: "B" }),
      ForbiddenError,
    );
    await deny(
      call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "No" }),
      ForbiddenError,
    );
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    await deny(
      call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "No" }),
      NotFoundError,
    );
  });

  test("position pages and cursors survive hiding and restoring in either order", async () => {
    const { ctx, forum, member, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const replies = [];
    for (let i = 0; i < 5; i++)
      replies.push(
        await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: `R${i}` }),
      );
    await call(ctx, postsDeleteOp, member, { postId: replies[4]!.id });
    expect(
      (await call(ctx, threadsGetOp, member, { threadId: t.thread.id })).thread.lastPost.postId,
    ).toBe(replies[3]!.id);
    await call(ctx, postsDeleteOp, member, { postId: replies[1]!.id });
    const memberPage = await call(ctx, postsListOp, member, {
      threadId: t.thread.id,
      page: 2,
      limit: 2,
    });
    const modPage = await call(ctx, postsListOp, mod, { threadId: t.thread.id, page: 2, limit: 2 });
    expect(memberPage.items.map((p) => p.position)).toEqual([3]);
    expect(modPage.items.map((p) => p.position)).toEqual([2, 3]);
    await call(ctx, postsRestoreOp, mod, { postId: replies[4]!.id });
    await call(ctx, postsRestoreOp, mod, { postId: replies[1]!.id });
    expect(
      (await call(ctx, postsListOp, member, { threadId: t.thread.id })).items.map(
        (p) => p.position,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    await call(ctx, postsDeleteOp, member, { postId: replies[1]!.id });
    await call(ctx, postsDeleteOp, member, { postId: replies[3]!.id });
    await call(ctx, postsRestoreOp, mod, { postId: replies[1]!.id });
    await call(ctx, postsRestoreOp, mod, { postId: replies[3]!.id });
    expect(
      (await call(ctx, postsListOp, member, { threadId: t.thread.id })).items.map(
        (p) => p.position,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    let cursor: string | undefined;
    const ids: number[] = [];
    do {
      const page = await call(ctx, postsListOp, mod, { threadId: t.thread.id, limit: 2, cursor });
      ids.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual([t.post.id, ...replies.map((p) => p.id)]);
    expect(
      (await call(ctx, postsListOp, member, { threadId: t.thread.id, page: 100 })).items,
    ).toEqual([]);
  });

  test("positions stay fixed through state changes and moves while pages respect visibility", async () => {
    const { ctx, forum, target, member, other, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const replies = [];
    for (let i = 1; i <= 4; i++)
      replies.push(
        await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: `R${i}` }),
      );
    const positions = () =>
      ctx.sqlite
        .prepare<{ id: number; position: number }, [number]>(
          "SELECT id, position FROM posts WHERE thread_id = ?1 ORDER BY id",
        )
        .all(t.thread.id);
    const original = positions();
    expect(original.map((p) => p.position)).toEqual([0, 1, 2, 3, 4]);
    expect(t.thread.lastPost.position).toBe(0);
    expect(
      (await call(ctx, threadsGetOp, other, { threadId: t.thread.id })).thread.lastPost.position,
    ).toBe(4);

    await call(ctx, postsDeleteOp, member, { postId: replies[0]!.id });
    expect(positions()).toEqual(original);
    const first = await call(ctx, postsListOp, other, { threadId: t.thread.id, limit: 2 });
    expect(first.items.map((p) => p.position)).toEqual([0]);
    expect(first.nextCursor).not.toBeNull();
    expect(
      (
        await call(ctx, postsListOp, other, {
          threadId: t.thread.id,
          page: 99,
          limit: 2,
          cursor: first.nextCursor!,
        })
      ).items.map((p) => p.position),
    ).toEqual([2, 3]);
    expect(
      (await call(ctx, postsListOp, mod, { threadId: t.thread.id, limit: 2 })).items.map(
        (p) => p.position,
      ),
    ).toEqual([0, 1]);

    for (const reply of replies.slice(1))
      await call(ctx, postsDeleteOp, member, { postId: reply.id });
    expect(positions()).toEqual(original);
    expect(
      (await call(ctx, threadsGetOp, other, { threadId: t.thread.id })).thread.lastPost.position,
    ).toBe(0);
    expect(
      (await call(ctx, postsListOp, other, { threadId: t.thread.id, limit: 2 })).nextCursor,
    ).toBeNull();
    expect(
      (await call(ctx, postsListOp, mod, { threadId: t.thread.id, limit: 2 })).nextCursor,
    ).not.toBeNull();
    expect(
      (await call(ctx, threadsMarkReadOp, other, { threadId: t.thread.id, position: 99 }))
        .readPosition,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ last_read_post_id: number }, [number, number]>(
          "SELECT last_read_post_id FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
        )
        .get(actorUserId(other)!, t.thread.id)!.last_read_post_id,
    ).toBe(t.post.id);

    const newReply = await call(ctx, postsCreateOp, member, {
      threadId: t.thread.id,
      body: "Later",
    });
    expect(newReply.position).toBe(5);
    await call(ctx, postsRestoreOp, mod, { postId: replies[1]!.id });
    expect(
      (await call(ctx, threadsMarkReadOp, other, { threadId: t.thread.id, position: 4 }))
        .readPosition,
    ).toBe(2);
    await call(ctx, postsDeleteOp, member, { postId: newReply.id });
    const withNew = positions();

    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(replies[0]!.id);
    await call(ctx, postsDeleteOp, member, { postId: replies[0]!.id });
    expect(positions()).toEqual(withNew);
    await call(ctx, threadsMoveOp, mod, { threadId: t.thread.id, nodeId: target.id });
    expect(positions()).toEqual(withNew);
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    expect(positions()).toEqual(withNew);
    await call(ctx, threadsRestoreOp, mod, { threadId: t.thread.id });
    expect(positions()).toEqual(withNew);
    await call(ctx, postsRestoreOp, mod, { postId: newReply.id });
    expect(positions()).toEqual(withNew);
    expect(
      (await call(ctx, threadsGetOp, other, { threadId: t.thread.id })).thread.lastPost.position,
    ).toBe(5);
  });

  test("moderated posts retain position when deleted and authors can see their own", async () => {
    const { ctx, forum, member, other, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    const later = await call(ctx, postsCreateOp, other, { threadId: t.thread.id, body: "Later" });
    await call(ctx, postsDeleteOp, member, { postId: p.id });
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(p.id);
    expect(
      (await call(ctx, postsListOp, member, { threadId: t.thread.id })).items.map((r) => r.id),
    ).toContain(p.id);
    expect(
      (await call(ctx, postsListOp, other, { threadId: t.thread.id })).items.map((r) => r.id),
    ).not.toContain(p.id);
    await deny(call(ctx, postsRestoreOp, member, { postId: p.id }), ForbiddenError);
    const pos = (await call(ctx, postsGetOp, mod, { postId: p.id })).position;
    const laterPosition = (await call(ctx, postsGetOp, mod, { postId: later.id })).position;
    await call(ctx, postsDeleteOp, member, { postId: p.id });
    expect((await call(ctx, postsGetOp, mod, { postId: p.id })).position).toBe(pos);
    expect((await call(ctx, postsGetOp, mod, { postId: later.id })).position).toBe(laterPosition);
  });

  test("read clamp, 30-day boundary and read-only listings", async () => {
    const { ctx, forum, member, other, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    await call(ctx, postsDeleteOp, member, { postId: p.id });
    expect(
      (await call(ctx, threadsMarkReadOp, other, { threadId: t.thread.id, position: 100 }))
        .readPosition,
    ).toBe(0);
    const before = ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
    await call(ctx, nodesListOp, other, {});
    await call(ctx, threadsListOp, other, { nodeId: forum.id });
    await call(ctx, postsListOp, other, { threadId: t.thread.id });
    expect(ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get()!.n).toBe(
      before,
    );
    ctx.clock.advance(30 * 86400000);
    expect((await call(ctx, threadsGetOp, mod, { threadId: t.thread.id })).thread.isUnread).toBe(
      false,
    );
    ctx.clock.set(Date.parse(t.thread.createdAt) + 30 * 86400000 - 1);
    expect((await call(ctx, threadsGetOp, mod, { threadId: t.thread.id })).thread.isUnread).toBe(
      true,
    );
    expect((await call(ctx, threadsGetOp, other, { threadId: t.thread.id })).thread.isUnread).toBe(
      false,
    );
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    await deny(
      call(ctx, threadsMarkReadOp, other, { threadId: t.thread.id, position: 0 }),
      NotFoundError,
    );
  });

  test("reaction access follows post, thread and node visibility", async () => {
    const { ctx, forum, member, other, mod } = setup();
    const t = await call(ctx, threadsCreateOp, member, { nodeId: forum.id, title: "T", body: "B" });
    const p = await call(ctx, postsCreateOp, member, { threadId: t.thread.id, body: "R" });
    expect(reactablePost(ctx, other, p.id)).toEqual({ authorId: p.author.id, isVisible: true });
    await call(ctx, postsDeleteOp, member, { postId: p.id });
    await deny(
      Promise.resolve().then(() => reactablePost(ctx, other, p.id)),
      NotFoundError,
    );
    expect(reactablePost(ctx, mod, p.id).isVisible).toBe(false);
    await call(ctx, postsRestoreOp, mod, { postId: p.id });
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    expect(reactablePost(ctx, mod, p.id).isVisible).toBe(false);
    await deny(
      Promise.resolve().then(() => reactablePost(ctx, other, p.id)),
      NotFoundError,
    );
    await call(ctx, threadsRestoreOp, mod, { threadId: t.thread.id });
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await deny(
      Promise.resolve().then(() => reactablePost(ctx, other, p.id)),
      NotFoundError,
    );
  });

  test("node and thread pointers follow title, sticky, hidden replies and newest deletion", async () => {
    const { ctx, forum, member, other, mod } = setup();
    const verify = (threadId: number) => {
      const thread = ctx.sqlite
        .prepare<
          {
            reply_count: number;
            last_post_id: number;
            last_post_at: number;
            last_poster_id: number;
          },
          [number]
        >(
          "SELECT reply_count, last_post_id, last_post_at, last_poster_id FROM threads WHERE id = ?1",
        )
        .get(threadId)!;
      const last = ctx.sqlite
        .prepare<{ id: number; created_at: number; user_id: number }, [number]>(
          "SELECT id, created_at, user_id FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC, id DESC LIMIT 1",
        )
        .get(threadId)!;
      const count = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM posts WHERE thread_id = ?1 AND state = 'visible'",
        )
        .get(threadId)!.n;
      expect([
        thread.reply_count,
        thread.last_post_id,
        thread.last_post_at,
        thread.last_poster_id,
      ]).toEqual([count - 1, last.id, last.created_at, last.user_id]);
      const node = ctx.sqlite
        .prepare<
          {
            last_post_id: number | null;
            last_post_at: number | null;
            last_poster_id: number | null;
            last_thread_title: string | null;
            post_count: number;
          },
          [number]
        >(
          "SELECT last_post_id, last_post_at, last_poster_id, last_thread_title, post_count FROM nodes WHERE id = ?1",
        )
        .get(forum.id)!;
      const newest = ctx.sqlite
        .prepare<
          {
            last_post_id: number;
            last_post_at: number;
            last_poster_id: number;
            title: string;
          } | null,
          [number]
        >(
          "SELECT last_post_id, last_post_at, last_poster_id, title FROM threads WHERE node_id = ?1 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
        )
        .get(forum.id);
      const posts = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1 AND t.state = 'visible' AND p.state = 'visible'",
        )
        .get(forum.id)!.n;
      expect([
        node.last_post_id,
        node.last_post_at,
        node.last_poster_id,
        node.last_thread_title,
        node.post_count,
      ]).toEqual([
        newest?.last_post_id ?? null,
        newest?.last_post_at ?? null,
        newest?.last_poster_id ?? null,
        newest?.title ?? null,
        posts,
      ]);
    };
    const t = await call(ctx, threadsCreateOp, member, {
      nodeId: forum.id,
      title: "Original",
      body: "B",
    });
    verify(t.thread.id);
    await call(ctx, threadsUpdateOp, member, { threadId: t.thread.id, title: "Renamed" });
    verify(t.thread.id);
    await call(ctx, threadsSetStickyOp, mod, { threadId: t.thread.id, isSticky: true });
    verify(t.thread.id);
    const reply = await call(ctx, postsCreateOp, other, { threadId: t.thread.id, body: "R" });
    verify(t.thread.id);
    await call(ctx, threadsDeleteOp, mod, { threadId: t.thread.id });
    verify(t.thread.id);
    const hiddenReply = await call(ctx, postsCreateOp, mod, {
      threadId: t.thread.id,
      body: "Hidden thread reply",
    });
    verify(t.thread.id);
    await call(ctx, threadsRestoreOp, mod, { threadId: t.thread.id });
    verify(t.thread.id);
    await call(ctx, postsDeleteOp, mod, { postId: hiddenReply.id });
    verify(t.thread.id);
    await call(ctx, postsDeleteOp, other, { postId: reply.id });
    verify(t.thread.id);
  });
});
