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
    run: (env, i) =>
      env.call("posts.get", env.actors.member(i), {
        postId: env.meta.postAuthors[i % env.meta.postAuthors.length]![0],
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
    name: "posts.delete+restore huge start",
    kind: "write",
    setup: prepare,
    iterations: 30,
    async run(env) {
      await env.call("posts.delete", env.actors.moderator(0), { postId: hugePost });
      return env.call("posts.restore", env.actors.moderator(0), { postId: hugePost });
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
    async run(env) {
      await env.call("threads.move", env.actors.moderator(0), {
        threadId: movable,
        nodeId: targetNode,
      });
      return env.call("threads.move", env.actors.moderator(0), {
        threadId: movable,
        nodeId: sourceNode,
      });
    },
  },
  {
    name: "threads.delete+restore typical",
    kind: "write",
    setup: prepare,
    async run(env) {
      await env.call("threads.delete", env.actors.moderator(0), { threadId: movable });
      return env.call("threads.restore", env.actors.moderator(0), { threadId: movable });
    },
  },
  {
    name: "threads.delete+restore huge",
    kind: "write",
    setup: prepare,
    iterations: 20,
    async run(env) {
      await env.call("threads.delete", env.actors.moderator(0), { threadId: hugeThread });
      return env.call("threads.restore", env.actors.moderator(0), { threadId: hugeThread });
    },
  },
];
