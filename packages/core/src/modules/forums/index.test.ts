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
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import {
  nodesCreateOp,
  nodesGetOp,
  nodesListOp,
  nodesUpdateOp,
  postsCreateOp,
  postsDeleteOp,
  postsGetOp,
  postsListOp,
  postsRestoreOp,
  postsUpdateOp,
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

describe("forums", () => {
  test("node management and visibility", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = userActor(insertUser(ctx));
    await expect(
      call(ctx, nodesCreateOp, GUEST, { parentId: null, type: "forum", title: "F" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      call(ctx, nodesCreateOp, member, { parentId: null, type: "forum", title: "F" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const root = await call(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "category",
      title: "Root",
    });
    const forum = await call(ctx, nodesCreateOp, admin, {
      parentId: root.id,
      type: "forum",
      title: "Forum",
    });
    expect((await call(ctx, nodesListOp, GUEST, {})).items.map((n) => n.id)).toEqual([
      root.id,
      forum.id,
    ]);
    expect(
      (await call(ctx, nodesGetOp, member, { nodeId: forum.id })).breadcrumbs.map((n) => n.id),
    ).toEqual([root.id]);
    await expect(
      call(ctx, nodesUpdateOp, admin, { nodeId: root.id, parentId: forum.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await call(ctx, nodesUpdateOp, admin, { nodeId: forum.id, title: "Renamed" })).title,
    ).toBe("Renamed");
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(root.id);
    invalidate(ctx, "permissions");
    await expect(call(ctx, nodesGetOp, member, { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("threads and posts maintain positions, counters, and permissions", async () => {
    const ctx = createTestContext();
    const forum = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const other = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    await expect(
      call(ctx, threadsCreateOp, GUEST, { nodeId: forum.id, title: "T", body: "Body" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    const created = await call(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "T",
      body: "Body",
    });
    const id = created.thread.id;
    expect(created.post.position).toBe(0);
    expect((await call(ctx, threadsGetOp, GUEST, { threadId: id })).thread.viewCount).toBe(1);
    const a = await call(ctx, postsCreateOp, author, { threadId: id, body: "A" });
    const b = await call(ctx, postsCreateOp, other, { threadId: id, body: "B" });
    const c = await call(ctx, postsCreateOp, other, { threadId: id, body: "C" });
    expect(
      (await call(ctx, postsListOp, GUEST, { threadId: id, limit: 2 })).nextCursor,
    ).not.toBeNull();
    await expect(
      call(ctx, postsUpdateOp, other, { postId: a.id, body: "No" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await call(ctx, postsUpdateOp, author, { postId: a.id, body: "Edited" })).bodySource,
    ).toBe("Edited");
    await expect(
      call(ctx, postsDeleteOp, author, { postId: created.post.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await call(ctx, postsDeleteOp, author, { postId: a.id });
    expect(
      (await call(ctx, postsListOp, author, { threadId: id })).items.map((p) => p.position),
    ).toEqual([0, 1, 2]);
    expect(
      (await call(ctx, postsListOp, mod, { threadId: id })).items.map((p) => p.position),
    ).toEqual([0, 1, 1, 2]);
    await call(ctx, postsDeleteOp, other, { postId: c.id });
    await call(ctx, postsRestoreOp, mod, { postId: a.id });
    await call(ctx, postsRestoreOp, mod, { postId: c.id });
    expect(
      (await call(ctx, postsListOp, author, { threadId: id })).items.map((p) => p.position),
    ).toEqual([0, 1, 2, 3]);
    expect((await call(ctx, threadsGetOp, author, { threadId: id })).thread.replyCount).toBe(3);
    await call(ctx, threadsSetLockedOp, mod, { threadId: id, isLocked: true });
    await expect(
      call(ctx, postsCreateOp, author, { threadId: id, body: "Blocked" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await call(ctx, threadsSetStickyOp, mod, { threadId: id, isSticky: true });
    expect(
      (await call(ctx, threadsListOp, GUEST, { nodeId: forum.id })).sticky.map((t) => t.id),
    ).toEqual([id]);
    await call(ctx, threadsUpdateOp, mod, { threadId: id, title: "New title" });
    expect(
      (await call(ctx, nodesGetOp, GUEST, { nodeId: forum.id })).node.lastPost?.threadTitle,
    ).toBe("New title");
    await call(ctx, threadsDeleteOp, mod, { threadId: id });
    await expect(call(ctx, threadsGetOp, author, { threadId: id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await call(ctx, threadsRestoreOp, mod, { threadId: id });
    expect((await call(ctx, postsGetOp, author, { postId: b.id })).id).toBe(b.id);
    const counts = ctx.sqlite
      .prepare<{ thread_count: number; post_count: number }, [number]>(
        "SELECT thread_count, post_count FROM nodes WHERE id = ?1",
      )
      .get(forum.id)!;
    expect(counts).toEqual({ thread_count: 1, post_count: 4 });
    const destination = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    await expect(
      call(ctx, threadsMoveOp, author, { threadId: id, nodeId: destination.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await call(ctx, threadsMoveOp, mod, { threadId: id, nodeId: destination.id });
    expect((await call(ctx, nodesGetOp, GUEST, { nodeId: forum.id })).node.lastPost).toBeNull();
    expect((await call(ctx, nodesGetOp, GUEST, { nodeId: destination.id })).node.postCount).toBe(4);
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
        .get(created.post.author.id)!.post_count,
    ).toBe(2);
  });

  test("read tracking is monotonic and views do not write", async () => {
    const ctx = createTestContext();
    const forum = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const reader = userActor(insertUser(ctx));
    const created = await call(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "T",
      body: "B",
    });
    const id = created.thread.id;
    await call(ctx, postsCreateOp, author, { threadId: id, body: "Reply" });
    const changes = ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
    expect((await call(ctx, threadsGetOp, reader, { threadId: id })).thread.isUnread).toBe(true);
    expect(ctx.sqlite.prepare<{ n: number }, []>("SELECT total_changes() AS n").get()!.n).toBe(
      changes,
    );
    expect(
      (await call(ctx, threadsMarkReadOp, reader, { threadId: id, position: 999 })).readPosition,
    ).toBe(1);
    expect(
      (await call(ctx, threadsMarkReadOp, reader, { threadId: id, position: 0 })).readPosition,
    ).toBe(1);
    expect((await call(ctx, threadsGetOp, reader, { threadId: id })).thread.isUnread).toBe(false);
    ctx.clock.advance(31 * 86400000);
    expect(
      (await call(ctx, threadsGetOp, userActor(insertUser(ctx)), { threadId: id })).thread.isUnread,
    ).toBe(false);
  });

  test("hot query plans use indexes", () => {
    const ctx = createTestContext();
    expectNoTableScan(
      ctx,
      "SELECT id FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND (last_post_at, id) < (?2, ?3) ORDER BY last_post_at DESC, id DESC LIMIT ?4",
      [1, 100, 100, 20],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM threads WHERE node_id = ?1 AND is_sticky = 1 ORDER BY last_post_at DESC, id DESC",
      [1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM posts WHERE thread_id = ?1 AND (position, id) >= (?2, ?3) ORDER BY position, id LIMIT ?4",
      [1, 0, 0, 20],
    );
    expectNoTableScan(
      ctx,
      "SELECT thread_id FROM thread_reads WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
      [1, "[1]"],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM threads WHERE node_id = ?1 AND is_sticky = ?2 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
      [1, 0],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM posts WHERE thread_id = ?1 AND state = 'visible' GROUP BY user_id",
      [1],
      { allowTempBTree: true },
    );
    expectNoTableScan(
      ctx,
      "UPDATE posts SET position = position - 1 WHERE thread_id = ?1 AND position > ?2",
      [1, 1],
    );
    expectNoTableScan(
      ctx,
      "UPDATE posts SET position = position + 1 WHERE thread_id = ?1 AND (position > ?2 OR (position = ?2 AND id > ?3))",
      [1, 1, 1],
    );
  });

  test("keyset pages cover tied thread activity without duplicates", async () => {
    const ctx = createTestContext();
    const forum = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const actor = userActor(insertUser(ctx));
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(
        (
          await call(ctx, threadsCreateOp, actor, {
            nodeId: forum.id,
            title: `T${i}`,
            body: "Body",
          })
        ).thread.id,
      );
    }
    const found: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await call(ctx, threadsListOp, actor, { nodeId: forum.id, limit: 2, cursor });
      found.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(found).toEqual([...created].reverse());
  });

  test("hidden content and node moderation distinguish forbidden from nonexistent", async () => {
    const ctx = createTestContext();
    const forum = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const other = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const created = await call(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "T",
      body: "B",
    });
    const reply = await call(ctx, postsCreateOp, author, {
      threadId: created.thread.id,
      body: "R",
    });
    await call(ctx, postsDeleteOp, mod, { postId: reply.id });
    await expect(call(ctx, postsGetOp, author, { postId: reply.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(reply.id);
    expect((await call(ctx, postsGetOp, author, { postId: reply.id })).canDelete).toBe(true);
    await expect(call(ctx, postsGetOp, other, { postId: reply.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await call(ctx, postsDeleteOp, author, { postId: reply.id });
    await call(ctx, postsRestoreOp, mod, { postId: reply.id });
    await call(ctx, threadsDeleteOp, mod, { threadId: created.thread.id });
    ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(created.thread.id);
    expect(
      (await call(ctx, threadsGetOp, author, { threadId: created.thread.id })).thread.state,
    ).toBe("moderated");
    await expect(
      call(ctx, threadsGetOp, other, { threadId: created.thread.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await call(ctx, threadsRestoreOp, mod, { threadId: created.thread.id });
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_moderate) VALUES (?1, 3, 0)")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await expect(
      call(ctx, threadsDeleteOp, mod, { threadId: created.thread.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    ctx.sqlite
      .prepare("UPDATE node_permissions SET can_view = 0 WHERE node_id = ?1 AND group_id = 3")
      .run(forum.id);
    invalidate(ctx, "permissions");
    await expect(
      call(ctx, threadsGetOp, mod, { threadId: created.thread.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("denormalized counters and last post pointers match a recount after each write", async () => {
    const ctx = createTestContext();
    const source = insertNode(ctx, {});
    const target = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const first = userActor(insertUser(ctx));
    const second = userActor(insertUser(ctx));
    const mod = userActor(insertUser(ctx, { groupId: 3 }));
    const verify = () => {
      for (const nodeId of [source.id, target.id]) {
        const stored = ctx.sqlite
          .prepare<
            { thread_count: number; post_count: number; last_post_id: number | null },
            [number]
          >("SELECT thread_count, post_count, last_post_id FROM nodes WHERE id = ?1")
          .get(nodeId)!;
        const recount = ctx.sqlite
          .prepare<{ threads: number; posts: number }, [number]>(
            "SELECT count(DISTINCT t.id) AS threads, count(p.id) AS posts FROM threads t LEFT JOIN posts p ON p.thread_id = t.id AND p.state = 'visible' WHERE t.node_id = ?1 AND t.state = 'visible'",
          )
          .get(nodeId)!;
        const latest = ctx.sqlite
          .prepare<{ last_post_id: number } | null, [number]>(
            "SELECT last_post_id FROM threads WHERE node_id = ?1 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
          )
          .get(nodeId);
        expect([stored.thread_count, stored.post_count, stored.last_post_id]).toEqual([
          recount.threads,
          recount.posts,
          latest?.last_post_id ?? null,
        ]);
      }
      for (const user of [first, second]) {
        if (user.kind === "guest") continue;
        const stored = ctx.sqlite
          .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
          .get(user.userId)!.post_count;
        const recount = ctx.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
          )
          .get(user.userId)!.n;
        expect(stored).toBe(recount);
      }
    };
    const created = await call(ctx, threadsCreateOp, first, {
      nodeId: source.id,
      title: "T",
      body: "B",
    });
    verify();
    const reply = await call(ctx, postsCreateOp, second, {
      threadId: created.thread.id,
      body: "R",
    });
    verify();
    await call(ctx, postsDeleteOp, second, { postId: reply.id });
    verify();
    await call(ctx, postsRestoreOp, mod, { postId: reply.id });
    verify();
    await call(ctx, threadsMoveOp, mod, { threadId: created.thread.id, nodeId: target.id });
    verify();
    await call(ctx, threadsDeleteOp, mod, { threadId: created.thread.id });
    verify();
    await call(ctx, threadsRestoreOp, mod, { threadId: created.thread.id });
    verify();
  });
});
