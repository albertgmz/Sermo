import { registerModerationJobs, runDueJobs } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

const ids = (env: BenchEnv, sql: string, value?: number): number[] =>
  (value === undefined
    ? env.ctx.sqlite.prepare<{ id: number }, []>(sql).all()
    : env.ctx.sqlite.prepare<{ id: number }, [number]>(sql).all(value)
  ).map((r) => r.id);
const choose = (values: number[], i: number) => values[i % values.length]!;
let typical: number[] = [];
let editable: number[] = [];
let hugePost = 0;
let hugeThread = 0;
let movable = 0;
let sourceNode = 0;
let targetNode = 0;
let deepCursor: string | null = null;
let getPostIds: number[] = [];
let warmupThreads: number[] = [];
let largestTransferTarget = 0;

function prepare(env: BenchEnv) {
  typical = ids(
    env,
    "SELECT id FROM threads WHERE state = 'visible' AND is_locked = 0 AND reply_count BETWEEN 3 AND 100 LIMIT 300",
  );
  editable = ids(
    env,
    "SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' AND position > 0 LIMIT 100",
    typical[0],
  );
  hugeThread = env.meta.bigThreadIds[0]!;
  hugePost = env.ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' AND position = 1 LIMIT 1",
    )
    .get(hugeThread)!.id;
  movable = typical[0]!;
  sourceNode = env.ctx.sqlite
    .prepare<{ node_id: number }, [number]>("SELECT node_id FROM threads WHERE id = ?1")
    .get(movable)!.node_id;
  targetNode = env.meta.forumIds.find((id) => id !== sourceNode)!;
}
function preparePostsGet(env: BenchEnv) {
  getPostIds = env.ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT p.id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.state = 'visible' AND t.state = 'visible' LIMIT 500",
    )
    .all()
    .map((r) => r.id);
}

function prepareTransfers(env: BenchEnv) {
  prepare(env);
  warmupThreads = [];
  const sourceId = env.meta.bigThreadIds[0]!;
  for (let i = 0; i < 2; i++) {
    const cloneId = Number(
      env.ctx.sqlite
        .prepare(
          "INSERT INTO threads (node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, last_post_at, last_poster_id, excerpt) SELECT node_id, user_id, title || ' benchmark clone', state, is_sticky, is_locked, created_at, reply_count, last_post_at, last_poster_id, excerpt FROM threads WHERE id = ?1",
        )
        .run(sourceId).lastInsertRowid,
    );
    env.ctx.sqlite
      .prepare(
        "INSERT INTO posts (thread_id, user_id, position, state, created_at, edited_at, reaction_counts, attachment_count) SELECT ?1, user_id, position, state, created_at, edited_at, reaction_counts, attachment_count FROM posts WHERE thread_id = ?2 ORDER BY position",
      )
      .run(cloneId, sourceId);
    env.ctx.sqlite
      .prepare(
        "INSERT INTO post_bodies (post_id, body_source, body_html) SELECT id, 'Benchmark body', '<p>Benchmark body</p>' FROM posts WHERE thread_id = ?1",
      )
      .run(cloneId);
    env.ctx.sqlite
      .prepare(
        "UPDATE threads SET first_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT 1), last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1) WHERE id = ?1",
      )
      .run(cloneId);
    env.ctx.sqlite
      .prepare(
        "UPDATE nodes SET thread_count = thread_count + 1, post_count = post_count + (SELECT reply_count + 1 FROM threads WHERE id = ?1) WHERE id = (SELECT node_id FROM threads WHERE id = ?1)",
      )
      .run(cloneId);
    warmupThreads.push(cloneId);
  }
}
const transferSource = (env: BenchEnv, i: number) =>
  i < 10 ? env.meta.bigThreadIds[i]! : warmupThreads[i - 10]!;

