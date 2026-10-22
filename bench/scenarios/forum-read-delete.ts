import { registerModerationJobs, runDueJobs } from "@sermo/core";
import { invalidate } from "../../packages/core/src/context";
import type { BenchEnv, Scenario } from "../harness";

/** Members whose forum marker the read scenario sets before it measures. */
const MARKED_MEMBERS = 50;
/** Chunks one deletion scenario runs: its warmups and measured iterations, with room to spare. */
const CHUNKS = 30;

let forumId = 0;
let victimId = 0;
let sinkId = 0;

function biggestForum(env: BenchEnv): number {
  return env.meta.bigForumIds[0]!;
}

/**
 * A forum of benchmark threads, each a copy of a small seeded one with its posts, so the
 * deletion works on real rows and no seeded thread is touched.
 */
function makeForum(env: BenchEnv, title: string, threads: number): number {
  const db = env.ctx.sqlite;
  const parent = db
    .prepare<{ parent_id: number | null }, [number]>("SELECT parent_id FROM nodes WHERE id = ?1")
    .get(env.meta.forumIds[0]!)!.parent_id;
  const nodeId = Number(
    db
      .prepare(
        "INSERT INTO nodes (parent_id, type, title, position) VALUES (?1, 'forum', ?2, 9999)",
      )
      .run(parent, title).lastInsertRowid,
  );
  if (threads > 0) {
    const sources = db
      .prepare<{ id: number }, []>(
        "SELECT id FROM threads WHERE state = 'visible' AND reply_count BETWEEN 3 AND 10 LIMIT 300",
      )
      .all()
      .map((row) => row.id);
    const cloneThread = db.prepare(
      "INSERT INTO threads (node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, last_post_at, last_poster_id, excerpt) SELECT ?1, user_id, title || ' benchmark clone', state, 0, 0, created_at, reply_count, last_post_at, last_poster_id, excerpt FROM threads WHERE id = ?2",
    );
    const clonePosts = db.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at, edited_at, reaction_counts, reaction_total, attachment_count) SELECT ?1, user_id, position, state, created_at, edited_at, reaction_counts, reaction_total, attachment_count FROM posts WHERE thread_id = ?2 ORDER BY position",
    );
    const cloneBodies = db.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) SELECT id, 'Benchmark body', '<p>Benchmark body</p>' FROM posts WHERE thread_id = ?1",
    );
    const link = db.prepare(
      "UPDATE threads SET first_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT 1), last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1) WHERE id = ?1",
    );
    db.transaction(() => {
      for (let n = 0; n < threads; n++) {
        const source = sources[n % sources.length]!;
        const cloneId = Number(cloneThread.run(nodeId, source).lastInsertRowid);
        clonePosts.run(cloneId, source);
        cloneBodies.run(cloneId);
        link.run(cloneId);
      }
    })();
    db.prepare(
      "UPDATE nodes SET thread_count = (SELECT count(*) FROM threads WHERE node_id = ?1), post_count = (SELECT coalesce(sum(reply_count + 1), 0) FROM threads WHERE node_id = ?1) WHERE id = ?1",
    ).run(nodeId);
  }
  invalidate(env.ctx, "node_tree");
  return nodeId;
}

/**
 * Removes a forum this file made, with its threads, posts and markers. Every row in it was
 * written here row by row (no counters, reads or watches of members), so removing them row by row
 * leaves the seeded data as it was.
 */
function dropForum(env: BenchEnv, nodeId: number): void {
  const db = env.ctx.sqlite;
  db.transaction(() => {
    for (const sql of [
      "DELETE FROM post_bodies WHERE post_id IN (SELECT p.id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1)",
      "DELETE FROM posts WHERE thread_id IN (SELECT id FROM threads WHERE node_id = ?1)",
      "DELETE FROM threads WHERE node_id = ?1",
      "DELETE FROM node_reads WHERE node_id = ?1",
      "DELETE FROM nodes WHERE id = ?1",
    ])
      db.prepare(sql).run(nodeId);
  })();
  invalidate(env.ctx, "node_tree");
}

/** The newest marker row now: the rows after it are the ones a scenario wrote. */
const lastMarker = (env: BenchEnv) =>
  env.ctx.sqlite
    .prepare<{ n: number }, []>("SELECT coalesce(max(id), 0) AS n FROM node_reads")
    .get()!.n;
let markersFrom = 0;
/** Keeps the markers there are now; `dropMarkers` removes those written after. */
function keepMarkers(env: BenchEnv): void {
  markersFrom = lastMarker(env);
}
function dropMarkers(env: BenchEnv): void {
  env.ctx.sqlite.prepare("DELETE FROM node_reads WHERE id > ?1").run(markersFrom);
}

