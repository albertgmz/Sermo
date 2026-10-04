import type { SQLQueryBindings } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import {
  postsCreateOp,
  postsDeleteOp,
  postsRestoreOp,
  postsUpdateOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsMoveOp,
  threadsRestoreOp,
  threadsSetLockedOp,
  threadsSetStickyOp,
  threadsUpdateOp,
} from "./index";

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("seeded forum writes preserve counters, last pointers and post positions", async () => {
  const ctx = createTestContext();
  const forums = [insertNode(ctx, {}), insertNode(ctx, {}), insertNode(ctx, {})];
  invalidate(ctx, "node_tree");
  const members = [
    userActor(insertUser(ctx)),
    userActor(insertUser(ctx)),
    userActor(insertUser(ctx)),
  ];
  const mods = [
    userActor(insertUser(ctx, { groupId: 3 })),
    userActor(insertUser(ctx, { groupId: 3 })),
  ];
  const next = random(0xc0ffee);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)]!;
  const rows = <T extends object>(sql: string, ...params: SQLQueryBindings[]): T[] =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql).all(...params);

  const recount = () => {
    for (const thread of rows<{
      id: number;
      reply_count: number;
      first_post_id: number;
      last_post_at: number;
      last_post_id: number;
      last_poster_id: number;
    }>(
      "SELECT id, reply_count, first_post_id, last_post_at, last_post_id, last_poster_id FROM threads",
    )) {
      const visible = rows<{ id: number; user_id: number; created_at: number }>(
        "SELECT id, user_id, created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY id",
        thread.id,
      );
      const last = visible.at(-1)!;
      expect([
        thread.reply_count,
        thread.first_post_id,
        thread.last_post_at,
        thread.last_post_id,
        thread.last_poster_id,
      ]).toEqual([
        visible.length - 1,
        rows<{ id: number }>(
          "SELECT id FROM posts WHERE thread_id = ?1 ORDER BY id LIMIT 1",
          thread.id,
        )[0]!.id,
        last.created_at,
        last.id,
        last.user_id,
      ]);
      let position = 0;
      for (const post of rows<{ id: number; position: number; state: string }>(
        "SELECT id, position, state FROM posts WHERE thread_id = ?1 ORDER BY id",
        thread.id,
      )) {
        expect(post.position).toBe(position);
        if (post.state === "visible") position++;
      }
    }
    for (const node of rows<{
      id: number;
      thread_count: number;
      post_count: number;
      last_post_at: number | null;
      last_post_id: number | null;
      last_thread_id: number | null;
      last_thread_title: string | null;
      last_poster_id: number | null;
    }>(
      "SELECT id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id FROM nodes",
    )) {
      const threads = rows<{ n: number }>(
        "SELECT count(*) AS n FROM threads WHERE node_id = ?1 AND state = 'visible'",
        node.id,
      )[0]!.n;
      const posts = rows<{ n: number }>(
        "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1 AND t.state = 'visible' AND p.state = 'visible'",
        node.id,
      )[0]!.n;
      const latest = rows<{
        id: number;
        title: string;
        last_post_at: number;
        last_post_id: number;
        last_poster_id: number;
      }>(
        "SELECT id, title, last_post_at, last_post_id, last_poster_id FROM threads WHERE node_id = ?1 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
        node.id,
      )[0];
      expect([
        node.thread_count,
        node.post_count,
        node.last_post_at,
        node.last_post_id,
        node.last_thread_id,
        node.last_thread_title,
        node.last_poster_id,
      ]).toEqual([
        threads,
        posts,
        latest?.last_post_at ?? null,
        latest?.last_post_id ?? null,
        latest?.id ?? null,
        latest?.title ?? null,
        latest?.last_poster_id ?? null,
      ]);
    }
    for (const user of rows<{ id: number; post_count: number }>(
      "SELECT id, post_count FROM users",
    )) {
      const count = rows<{ n: number }>(
        "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
        user.id,
      )[0]!.n;
      expect(user.post_count).toBe(count);
    }
  };

  const moderatedThread = await execute(ctx, threadsCreateOp, members[0]!, {
    nodeId: forums[0]!.id,
    title: "Moderated",
    body: "B",
  });
  const moderatedPost = await execute(ctx, postsCreateOp, members[0]!, {
    threadId: moderatedThread.thread.id,
    body: "R",
  });
  await execute(ctx, postsDeleteOp, members[0]!, { postId: moderatedPost.id });
  ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(moderatedPost.id);
  const secondThread = await execute(ctx, threadsCreateOp, members[1]!, {
    nodeId: forums[1]!.id,
    title: "Another",
    body: "B",
  });
  await execute(ctx, threadsDeleteOp, mods[0]!, { threadId: secondThread.thread.id });
  ctx.sqlite
    .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
    .run(secondThread.thread.id);
  recount();

  const kinds = [
    "thread",
    "reply",
    "reply",
    "reply",
    "postEdit",
    "postDelete",
    "postRestore",
    "threadDelete",
    "threadRestore",
    "move",
    "sticky",
    "lock",
    "title",
  ] as const;
  for (let step = 0; step < 320; step++) {
    ctx.clock.advance(1 + Math.floor(next() * 1000));
    const actor = next() < 0.5 ? pick(members) : pick(mods);
    const threadIds = rows<{ id: number }>("SELECT id FROM threads").map((r) => r.id);
    const postIds = rows<{ id: number }>("SELECT id FROM posts").map((r) => r.id);
    const kind = pick([...kinds]);
    try {
      switch (kind) {
        case "thread":
          await execute(ctx, threadsCreateOp, actor, {
            nodeId: pick(forums).id,
            title: `T${step}`,
            body: "B",
          });
          break;
        case "reply":
          await execute(ctx, postsCreateOp, actor, { threadId: pick(threadIds), body: "R" });
          break;
        case "postEdit":
          await execute(ctx, postsUpdateOp, actor, { postId: pick(postIds), body: `E${step}` });
          break;
        case "postDelete":
          await execute(ctx, postsDeleteOp, actor, { postId: pick(postIds) });
          break;
        case "postRestore":
          await execute(ctx, postsRestoreOp, actor, { postId: pick(postIds) });
          break;
        case "threadDelete":
          await execute(ctx, threadsDeleteOp, actor, { threadId: pick(threadIds) });
          break;
        case "threadRestore":
          await execute(ctx, threadsRestoreOp, actor, { threadId: pick(threadIds) });
          break;
        case "move":
          await execute(ctx, threadsMoveOp, actor, {
            threadId: pick(threadIds),
            nodeId: pick(forums).id,
          });
          break;
        case "sticky":
          await execute(ctx, threadsSetStickyOp, actor, {
            threadId: pick(threadIds),
            isSticky: next() < 0.5,
          });
          break;
        case "lock":
          await execute(ctx, threadsSetLockedOp, actor, {
            threadId: pick(threadIds),
            isLocked: next() < 0.5,
          });
          break;
        case "title":
          await execute(ctx, threadsUpdateOp, actor, {
            threadId: pick(threadIds),
            title: `E${step}`,
          });
          break;
      }
    } catch (error) {
      if (
        !(
          error instanceof ForbiddenError ||
          error instanceof NotFoundError ||
          error instanceof ValidationError
        )
      )
        throw error;
    }
    recount();
  }
});
