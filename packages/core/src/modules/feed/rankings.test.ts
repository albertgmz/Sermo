import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { runMinuteTasks } from "../jobs/scheduler";
import { world } from "./fixtures.test";
import {
  RANKED_EXAMINE_CAP,
  rankingSql,
  reactionTotal,
  refreshRankings,
  registerRankingJobs,
} from "./rankings";

const DAY = 86_400_000;
const ids = (page: { items: { id: number }[] }) => page.items.map((thread) => thread.id);
const stored = (w: ReturnType<typeof world>, kind: string) =>
  w.ctx.sqlite
    .prepare<{ target_id: number; score: number; position: number }, [string]>(
      "SELECT position, target_id, score FROM rankings WHERE kind = ?1 ORDER BY position",
    )
    .all(kind);

describe("the ranking job", () => {
  test("ranks threads active in the last 30 days by replies, views and opening-post reactions", async () => {
    const w = world();
    const t1 = await w.thread(w.alice, w.open.id, "T1");
    const t2 = await w.thread(w.alice, w.open.id, "T2");
    const t3 = await w.thread(w.alice, w.open.id, "T3");
    for (let i = 0; i < 3; i++) await w.reply(w.bob, t1.thread.id, `r${i}`);
    await w.reply(w.bob, t2.thread.id, "one");
    w.ctx.sqlite.prepare("UPDATE threads SET view_count = ?1 WHERE id = ?2").run(10, t3.thread.id);
    w.ctx.sqlite.prepare("UPDATE threads SET view_count = ?1 WHERE id = ?2").run(5, t2.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = ?1 WHERE id = ?2")
      .run('{"1":2,"3":1}', t2.post.id);
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = ?1 WHERE id = ?2")
      .run('{"1":1}', t3.post.id);
    refreshRankings(w.ctx);
    expect(stored(w, "mostReplied").map((row) => [row.target_id, row.score])).toEqual([
      [t1.thread.id, 3],
      [t2.thread.id, 1],
      [t3.thread.id, 0],
    ]);
    expect(stored(w, "mostViewed").map((row) => [row.target_id, row.score])).toEqual([
      [t3.thread.id, 10],
      [t2.thread.id, 5],
      [t1.thread.id, 0],
    ]);
    expect(stored(w, "mostReacted").map((row) => [row.target_id, row.score])).toEqual([
      [t2.thread.id, 3],
      [t3.thread.id, 1],
      [t1.thread.id, 0],
    ]);
    expect(stored(w, "mostReplied").map((row) => row.position)).toEqual([0, 1, 2]);
    const read = (by: string) => w.call("threads.ranked", GUEST, { by });
    expect(ids(await read("mostReplied"))).toEqual([t1.thread.id, t2.thread.id, t3.thread.id]);
    expect(ids(await read("mostViewed"))).toEqual([t3.thread.id, t2.thread.id, t1.thread.id]);
    expect(ids(await read("mostReacted"))).toEqual([t2.thread.id, t3.thread.id, t1.thread.id]);
    expect(ids(await w.call("threads.ranked", GUEST, { by: "mostReplied", limit: 2 }))).toEqual([
      t1.thread.id,
      t2.thread.id,
    ]);
  });

  test("threads quiet for 30 days and threads that are not visible are not ranked", async () => {
    const w = world();
    const old = await w.thread(w.alice, w.open.id, "Old");
    const gone = await w.thread(w.alice, w.open.id, "Gone");
    const live = await w.thread(w.alice, w.open.id, "Live");
    for (const t of [old, gone, live]) await w.reply(w.bob, t.thread.id, "x");
    w.ctx.sqlite
      .prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2")
      .run(w.ctx.now() - 31 * DAY, old.thread.id);
    await w.call("threads.delete", w.mod, { threadId: gone.thread.id, reason: "x", notify: false });
    refreshRankings(w.ctx);
    expect(stored(w, "mostReplied").map((row) => row.target_id)).toEqual([live.thread.id]);
  });

  test("each ranking keeps 100 threads and a rerun replaces the rows rather than adding", async () => {
    const w = world();
    const category = w.open.id;
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, reply_count, view_count, last_post_at, last_poster_id) VALUES (?1, ?2, 't', 'visible', ?3, ?4, ?4, ?3, ?2)",
    );
    for (let i = 0; i < 130; i++) insert.run(category, w.aliceUser.id, w.ctx.now(), i);
    refreshRankings(w.ctx);
    refreshRankings(w.ctx);
    const replied = stored(w, "mostReplied");
    expect(replied).toHaveLength(100);
    expect(replied[0]!.score).toBe(129);
    expect(replied.at(-1)!.score).toBe(30);
    expect(stored(w, "mostViewed")).toHaveLength(100);
  });

  test("feedTop: the week's most reacted-to visible posts, positive totals only, best first", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Week");
    const p1 = await w.reply(w.bob, t.thread.id, "low");
    const p2 = await w.reply(w.bob, t.thread.id, "high");
    const p3 = await w.reply(w.bob, t.thread.id, "none");
    const hidden = await w.thread(w.admin, w.secret.id, "Hidden forum");
    const dead = await w.thread(w.alice, w.open.id, "Dead");
    await w.call("threads.delete", w.mod, { threadId: dead.thread.id, reason: "x", notify: false });
    const removed = await w.reply(w.bob, t.thread.id, "removed");
    await w.call("posts.delete", w.mod, { postId: removed.id, reason: "x", notify: false });
    const set = (id: number, counts: string) =>
      w.ctx.sqlite.prepare("UPDATE posts SET reaction_counts = ?1 WHERE id = ?2").run(counts, id);
    set(p1.id, '{"1":1}');
    set(p2.id, '{"1":2,"2":2}');
    set(p3.id, "{}");
    set(hidden.post.id, '{"1":50}');
    set(dead.post.id, '{"1":50}');
    set(removed.id, '{"1":50}');
    // Older than a week: not in the window however well it did.
    const oldReply = await w.reply(w.bob, t.thread.id, "old");
    set(oldReply.id, '{"1":99}');
    w.ctx.sqlite
      .prepare("UPDATE posts SET created_at = ?1 WHERE id = ?2")
      .run(w.ctx.now() - 8 * DAY, oldReply.id);
    refreshRankings(w.ctx);
    expect(stored(w, "feedTop").map((row) => [row.target_id, row.score])).toEqual([
      [hidden.post.id, 50],
      [p2.id, 4],
      [p1.id, 1],
    ]);
  });

  test("feedTop keeps the 200 best", () => {
    const w = world();
    const thread = w.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 't', 'visible', ?3, ?3, ?2) RETURNING id",
      )
      .get(w.open.id, w.aliceUser.id, w.ctx.now())!;
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at, reaction_counts) VALUES (?1, ?2, ?3, 'visible', ?4, ?5)",
    );
    for (let i = 0; i < 230; i++)
      insert.run(thread.id, w.aliceUser.id, i, w.ctx.now(), `{"1":${i + 1}}`);
    refreshRankings(w.ctx);
    const top = stored(w, "feedTop");
    expect(top).toHaveLength(200);
    expect(top[0]!.score).toBe(230);
    expect(top.at(-1)!.score).toBe(31);
  });

  test("with no posts or threads the rankings are empty and the job still runs", () => {
    const w = world();
    refreshRankings(w.ctx);
    expect(w.ctx.sqlite.prepare("SELECT 1 FROM rankings").get()).toBeNull();
  });

  test("runs as a job, scheduled on every fifth minute", async () => {
    const w = world();
    registerRankingJobs(w.ctx);
    const t = await w.thread(w.alice, w.open.id, "Job");
    await w.reply(w.bob, t.thread.id, "x");
    const queued = () =>
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'rankings.refresh'",
        )
        .get()!.n;
    w.ctx.clock.set(Date.UTC(2026, 5, 1, 12, 3, 0));
    runMinuteTasks(w.ctx);
    expect(queued()).toBe(0);
    w.ctx.clock.set(Date.UTC(2026, 5, 1, 12, 5, 0));
    runMinuteTasks(w.ctx);
    runMinuteTasks(w.ctx);
    expect(queued()).toBe(1);
    w.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1").run(w.ctx.now());
    expect(await runDueJobs(w.ctx)).toBeGreaterThanOrEqual(1);
    expect(stored(w, "mostReplied").map((row) => row.target_id)).toEqual([t.thread.id]);
    enqueueJob(w.ctx, "rankings.refresh", {});
  });

  test("totals a reaction_counts document", () => {
    expect(reactionTotal("{}")).toBe(0);
    expect(reactionTotal('{"1":2,"4":5}')).toBe(7);
  });

  test("every query of the job is bounded by an index", () => {
    const w = world();
    expectNoTableScan(w.ctx, rankingSql.activeThreads, [0, 100, 100, 2000]);
    expectNoTableScan(w.ctx, rankingSql.reactionCounts, ["[1]"]);
    expectNoTableScan(w.ctx, rankingSql.postAtOrAfter, [1]);
    expectNoTableScan(w.ctx, rankingSql.lastPostId);
    expectNoTableScan(w.ctx, rankingSql.recentPosts, [1, 2001, 0]);
    expectNoTableScan(w.ctx, rankingSql.visibleThreads, ["[1]"]);
    expectNoTableScan(w.ctx, rankingSql.replace, ["feedTop"]);
  });
});

