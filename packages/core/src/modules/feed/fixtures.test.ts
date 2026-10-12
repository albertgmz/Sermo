import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { postsCreateOp, threadsCreateOp } from "../forums";

/** Tests only: a small forum with an open forum, one hidden from members and guests, and people. */
export function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const mod = userActor(insertUser(ctx, { groupId: 3 }));
  const aliceUser = insertUser(ctx, { username: "alice" });
  const bobUser = insertUser(ctx, { username: "bob" });
  const carolUser = insertUser(ctx, { username: "carol" });
  const alice = userActor(aliceUser);
  const bob = userActor(bobUser);
  const carol = userActor(carolUser);
  const category = insertNode(ctx, { type: "category" });
  const open = insertNode(ctx, { parentId: category.id });
  const secret = insertNode(ctx, { parentId: category.id });
  for (const group of [1, 2])
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, ?2, 0)")
      .run(secret.id, group);
  invalidate(ctx, "node_tree");
  invalidate(ctx, "permissions");
  return {
    ctx,
    admin,
    mod,
    alice,
    bob,
    carol,
    aliceUser,
    bobUser,
    carolUser,
    category,
    open,
    secret,
    /** Creates a thread one minute after the previous activity. */
    async thread(actor: Actor, nodeId: number, title: string, body = `${title} body`) {
      ctx.clock.advance(60_000);
      return execute(ctx, threadsCreateOp, actor, { nodeId, title, body } as never);
    },
    async reply(actor: Actor, threadId: number, body: string) {
      ctx.clock.advance(60_000);
      return execute(ctx, postsCreateOp, actor, { threadId, body } as never);
    },
    async wall(actor: Actor, ownerId: number, body: string) {
      ctx.clock.advance(60_000);
      return (await execute(ctx, getOperation("profilePosts.create"), actor, {
        userId: ownerId,
        body,
      })) as { id: number };
    },
    call: (name: string, actor: Actor, input: object) =>
      // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
      execute(ctx, getOperation(name), actor, input) as Promise<any>,
  };
}

export type World = ReturnType<typeof world>;

/** Inserts `count` visible posts into a thread without bodies, newest ids: bulk filler. */
export function fillPosts(ctx: Ctx, threadId: number, userId: number, count: number): void {
  const insert = ctx.sqlite.prepare(
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
  );
  const start =
    ctx.sqlite
      .prepare<{ p: number | null }, [number]>(
        "SELECT max(position) AS p FROM posts WHERE thread_id = ?1",
      )
      .get(threadId)!.p ?? -1;
  for (let i = 1; i <= count; i++) insert.run(threadId, userId, start + i, ctx.now());
}

test("the fixture world hides one forum from members and guests", async () => {
  const w = world();
  const visible = await w.call("nodes.list", w.alice, {});
  expect(visible.items.map((node: { id: number }) => node.id)).not.toContain(w.secret.id);
  const staff = await w.call("nodes.list", w.admin, {});
  expect(staff.items.map((node: { id: number }) => node.id)).toContain(w.secret.id);
});

/**
 * Inserts `count` visible threads, each with its opening post, without bodies: bulk filler that
 * still reads back through the operations. `at` and `replies` map the index to the thread's
 * activity time and reply count.
 */
export function fillThreads(
  ctx: Ctx,
  nodeId: number,
  userId: number,
  count: number,
  options: { at?: (i: number) => number; replies?: (i: number) => number } = {},
): number[] {
  const thread = ctx.sqlite.prepare<{ id: number }, [number, number, number, number]>(
    "INSERT INTO threads (node_id, user_id, title, state, created_at, reply_count, last_post_at, last_poster_id) VALUES (?1, ?2, 'filler', 'visible', ?3, ?4, ?3, ?2) RETURNING id",
  );
  const post = ctx.sqlite.prepare<{ id: number }, [number, number, number]>(
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, 0, 'visible', ?3) RETURNING id",
  );
  const link = ctx.sqlite.prepare(
    "UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2",
  );
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = options.at?.(i) ?? ctx.now();
    const id = thread.get(nodeId, userId, at, options.replies?.(i) ?? 0)!.id;
    link.run(post.get(id, userId, at)!.id, id);
    ids.push(id);
  }
  return ids;
}

/**
 * Tests only: how many statements `run` executes. Cached statements are dropped first so the
 * ones the run prepares are the ones counted.
 */
export async function countStatements(ctx: Ctx, run: () => Promise<unknown>): Promise<number> {
  let count = 0;
  const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
  ctx.statements.clear();
  // biome-ignore lint/suspicious/noExplicitAny: the wrapper forwards whatever the statement takes
  (ctx.sqlite as any).prepare = (sql: string) => {
    // biome-ignore lint/suspicious/noExplicitAny: bun's statement type is generic over its rows
    const statement = prepare(sql) as any;
    for (const method of ["get", "all", "run", "values", "iterate"]) {
      const original = statement[method].bind(statement);
      statement[method] = (...args: unknown[]) => {
        count++;
        return original(...args);
      };
    }
    return statement;
  };
  try {
    await run();
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: restoring the method replaced above
    (ctx.sqlite as any).prepare = prepare;
    ctx.statements.clear();
  }
  return count;
}