/**
 * Threads of `posts` posts each (visible, created in order, no bodies): the long threads of a
 * 20-year forum, whose size the chunk bounds have to count.
 */
function addLongThreads(env: BenchEnv, nodeId: number, count: number, posts: number): void {
  const db = env.ctx.sqlite;
  const author = env.meta.memberIds[0]!;
  const start = Date.now() - 30 * 86_400_000;
  const thread = db.prepare(
    "INSERT INTO threads (node_id, user_id, title, state, created_at, reply_count, last_post_at, last_poster_id, excerpt) VALUES (?1, ?2, 'Benchmark long thread', 'visible', ?3, ?4, ?3, ?2, '')",
  );
  const fill = db.prepare(
    "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?4 - 1) INSERT INTO posts (thread_id, user_id, position, state, created_at) SELECT ?1, ?2, i, 'visible', ?3 + i FROM n",
  );
  const link = db.prepare(
    "UPDATE threads SET first_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT 1), last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1) WHERE id = ?1",
  );
  db.transaction(() => {
    for (let n = 0; n < count; n++) {
      const id = Number(thread.run(nodeId, author, start, posts - 1).lastInsertRowid);
      fill.run(id, author, start, posts);
      link.run(id);
    }
    db.prepare(
      "UPDATE nodes SET thread_count = (SELECT count(*) FROM threads WHERE node_id = ?1), post_count = (SELECT coalesce(sum(reply_count + 1), 0) FROM threads WHERE node_id = ?1) WHERE id = ?1",
    ).run(nodeId);
  })();
}

/**
 * The post counts of the members who wrote in the forum being deleted. The copies never counted,
 * but hiding them takes them off their authors: put back once the deletion is done.
 */
let counts: { id: number; post_count: number }[] = [];

async function startDeletion(
  env: BenchEnv,
  threads: "move" | "delete",
  long?: { count: number; posts: number },
) {
  registerModerationJobs(env.ctx);
  victimId = makeForum(
    env,
    "Benchmark deletion",
    long ? 0 : CHUNKS * (threads === "move" ? 100 : 20),
  );
  if (long) addLongThreads(env, victimId, long.count, long.posts);
  counts = env.ctx.sqlite
    .prepare<{ id: number; post_count: number }, [number]>(
      "SELECT id, post_count FROM users WHERE id IN (SELECT DISTINCT p.user_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1)",
    )
    .all(victimId);
  sinkId = threads === "move" ? makeForum(env, "Benchmark sink", 0) : 0;
  await env.callInProcess("nodes.delete", env.actors.admin, {
    nodeId: victimId,
    threads: threads === "move" ? { action: "move", nodeId: sinkId } : { action: "delete" },
    children: "moveUp",
  });
}

/** Finishes the deletion, then leaves nothing of it: the sink goes and the counts come back. */
async function endDeletion(env: BenchEnv): Promise<void> {
  await finishDeletion(env);
  if (sinkId) dropForum(env, sinkId);
  sinkId = 0;
  const restore = env.ctx.sqlite.prepare("UPDATE users SET post_count = ?1 WHERE id = ?2");
  for (const row of counts) restore.run(row.post_count, row.id);
  counts = [];
}

const chunksDone = (env: BenchEnv) =>
  env.ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type = 'forums.deleteNode' AND status = 'done'",
    )
    .get()!.n;

/** Runs the deletion job until it has done one chunk of work. */
async function oneChunk(env: BenchEnv): Promise<void> {
  const before = chunksDone(env);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await runDueJobs(env.ctx, { limit: 1 }))) break;
    if (chunksDone(env) > before) return;
  }
  throw new Error("The forum deletion job did not take a chunk.");
}

async function finishDeletion(env: BenchEnv): Promise<void> {
  for (let guard = 0; guard < 10_000; guard++) {
    const pending = env.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM jobs WHERE type = 'forums.deleteNode' AND status IN ('pending', 'running')",
      )
      .get()!.n;
    if (pending === 0) return;
    if (!(await runDueJobs(env.ctx, { limit: 1 }))) throw new Error("Forum deletion stalled.");
  }
  throw new Error("Forum deletion did not finish.");
}

/**
 * A thread of 200,000 posts, in a forum of its own, that a member read only through "mark forum
 * read" before it got one more post. Written row by row, and removed with its forum afterwards.
 */
