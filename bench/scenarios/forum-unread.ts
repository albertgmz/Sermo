import type { BenchEnv, Scenario } from "../harness";

/** Members whose forum markers the marked scenario sets before it measures. */
const MARKED_MEMBERS = 50;

let markersFrom = 0;

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
];
