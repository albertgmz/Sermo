import { describe, expect, test } from "bun:test";
import { insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { type World, world } from "../feed/fixtures.test";
import { enqueueJob, runDueJobs } from "../jobs";
import { registerJobHandlers } from "../jobs/rebuild";

/** A world plus a second forum whose posts do not count. */
function twoForums() {
  const w = world();
  const quiet = w.ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "INSERT INTO nodes (parent_id, type, title, counts_posts) VALUES (?1, 'forum', 'Quiet', 0) RETURNING id",
    )
    .get(w.category.id)!;
  invalidate(w.ctx, "node_tree");
  return { w, loud: w.open.id, quiet: quiet.id };
}
const pendingJobs = (w: World) =>
  w.ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type = 'rebuild-node-authors' AND status != 'done'",
    )
    .get()!.n;
const counts = (w: World) => {
  const get = (id: number) =>
    w.ctx.sqlite
      .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM users WHERE id = ?1")
      .get(id)!.n;
  return { alice: get(w.aliceUser.id), bob: get(w.bobUser.id) };
};

describe("forums that do not count posts", () => {
  test("a thread and a reply count only in a counting forum", async () => {
    const { w, loud, quiet } = twoForums();
    const a = await w.thread(w.alice, loud, "Loud");
    await w.reply(w.bob, a.thread.id, "reply");
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    const b = await w.thread(w.alice, quiet, "Quiet");
    await w.reply(w.bob, b.thread.id, "reply");
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
  });

  test("a post held for approval counts when it is approved, in a counting forum only", async () => {
    const { w, loud, quiet } = twoForums();
    const a = await w.thread(w.alice, loud, "Loud");
    const b = await w.thread(w.alice, quiet, "Quiet");
    await w.call("nodes.update", w.admin, {
      nodeId: loud,
      settings: { requireReplyApproval: true },
    });
    await w.call("nodes.update", w.admin, {
      nodeId: quiet,
      settings: { requireReplyApproval: true },
    });
    const held = await w.reply(w.bob, a.thread.id, "held");
    const heldQuiet = await w.reply(w.bob, b.thread.id, "held");
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: held.id },
      state: "visible",
    });
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: heldQuiet.id },
      state: "visible",
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    // Unapproved again, then deleted and restored through the post operations.
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: held.id },
      state: "moderated",
    });
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: heldQuiet.id },
      state: "moderated",
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
  });

  test("deleting and restoring a post or a thread changes counts only in a counting forum", async () => {
    const { w, loud, quiet } = twoForums();
    const a = await w.thread(w.alice, loud, "Loud");
    const ra = await w.reply(w.bob, a.thread.id, "reply");
    const b = await w.thread(w.alice, quiet, "Quiet");
    const rb = await w.reply(w.bob, b.thread.id, "reply");
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    await w.call("posts.delete", w.mod, { postId: ra.id });
    await w.call("posts.delete", w.mod, { postId: rb.id });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
    await w.call("posts.restore", w.mod, { postId: ra.id });
    await w.call("posts.restore", w.mod, { postId: rb.id });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    await w.call("threads.delete", w.mod, { threadId: a.thread.id });
    await w.call("threads.delete", w.mod, { threadId: b.thread.id });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("threads.restore", w.mod, { threadId: a.thread.id });
    await w.call("threads.restore", w.mod, { threadId: b.thread.id });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    // The same through the moderation tools.
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: ra.id },
      state: "deleted",
    });
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: rb.id },
      state: "deleted",
    });
    await w.call("moderation.setState", w.mod, {
      target: { type: "thread", id: a.thread.id },
      state: "deleted",
    });
    await w.call("moderation.setState", w.mod, {
      target: { type: "thread", id: b.thread.id },
      state: "deleted",
    });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("moderation.bulk", w.mod, {
      targets: [
        { type: "thread", id: a.thread.id },
        { type: "thread", id: b.thread.id },
      ],
      action: "restore",
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
  });

  test("moving a thread between the two kinds of forum adjusts its authors exactly", async () => {
    const { w, loud, quiet } = twoForums();
    const t = await w.thread(w.alice, loud, "Moving");
    await w.reply(w.bob, t.thread.id, "one");
    await w.reply(w.bob, t.thread.id, "two");
    await w.reply(w.alice, t.thread.id, "three");
    expect(counts(w)).toEqual({ alice: 2, bob: 2 });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: quiet });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: loud });
    expect(counts(w)).toEqual({ alice: 2, bob: 2 });
    // The bulk tool does the same.
    await w.call("moderation.bulk", w.admin, {
      targets: [{ type: "thread", id: t.thread.id }],
      action: "move",
      nodeId: quiet,
    });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("moderation.bulk", w.admin, {
      targets: [{ type: "thread", id: t.thread.id }],
      action: "move",
      nodeId: loud,
    });
    expect(counts(w)).toEqual({ alice: 2, bob: 2 });
  });

  test("moving between two forums of the same kind, or a hidden thread, changes nothing", async () => {
    const { w, loud, quiet } = twoForums();
    const other = w.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "INSERT INTO nodes (parent_id, type, title) VALUES (?1, 'forum', 'Other') RETURNING id",
      )
      .get(w.category.id)!.id;
    invalidate(w.ctx, "node_tree");
    const t = await w.thread(w.alice, loud, "Moving");
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: other });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: quiet });
    await w.call("threads.restore", w.mod, { threadId: t.thread.id });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: loud });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("threads.restore", w.mod, { threadId: t.thread.id });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
  });

  test("merging threads across the two kinds adjusts the authors of the moved posts", async () => {
    const { w, loud, quiet } = twoForums();
    const target = await w.thread(w.alice, loud, "Target");
    const source = await w.thread(w.bob, quiet, "Source");
    await w.reply(w.alice, source.thread.id, "from quiet");
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
    // Quiet into loud: the two posts start to count.
    await w.call("threads.merge", w.admin, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(counts(w)).toEqual({ alice: 2, bob: 1 });
    // Loud into quiet: they stop counting, and the target's own posts too.
    const quietTarget = await w.thread(w.bob, quiet, "Quiet target");
    expect(counts(w)).toEqual({ alice: 2, bob: 1 });
    await w.call("threads.merge", w.admin, {
      threadId: quietTarget.thread.id,
      sourceThreadIds: [target.thread.id],
    });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
  });

  test("merging within one kind of forum keeps the counts", async () => {
    const { w, loud, quiet } = twoForums();
    const a = await w.thread(w.alice, loud, "A");
    const b = await w.thread(w.bob, loud, "B");
    await w.call("threads.merge", w.admin, {
      threadId: a.thread.id,
      sourceThreadIds: [b.thread.id],
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    const c = await w.thread(w.alice, quiet, "C");
    const d = await w.thread(w.bob, quiet, "D");
    await w.call("threads.merge", w.admin, {
      threadId: c.thread.id,
      sourceThreadIds: [d.thread.id],
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
  });

  test("splitting posts into a forum of the other kind adjusts the authors", async () => {
    const { w, loud, quiet } = twoForums();
    const t = await w.thread(w.alice, loud, "Split me");
    const r1 = await w.reply(w.bob, t.thread.id, "one");
    const r2 = await w.reply(w.bob, t.thread.id, "two");
    expect(counts(w)).toEqual({ alice: 1, bob: 2 });
    const toQuiet = await w.call("threads.split", w.admin, {
      threadId: t.thread.id,
      postIds: [r1.id, r2.id],
      title: "Quiet part",
      nodeId: quiet,
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 0 });
    const back = await w.call("threads.split", w.admin, {
      threadId: toQuiet.thread.id,
      postIds: [r2.id],
      title: "Back",
      nodeId: loud,
    });
    expect(back.thread.nodeId).toBe(loud);
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
  });

  test("a split of posts by several authors moves each author's own number", async () => {
    const { w, loud, quiet } = twoForums();
    const t = await w.thread(w.alice, loud, "Split me");
    const posts = [
      await w.reply(w.bob, t.thread.id, "b1"),
      await w.reply(w.bob, t.thread.id, "b2"),
      await w.reply(w.bob, t.thread.id, "b3"),
      await w.reply(w.carol, t.thread.id, "c1"),
      await w.reply(w.alice, t.thread.id, "a1"),
    ];
    const carol = () =>
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM users WHERE id = ?1")
        .get(w.carolUser.id)!.n;
    expect(counts(w)).toEqual({ alice: 2, bob: 3 });
    expect(carol()).toBe(1);
    // alice 1, bob 2, carol 1 of their posts go to the quiet forum.
    await w.call("threads.split", w.admin, {
      threadId: t.thread.id,
      postIds: [posts[0]!.id, posts[1]!.id, posts[3]!.id, posts[4]!.id],
      title: "Quiet part",
      nodeId: quiet,
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    expect(carol()).toBe(0);
  });

  test("a bulk move of a big thread is one grouped update of the authors", async () => {
    const { w, loud, quiet } = twoForums();
    const t = await w.thread(w.alice, loud, "Big");
    const authors = [w.alice, w.bob, w.carol];
    for (let i = 0; i < 30; i++) await w.reply(authors[i % 3]!, t.thread.id, `r${i}`);
    const before = counts(w);
    expect(before.alice + before.bob).toBe(1 + 10 + 10);
    let updates = 0;
    const run = w.ctx.sqlite.prepare.bind(w.ctx.sqlite);
    w.ctx.statements.clear();
    // biome-ignore lint/suspicious/noExplicitAny: the wrapper forwards whatever the statement takes
    (w.ctx.sqlite as any).prepare = (sql: string) => {
      if (/^UPDATE users SET post_count/.test(sql)) updates++;
      return run(sql);
    };
    try {
      await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: quiet });
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the original method
      (w.ctx.sqlite as any).prepare = run;
    }
    expect(updates).toBe(1);
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
  });

  test("switching the setting saves it and a background job updates the counts", async () => {
    const { w, loud } = twoForums();
    registerJobHandlers(w.ctx);
    const t = await w.thread(w.alice, loud, "Here");
    await w.reply(w.bob, t.thread.id, "one");
    await w.call("threads.delete", w.mod, {
      threadId: (await w.thread(w.alice, loud, "Gone")).thread.id,
    });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    const off = await w.call("nodes.update", w.admin, {
      nodeId: loud,
      settings: { countsPosts: false },
    });
    expect(off.settings.countsPosts).toBe(false);
    // Nothing is recounted inside the request.
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    await runDueJobs(w.ctx, { limit: 20 });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    // Saving the same value again queues nothing.
    await w.call("nodes.update", w.admin, { nodeId: loud, settings: { countsPosts: false } });
    expect(pendingJobs(w)).toBe(0);
    const on = await w.call("nodes.update", w.admin, {
      nodeId: loud,
      settings: { countsPosts: true },
    });
    expect(on.settings.countsPosts).toBe(true);
    await runDueJobs(w.ctx, { limit: 20 });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    // A new forum is counting unless it is made otherwise.
    const created = await w.call("nodes.create", w.admin, {
      parentId: w.category.id,
      type: "forum",
      title: "Fresh",
    });
    expect(created.settings.countsPosts).toBe(true);
    const quiet = await w.call("nodes.create", w.admin, {
      parentId: w.category.id,
      type: "forum",
      title: "Fresh quiet",
      settings: { countsPosts: false },
    });
    expect(quiet.settings.countsPosts).toBe(false);
  });

  test("after the job, deleting or moving content after a switch stays exact", async () => {
    const { w, loud, quiet } = twoForums();
    registerJobHandlers(w.ctx);
    const t = await w.thread(w.alice, loud, "Here");
    const r = await w.reply(w.bob, t.thread.id, "one");
    await w.call("nodes.update", w.admin, { nodeId: loud, settings: { countsPosts: false } });
    await runDueJobs(w.ctx, { limit: 20 });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("posts.delete", w.mod, { postId: r.id });
    await w.call("posts.restore", w.mod, { postId: r.id });
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    await w.call("threads.restore", w.mod, { threadId: t.thread.id });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    // Into the forum that counts, and out again through the switch.
    await w.call("nodes.update", w.admin, { nodeId: quiet, settings: { countsPosts: true } });
    await runDueJobs(w.ctx, { limit: 20 });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: quiet });
    expect(counts(w)).toEqual({ alice: 1, bob: 1 });
    await w.call("nodes.update", w.admin, { nodeId: quiet, settings: { countsPosts: false } });
    await runDueJobs(w.ctx, { limit: 20 });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
  });

  test("the job reaches authors beyond the first window of user ids", async () => {
    const { w, loud } = twoForums();
    registerJobHandlers(w.ctx);
    for (let i = 0; i < 1100; i++) insertUser(w.ctx, { username: `filler${i}` });
    const late = insertUser(w.ctx, { username: "late" });
    await w.thread(userActor(late), loud, "Late");
    const lateCount = () =>
      w.ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM users WHERE id = ?1")
        .get(late.id)!.n;
    expect(lateCount()).toBe(1);
    await w.call("nodes.update", w.admin, { nodeId: loud, settings: { countsPosts: false } });
    await runDueJobs(w.ctx, { limit: 50 });
    expect(lateCount()).toBe(0);
  });

  test("a count that is lower than the member's posts never goes below zero", async () => {
    const { w, loud, quiet } = twoForums();
    const t = await w.thread(w.alice, loud, "Drift");
    const r = await w.reply(w.bob, t.thread.id, "one");
    const reply2 = await w.reply(w.bob, t.thread.id, "two");
    const drift = () => w.ctx.sqlite.prepare("UPDATE users SET post_count = 0").run();
    drift();
    await w.call("posts.delete", w.mod, { postId: r.id });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("moderation.setState", w.mod, {
      target: { type: "post", id: reply2.id },
      state: "moderated",
    });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: quiet });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    await w.call("threads.move", w.admin, { threadId: t.thread.id, nodeId: loud });
    drift();
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
    // A merge and a split take from an empty count as well.
    await w.call("threads.restore", w.mod, { threadId: t.thread.id });
    const other = await w.thread(w.alice, quiet, "Other");
    drift();
    await w.call("threads.merge", w.admin, {
      threadId: other.thread.id,
      sourceThreadIds: [t.thread.id],
    });
    expect(counts(w)).toEqual({ alice: 0, bob: 0 });
  });

  test("the counter rebuild agrees with the counts the operations kept", async () => {
    const { w, loud, quiet } = twoForums();
    const a = await w.thread(w.alice, loud, "A");
    await w.reply(w.bob, a.thread.id, "one");
    const b = await w.thread(w.bob, quiet, "B");
    await w.reply(w.alice, b.thread.id, "two");
    await w.call("threads.move", w.admin, { threadId: b.thread.id, nodeId: loud });
    await w.call("threads.move", w.admin, { threadId: a.thread.id, nodeId: quiet });
    const kept = counts(w);
    expect(kept).toEqual({ alice: 1, bob: 1 });
    w.ctx.sqlite.prepare("UPDATE users SET post_count = 99").run();
    registerJobHandlers(w.ctx);
    enqueueJob(
      w.ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      { uniqueKey: "rebuild-counters" },
    );
    await runDueJobs(w.ctx, { limit: 100 });
    expect(counts(w)).toEqual(kept);
  });
});