const LONG_THREAD = 200_000;
let longThread = 0;
let longForum = 0;
async function longThreadReadThroughMarker(env: BenchEnv): Promise<void> {
  const db = env.ctx.sqlite;
  longForum = makeForum(env, "Benchmark long thread", 0);
  addLongThreads(env, longForum, 1, LONG_THREAD);
  longThread = db
    .prepare<{ id: number }, [number]>("SELECT id FROM threads WHERE node_id = ?1")
    .get(longForum)!.id;
  await env.call("nodes.markRead", env.actors.member(0), { nodeId: longForum });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const at = Date.now();
  const reply = db
    .prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    )
    .run(longThread, env.meta.memberIds[1]!, LONG_THREAD, at).lastInsertRowid;
  db.prepare(
    "UPDATE threads SET reply_count = ?1, last_post_id = ?2, last_post_at = ?3, last_poster_id = ?4 WHERE id = ?5",
  ).run(LONG_THREAD, reply, at, env.meta.memberIds[1]!, longThread);
  db.prepare("UPDATE nodes SET post_count = post_count + 1, last_post_at = ?1 WHERE id = ?2").run(
    at,
    longForum,
  );
}
function dropLongThread(env: BenchEnv): void {
  dropForum(env, longForum);
  longForum = 0;
  longThread = 0;
}

export const scenarios: Scenario[] = [
  {
    // Read only through the marker (no read row of its own): the first unread post is one seek.
    name: "threads.locateUnread, 200k-post thread read through the marker",
    kind: "read",
    setup: longThreadReadThroughMarker,
    teardown: dropLongThread,
    run: (env) => env.call("threads.locateUnread", env.actors.member(0), { threadId: longThread }),
  },
  {
    name: "feed.list unread, 200k-post thread read through the marker",
    kind: "read",
    setup: longThreadReadThroughMarker,
    teardown: dropLongThread,
    run: (env) => env.call("feed.list", env.actors.member(0), { unread: true, limit: 20 }),
  },
  {
    name: "nodes.markRead biggest forum",
    kind: "write",
    setup(env) {
      forumId = biggestForum(env);
      keepMarkers(env);
    },
    teardown: dropMarkers,
    run: (env, i) => env.call("nodes.markRead", env.actors.member(i), { nodeId: forumId }),
  },
  {
    name: "nodes.markAllRead",
    kind: "write",
    setup: keepMarkers,
    teardown: dropMarkers,
    run: (env, i) => env.call("nodes.markAllRead", env.actors.member(i), {}),
  },
  {
    // The read path after members marked a forum read: the marker is one more indexed lookup.
    name: "threads.list first page, forum marked read",
    kind: "read",
    async setup(env) {
      forumId = biggestForum(env);
      keepMarkers(env);
      for (let i = 0; i < MARKED_MEMBERS; i++)
        await env.call("nodes.markRead", env.actors.member(i), { nodeId: forumId });
    },
    teardown: dropMarkers,
    run: (env, i) =>
      env.call("threads.list", env.actors.member(i % MARKED_MEMBERS), {
        nodeId: forumId,
        limit: 20,
      }),
  },
  {
    name: "feed.list unread, forum marked read",
    kind: "read",
    async setup(env) {
      forumId = biggestForum(env);
      keepMarkers(env);
      for (let i = 0; i < MARKED_MEMBERS; i++)
        await env.call("nodes.markRead", env.actors.member(i), { nodeId: forumId });
    },
    teardown: dropMarkers,
    run: (env, i) =>
      env.call("feed.list", env.actors.member(i % MARKED_MEMBERS), { unread: true, limit: 20 }),
  },
  {
    // One chunk of the job (one transaction): 100 threads, at most 5,000 posts, moved.
    name: "forums.deleteNode move chunk",
    kind: "write",
    iterations: 20,
    setup: (env) => startDeletion(env, "move"),
    run: (env) => oneChunk(env),
    teardown: endDeletion,
  },
  {
    // One chunk of the job (one transaction): one thread of 20,000 posts moved.
    name: "forums.deleteNode move chunk, 20k-post threads",
    kind: "write",
    iterations: 20,
    setup: (env) => startDeletion(env, "move", { count: CHUNKS, posts: 20_000 }),
    run: (env) => oneChunk(env),
    teardown: endDeletion,
  },
  {
    // A visible thread of 600 posts: hiding it regroups its authors' counts, which the chunk
    // charges, then up to 500 of its posts go.
    name: "forums.deleteNode delete chunk, 600-post threads",
    kind: "write",
    iterations: 20,
    setup: (env) => startDeletion(env, "delete", { count: CHUNKS, posts: 600 }),
    run: (env) => oneChunk(env),
    teardown: endDeletion,
  },
  {
    // One chunk of the job (one transaction): up to 20 threads and 500 posts removed for good.
    name: "forums.deleteNode delete chunk",
    kind: "write",
    iterations: 20,
    setup: (env) => startDeletion(env, "delete"),
    run: (env) => oneChunk(env),
    teardown: endDeletion,
  },
];