async function completeTransfers(env: BenchEnv, kind: "merge" | "split") {
  registerModerationJobs(env.ctx);
  const start = performance.now();
  let largestReported = false;
  for (let i = 0; i < 5000; i++) {
    const active = env.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM jobs WHERE type IN ('forums.merge', 'forums.mergeFinalize', 'forums.split') AND status IN ('pending', 'running')",
      )
      .get()!.n;
    if (!active) break;
    if (!(await runDueJobs(env.ctx, { limit: 1 }))) throw new Error(`${kind} work stalled`);
    const largestActive = env.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM jobs WHERE type IN ('forums.merge', 'forums.mergeFinalize', 'forums.split') AND status IN ('pending', 'running') AND json_extract(payload, '$.targetId') = ?1",
      )
      .get(largestTransferTarget)!.n;
    if (!largestReported && !largestActive) {
      console.log(`${kind} largest completion: ${(performance.now() - start).toFixed(2)} ms`);
      largestReported = true;
    }
  }
  const failed = env.ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type IN ('forums.merge', 'forums.mergeFinalize', 'forums.split') AND status = 'failed'",
    )
    .get()!.n;
  if (failed) throw new Error(`${kind} transfer jobs failed: ${failed}`);
}

export const scenarios: Scenario[] = [
  {
    name: "nodes.list guest",
    kind: "read",
    run: (env) => env.call("nodes.list", env.actors.guest, {}),
  },
  {
    name: "nodes.list member",
    kind: "read",
    run: (env, i) => env.call("nodes.list", env.actors.member(i), {}),
  },
  {
    name: "threads.list first",
    kind: "read",
    run: (env, i) =>
      env.call("threads.list", env.actors.member(i), {
        nodeId: choose(env.meta.bigForumIds, i),
        limit: 20,
      }),
  },
  {
    name: "threads.list deep",
    kind: "read",
    async setup(env) {
      const page = JSON.parse(
        (await env.call("threads.list", env.actors.member(0), {
          nodeId: env.meta.bigForumIds[0],
          limit: 100,
        })) as string,
      );
      deepCursor = page.nextCursor;
      for (let j = 0; j < 10 && deepCursor; j++) {
        const next = JSON.parse(
          (await env.call("threads.list", env.actors.member(0), {
            nodeId: env.meta.bigForumIds[0],
            cursor: deepCursor,
            limit: 100,
          })) as string,
        );
        deepCursor = next.nextCursor;
      }
    },
    run: (env, i) =>
      env.call("threads.list", env.actors.member(i), {
        nodeId: env.meta.bigForumIds[0],
        cursor: deepCursor ?? undefined,
        limit: 20,
      }),
  },
  {
    name: "threads.get",
    kind: "read",
    run: (env, i) =>
      env.call("threads.get", env.actors.member(i), { threadId: choose(env.meta.bigThreadIds, i) }),
  },
  {
    name: "posts.list huge member",
    kind: "read",
    run: (env, i) =>
      env.call("posts.list", env.actors.member(i), {
        threadId: choose(env.meta.bigThreadIds, i),
        page: (i % 300) + 1,
        limit: 20,
      }),
  },
  {
    name: "posts.list huge moderator",
    kind: "read",
    run: (env, i) =>
      env.call("posts.list", env.actors.moderator(i), {
        threadId: choose(env.meta.bigThreadIds, i),
        page: (i % 300) + 1,
        limit: 20,
      }),
  },
  {
    name: "posts.list typical member",
    kind: "read",
    setup: prepare,
    run: (env, i) =>
      env.call("posts.list", env.actors.member(i), {
        threadId: choose(typical, i),
        page: 1 + (i % 3),
        limit: 20,
      }),
  },
  {
    name: "posts.list typical moderator",
    kind: "read",
    setup: prepare,
    run: (env, i) =>
      env.call("posts.list", env.actors.moderator(i), {
        threadId: choose(typical, i),
        page: 1 + (i % 3),
        limit: 20,
      }),
  },
  {
    name: "posts.get",
    kind: "read",
    setup: preparePostsGet,
    run: (env, i) =>
      env.call("posts.get", env.actors.member(i), {
        postId: choose(getPostIds, i),
      }),
  },
  {
    name: "threads.create",
    kind: "write",
    run: (env, i) =>
      env.call("threads.create", env.actors.member(i), {
        nodeId: choose(env.meta.forumIds, i),
        title: `Benchmark thread ${i}`,
        body: "Benchmark body.",
      }),
  },
  {
    name: "posts.create typical",
    kind: "write",
    setup: prepare,
    run: (env, i) =>
      env.call("posts.create", env.actors.member(i), {
        threadId: choose(typical, i),
        body: "Benchmark reply.",
      }),
  },
  {
    name: "posts.create huge",
    kind: "write",
    run: (env, i) =>
      env.call("posts.create", env.actors.member(i), {
        threadId: choose(env.meta.bigThreadIds, i),
        body: "Benchmark reply.",
      }),
  },
  {
    name: "posts.update",
    kind: "write",
    setup: prepare,
    run: (env, i) =>
      env.call("posts.update", env.actors.moderator(i), {
        postId: choose(editable, i),
        body: `Updated ${i}`,
      }),
  },
  {
    name: "posts.delete/restore huge start",
    kind: "write",
    setup: prepare,
    iterations: 30,
    run(env) {
      const state = env.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM posts WHERE id = ?1")
        .get(hugePost)!.state;
      return env.call(
        state === "visible" ? "posts.delete" : "posts.restore",
        env.actors.moderator(0),
        { postId: hugePost },
      );
    },
  },
  {
    name: "threads.markRead",
    kind: "write",
    run: (env, i) =>
      env.call("threads.markRead", env.actors.member(i), {
        threadId: choose(env.meta.bigThreadIds, i),
        position: i % 100,
      }),
  },
  {
    name: "threads.move",
    kind: "write",
    setup: prepare,
    run(env) {
      const node = env.ctx.sqlite
        .prepare<{ node_id: number }, [number]>("SELECT node_id FROM threads WHERE id = ?1")
        .get(movable)!.node_id;
      return env.call("threads.move", env.actors.moderator(0), {
        threadId: movable,
        nodeId: node === sourceNode ? targetNode : sourceNode,
      });
    },
  },
  {
    name: "threads.move largest",
    kind: "write",
    iterations: 20,
    setup: prepare,
    run(env) {
      const node = env.ctx.sqlite
        .prepare<{ node_id: number }, [number]>("SELECT node_id FROM threads WHERE id = ?1")
        .get(hugeThread)!.node_id;
      return env.call("threads.move", env.actors.moderator(0), {
        threadId: hugeThread,
        nodeId: node === sourceNode ? targetNode : sourceNode,
      });
    },
  },
  {
    name: "threads.delete/restore typical",
    kind: "write",
    setup: prepare,
    run(env) {
      const state = env.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(movable)!.state;
      return env.call(
        state === "visible" ? "threads.delete" : "threads.restore",
        env.actors.moderator(0),
        { threadId: movable },
      );
    },
  },
  {
    name: "threads.delete/restore huge",
    kind: "write",
    setup: prepare,
    iterations: 20,
    run(env) {
      const state = env.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(hugeThread)!.state;
      return env.call(
        state === "visible" ? "threads.delete" : "threads.restore",
        env.actors.moderator(0),
        { threadId: hugeThread },
      );
    },
  },
  {
    name: "threads.merge largest request",
    kind: "write",
    iterations: 10,
    setup: prepareTransfers,
    teardown: (env) => completeTransfers(env, "merge"),
    run: (env, i) => {
      const targetId = typical.filter((id) => !env.meta.bigThreadIds.includes(id))[i]!;
      if (i === 0) largestTransferTarget = targetId;
      return env.call("threads.merge", env.actors.moderator(0), {
        threadId: targetId,
        sourceThreadIds: [transferSource(env, i)],
      });
    },
  },
  {
    name: "threads.split 100 posts",
    kind: "write",
    iterations: 10,
    setup: prepareTransfers,
    run: (env, i) =>
      env.call("threads.split", env.actors.moderator(0), {
        threadId: transferSource(env, i),
        postIds: ids(
          env,
          "SELECT id FROM posts WHERE thread_id = ?1 AND position BETWEEN 1 AND 100 ORDER BY position",
          transferSource(env, i),
        ),
        title: "Benchmark split",
        nodeId: sourceNode,
      }),
  },
  {
    name: "threads.split largest range request",
    kind: "write",
    iterations: 10,
    setup: prepareTransfers,
    teardown: (env) => completeTransfers(env, "split"),
    async run(env, i) {
      const response = await env.call("threads.split", env.actors.moderator(0), {
        threadId: transferSource(env, i),
        fromPosition: 1,
        title: "Benchmark range split",
        nodeId: sourceNode,
      });
      if (i === 0) largestTransferTarget = JSON.parse(response as string).thread.id;
      return response;
    },
  },
];
