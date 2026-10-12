import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { runMinuteTasks } from "../jobs/scheduler";
import { fillThreads, world } from "./fixtures.test";
import { rankingSql, reactionTotal, refreshRankings, registerRankingJobs } from "./rankings";

const DAY = 86_400_000;
const ids = (page: { items: { id: number }[] }) => page.items.map((thread) => thread.id);
const stored = (w: ReturnType<typeof world>, kind: string) =>
  w.ctx.sqlite
    .prepare<{ target_id: number; score: number; position: number; node_id: number }, [string]>(
      "SELECT node_id, position, target_id, score FROM rankings WHERE kind = ?1 ORDER BY score DESC, position, target_id",
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

  test("each ranking keeps 20 threads per forum and a rerun replaces the rows rather than adding", async () => {
    const w = world();
    const other = insertNode(w.ctx, { parentId: w.category.id });
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, reply_count, view_count, last_post_at, last_poster_id) VALUES (?1, ?2, 't', 'visible', ?3, ?4, ?4, ?3, ?2)",
    );
    for (let i = 0; i < 30; i++) insert.run(w.open.id, w.aliceUser.id, w.ctx.now(), i);
    for (let i = 0; i < 3; i++) insert.run(other.id, w.aliceUser.id, w.ctx.now(), 1000 + i);
    refreshRankings(w.ctx);
    refreshRankings(w.ctx);
    const replied = stored(w, "mostReplied");
    const inOpen = replied.filter((row) => row.node_id === w.open.id);
    expect(inOpen).toHaveLength(20);
    expect(inOpen[0]!.score).toBe(29);
    expect(inOpen.at(-1)!.score).toBe(10);
    expect(inOpen.map((row) => row.position)).toEqual([...inOpen.keys()]);
    const inOther = replied.filter((row) => row.node_id === other.id);
    expect(inOther.map((row) => row.score)).toEqual([1002, 1001, 1000]);
    expect(stored(w, "mostViewed")).toHaveLength(23);
    // A forum with nothing gets no rows.
    expect(replied.some((row) => row.node_id === w.secret.id)).toBe(false);
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

  test("feedTop keeps the 50 best of each forum", () => {
    const w = world();
    const thread = w.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 't', 'visible', ?3, ?3, ?2) RETURNING id",
      )
      .get(w.open.id, w.aliceUser.id, w.ctx.now())!;
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at, reaction_counts) VALUES (?1, ?2, ?3, 'visible', ?4, ?5)",
    );
    for (let i = 0; i < 80; i++)
      insert.run(thread.id, w.aliceUser.id, i, w.ctx.now(), `{"1":${i + 1}}`);
    refreshRankings(w.ctx);
    const top = stored(w, "feedTop");
    expect(top).toHaveLength(50);
    expect(top[0]!.score).toBe(80);
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

  test("a malformed reaction_counts counts as zero and does not fail the refresh", async () => {
    const w = world();
    const good = await w.thread(w.alice, w.open.id, "Good");
    const bad = await w.thread(w.alice, w.open.id, "Bad");
    const set = (id: number, counts: string) =>
      w.ctx.sqlite.prepare("UPDATE posts SET reaction_counts = ?1 WHERE id = ?2").run(counts, id);
    set(good.post.id, '{"1":2}');
    set(bad.post.id, "{not json");
    expect(reactionTotal("{not json")).toBe(0);
    expect(reactionTotal("null")).toBe(0);
    expect(reactionTotal("[1]")).toBe(0);
    refreshRankings(w.ctx);
    expect(stored(w, "mostReacted").map((row) => [row.target_id, row.score])).toEqual([
      [good.thread.id, 2],
      [bad.thread.id, 0],
    ]);
    expect(stored(w, "feedTop").map((row) => row.target_id)).toEqual([good.post.id]);
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
    expectNoTableScan(w.ctx, rankingSql.stored, ["mostReplied", "[1,2]"]);
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

  test("newer threads in a forum the viewer cannot see do not push out what they can", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    fillThreads(w.ctx, w.secret.id, w.aliceUser.id, 400, { at: (i) => w.ctx.now() + i + 1 });
    for (const by of ["latestThreads", "latestPosts"])
      expect(ids(await w.call("threads.ranked", w.bob, { by }))).toEqual([visible.thread.id]);
    expect(ids(await w.call("threads.ranked", GUEST, { by: "latestPosts" }))).toEqual([
      visible.thread.id,
    ]);
    // Those who can see the forum get the newest of both, merged.
    const staff = await w.call("threads.ranked", w.admin, { by: "latestThreads", limit: 20 });
    expect(staff.items).toHaveLength(20);
    expect(staff.items[0].node.id).toBe(w.secret.id);
  });

  test("merges the newest threads of the forums the viewer can see", async () => {
    const w = world();
    const other = insertNode(w.ctx, { parentId: w.category.id });
    const a = await w.thread(w.alice, w.open.id, "a");
    const b = await w.thread(w.alice, other.id, "b");
    await w.thread(w.admin, w.secret.id, "hidden");
    const c = await w.thread(w.alice, w.open.id, "c");
    await w.reply(w.bob, a.thread.id, "bump a");
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestThreads" }))).toEqual([
      c.thread.id,
      b.thread.id,
      a.thread.id,
    ]);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestPosts" }))).toEqual([
      a.thread.id,
      c.thread.id,
      b.thread.id,
    ]);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestThreads", limit: 2 }))).toEqual([
      c.thread.id,
      b.thread.id,
    ]);
  });

  test("busy hidden forums do not empty the stored rankings of a viewer who cannot see them", async () => {
    const w = world();
    const visible = await w.thread(w.alice, w.open.id, "Visible");
    await w.reply(w.bob, visible.thread.id, "one");
    fillThreads(w.ctx, w.secret.id, w.aliceUser.id, 100, { replies: (i) => 1000 + i });
    refreshRankings(w.ctx);
    expect(ids(await w.call("threads.ranked", GUEST, { by: "mostReplied" }))).toEqual([
      visible.thread.id,
    ]);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "mostReplied" }))).toEqual([
      visible.thread.id,
    ]);
    const staff = await w.call("threads.ranked", w.admin, { by: "mostReplied", limit: 20 });
    expect(staff.items).toHaveLength(20);
    expect(
      staff.items.every((item: { node: { id: number } }) => item.node.id === w.secret.id),
    ).toBe(true);
    expect(
      ids(await w.call("threads.ranked", w.admin, { by: "mostReplied", limit: 20 })),
    ).not.toContain(visible.thread.id);
  });

  test("a thread in a forum whose ancestor is hidden is left out everywhere", async () => {
    const w = world();
    const child = insertNode(w.ctx, { parentId: w.secret.id });
    const open = await w.thread(w.alice, w.open.id, "Open");
    const deep = await w.thread(w.admin, child.id, "Deep");
    await w.reply(w.admin, deep.thread.id, "x");
    w.ctx.sqlite
      .prepare("UPDATE posts SET reaction_counts = '{\"1\":5}' WHERE id = ?1")
      .run(deep.post.id);
    refreshRankings(w.ctx);
    for (const by of ["latestPosts", "latestThreads", "mostReplied", "mostReacted", "mostViewed"]) {
      expect(ids(await w.call("threads.ranked", w.bob, { by }))).not.toContain(deep.thread.id);
      expect(ids(await w.call("threads.ranked", w.admin, { by }))).toContain(deep.thread.id);
    }
    expect(ids(await w.call("threads.ranked", w.bob, { by: "latestThreads" }))).toEqual([
      open.thread.id,
    ]);
  });

  test("a thread moved into a forum the viewer cannot see after the last refresh drops out", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Moving");
    await w.reply(w.bob, t.thread.id, "x");
    refreshRankings(w.ctx);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "mostReplied" }))).toEqual([
      t.thread.id,
    ]);
    w.ctx.sqlite
      .prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2")
      .run(w.secret.id, t.thread.id);
    expect(ids(await w.call("threads.ranked", w.bob, { by: "mostReplied" }))).toEqual([]);
  });

  test("the live queries read their indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, rankingSql.latestPosts, [100, 100, 40]);
    expectNoTableScan(w.ctx, rankingSql.latestThreads, [100, 40]);
    expectNoTableScan(w.ctx, rankingSql.latestPostsIn, ["[1,2]", 20]);
    expectNoTableScan(w.ctx, rankingSql.latestThreadsIn, ["[1,2]", 20]);
    const plan = (sql: string, params: unknown[]) =>
      w.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => row.detail)
        .join("\n");
    expect(plan(rankingSql.latestPosts, [100, 100, 40])).toContain("threads_public_feed");
    expect(plan(rankingSql.latestThreads, [100, 40])).toContain("threads_state_id");
    expect(plan(rankingSql.latestPostsIn, ["[1,2]", 20])).toContain("threads_node_feed");
    expect(plan(rankingSql.latestThreadsIn, ["[1,2]", 20])).toContain("threads_node_state_id");
    expect(plan(rankingSql.stored, ["mostReplied", "[1,2]"])).toContain(
      "rankings_kind_node_position",
    );
  });
});
