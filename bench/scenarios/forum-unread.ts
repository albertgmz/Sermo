import { actorUserId } from "../../packages/core/src/actor";
import { UNREAD_SCAN } from "../../packages/core/src/modules/forums/read-marks";
import type { BenchEnv, Scenario } from "../harness";

/** Members whose forum markers the marked scenario sets before it measures. */
const MARKED_MEMBERS = 50;

let markersFrom = 0;
let readsFrom = 0;
/** Members who have read every recent thread of the big forums, without a forum marker. */
const READERS = 5;

function keepMarkers(env: BenchEnv): void {
  markersFrom =
    env.ctx.sqlite.prepare<{ id: number | null }, []>("SELECT max(id) AS id FROM node_reads").get()!
      .id ?? 0;
}
function dropMarkers(env: BenchEnv): void {
  env.ctx.sqlite.prepare("DELETE FROM node_reads WHERE id > ?1").run(markersFrom);
}

export const scenarios: Scenario[] = [
  {
    // One query for the whole tree: every forum the member can see, one seek each of the threads
    // index; a forum with an unread thread stops at its first.
    name: "nodes.unread, no markers",
    kind: "read",
    run: (env, i) => env.call("nodes.unread", env.actors.member(i), {}),
  },
  {
    // Every forum marked read: the marker narrows each seek to nothing.
    name: "nodes.unread, all forums marked read",
    kind: "read",
    async setup(env) {
      keepMarkers(env);
      for (let i = 0; i < MARKED_MEMBERS; i++)
        await env.call("nodes.markAllRead", env.actors.member(i), {});
    },
    teardown: dropMarkers,
    run: (env, i) => env.call("nodes.unread", env.actors.member(i % MARKED_MEMBERS), {}),
  },
  {
    // The heavy case: no forum marker, and a thread_reads row for the newest threads of every big
    // forum, so each forum is scanned to the cap before it counts as read. Expected: at most
    // UNREAD_SCAN (100) index seeks per forum, p95 <= 20 ms for the whole tree.
    name: "nodes.unread, every recent thread of the big forums read",
    kind: "read",
    setup(env) {
      const db = env.ctx.sqlite;
      readsFrom =
        db.prepare<{ id: number | null }, []>("SELECT max(id) AS id FROM thread_reads").get()!.id ??
        0;
      const insert = db.prepare(
        "INSERT OR IGNORE INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) SELECT ?1, id, last_post_id, 0, ?2 FROM (SELECT id, last_post_id FROM threads WHERE node_id = ?3 AND state = 'visible' ORDER BY last_post_at DESC LIMIT ?4)",
      );
      db.transaction(() => {
        for (let i = 0; i < READERS; i++)
          for (const nodeId of env.meta.bigForumIds)
            insert.run(actorUserId(env.actors.member(i))!, env.ctx.now(), nodeId, UNREAD_SCAN);
      })();
    },
    teardown(env) {
      env.ctx.sqlite.prepare("DELETE FROM thread_reads WHERE id > ?1").run(readsFrom);
    },
    run: (env, i) => env.call("nodes.unread", env.actors.member(i % READERS), {}),
  },
];