describe("threads.ranked", () => {
  test("latestPosts and latestThreads order by activity and by creation", async () => {
    const w = world();
    const t1 = await w.thread(w.alice, w.open.id, "One");
    const t2 = await w.thread(w.alice, w.open.id, "Two");
    const t3 = await w.thread(w.alice, w.open.id, "Three");
    await w.reply(w.bob, t1.thread.id, "bump");
    const posts = await w.call("threads.ranked", GUEST, { by: "latestPosts" });
    expect(ids(posts)).toEqual([t1.thread.id, t3.thread.id, t2.thread.id]);
    expect(posts.items[0]).toMatchObject({ title: "One", node: { id: w.open.id } });
    expect(ids(await w.call("threads.ranked", GUEST, { by: "latestThreads" }))).toEqual([
      t3.thread.id,
      t2.thread.id,
      t1.thread.id,
    ]);
    expect(ids(await w.call("threads.ranked", GUEST, { by: "latestThreads", limit: 2 }))).toEqual([
      t3.thread.id,
      t2.thread.id,
    ]);
  });

  test("hidden forums and threads that are not visible are left out; staff see the hidden forum", async () => {
    const w = world();
    const open = await w.thread(w.alice, w.open.id, "Open");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    const gone = await w.thread(w.alice, w.open.id, "Gone");
    await w.reply(w.bob, open.thread.id, "x");
    await w.reply(w.bob, gone.thread.id, "x");
    await w.call("threads.delete", w.mod, { threadId: gone.thread.id, reason: "x", notify: false });
    refreshRankings(w.ctx);
    for (const by of ["latestPosts", "latestThreads", "mostReplied", "mostReacted", "mostViewed"]) {
      expect(ids(await w.call("threads.ranked", GUEST, { by }))).not.toContain(secret.thread.id);
      expect(ids(await w.call("threads.ranked", w.bob, { by }))).not.toContain(gone.thread.id);
      expect(ids(await w.call("threads.ranked", w.admin, { by }))).toContain(secret.thread.id);
    }
    // A thread deleted after the last refresh drops out of the stored rankings at once.
    expect(ids(await w.call("threads.ranked", GUEST, { by: "mostReplied" }))).toEqual([
      open.thread.id,
    ]);
  });

  test("looks through a bounded number of hidden rows, then returns what it found", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'h', 'visible', ?3, ?3, ?2)",
    );
    for (let i = 0; i < RANKED_EXAMINE_CAP; i++)
      insert.run(w.secret.id, w.aliceUser.id, w.ctx.now() + i + 1);
    // The visible thread is older than the cap allows the request to reach.
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestThreads" }))).toEqual([]);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestPosts" }))).toEqual([]);
    // Fewer hidden rows than the cap: found.
    w.ctx.sqlite.prepare("DELETE FROM threads WHERE title = 'h' AND id % 2 = 0").run();
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestThreads" }))).toEqual([
      visible.thread.id,
    ]);
  });

  test("the live queries read their indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, rankingSql.latestPosts, [100, 100, 40]);
    expectNoTableScan(w.ctx, rankingSql.latestThreads, [100, 40]);
    expectNoTableScan(w.ctx, rankingSql.stored, ["mostReplied"]);
    const plan = (sql: string, params: unknown[]) =>
      w.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => row.detail)
        .join("\n");
    expect(plan(rankingSql.latestPosts, [100, 100, 40])).toContain("threads_public_feed");
    expect(plan(rankingSql.latestThreads, [100, 40])).toContain("threads_state_id");
  });
});
