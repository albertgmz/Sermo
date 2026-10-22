import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { dispatchEvents } from "../../events";
import { can } from "../../permissions";
import { fillThreads, type World, world } from "../feed/fixtures.test";
import { enqueueJob, runDueJobs } from "../jobs";
import { customMember, setEntry } from "../permissions/group-fixture";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { registerForumTransferJobs } from "./index";
import {
  DELETE_THREADS,
  MOVE_POSTS,
  MOVE_THREADS,
  nodeDeleteKey,
  nodeDeleteSql,
} from "./node-delete";

// biome-ignore lint/suspicious/noExplicitAny: operation outputs are checked field by field
type Row = Record<string, any>;

/** The forum to delete (with a subforum), a forum to move its threads to, and a few threads. */
async function scene() {
  const w = world();
  registerForumTransferJobs(w.ctx);
  const doomed = w.open.id;
  const kid = insertNode(w.ctx, { parentId: doomed, title: "Kid" });
  const target = insertNode(w.ctx, { parentId: w.category.id, title: "Target" });
  invalidate(w.ctx, "node_tree");
  const first = await w.thread(w.alice, doomed, "First");
  await w.reply(w.bob, first.thread.id, "bob replies");
  const second = await w.thread(w.bob, doomed, "Second");
  const hidden = await w.thread(w.alice, doomed, "Hidden");
  await w.call("threads.delete", w.mod, { threadId: hidden.thread.id, reason: "x", notify: false });
  const inKid = await w.thread(w.alice, kid.id, "In the kid");
  const threads = { first: first.thread.id, second: second.thread.id, hidden: hidden.thread.id };
  return { w, doomed, kid: kid.id, target: target.id, threads, inKid: inKid.thread.id };
}
type Scene = Awaited<ReturnType<typeof scene>>;

const interactive = (actor: object) => ({ ...actor, interactive: true as const });
const scalar = (w: World, sql: string, ...params: (number | string)[]) =>
  w.ctx.sqlite.prepare<{ n: number }, (number | string)[]>(sql).get(...params)!.n;
const exists = (w: World, id: number) =>
  scalar(w, "SELECT count(*) AS n FROM nodes WHERE id = ?1", id) === 1;
const jobs = (w: World) =>
  w.ctx.sqlite
    .prepare<{ status: string; run_at: number }, []>(
      "SELECT status, run_at FROM jobs WHERE type = 'forums.deleteNode' AND status != 'done'",
    )
    .all();
/** Runs the deletion job until it is done. */
async function finish(w: World) {
  for (let guard = 0; guard < 200 && jobs(w).length > 0; guard++) {
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
  }
  const failed = w.ctx.sqlite
    .prepare("SELECT last_error FROM jobs WHERE type = 'forums.deleteNode' AND status = 'failed'")
    .all();
  expect(failed).toEqual([]);
  expect(jobs(w)).toEqual([]);
}
const del = (s: Scene, input: object, actor: object = s.w.admin) =>
  s.w.call("nodes.delete", actor as never, { nodeId: s.doomed, ...input });
const postCount = (w: World, user: { id: number }) =>
  scalar(w, "SELECT post_count AS n FROM users WHERE id = ?1", user.id);

describe("nodes.delete: moving the threads", () => {
  test("moves every thread, hidden ones too, and the subforum goes up to the parent", async () => {
    const s = await scene();
    const { w } = s;
    const before = { alice: postCount(w, w.aliceUser), bob: postCount(w, w.bobUser) };
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    for (const id of Object.values(s.threads))
      expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", id)).toBe(s.target);
    // The forum it went to holds the visible ones in its figures, hidden ones in none.
    expect(
      w.ctx.sqlite
        .prepare("SELECT thread_count, post_count, last_thread_id FROM nodes WHERE id = ?1")
        .get(s.target),
    ).toEqual({ thread_count: 2, post_count: 3, last_thread_id: s.threads.second });
    // The subforum stays, under the deleted forum's parent, with its thread.
    expect(scalar(w, "SELECT parent_id AS n FROM nodes WHERE id = ?1", s.kid)).toBe(w.category.id);
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.inKid)).toBe(s.kid);
    // Nobody's post count moved, and the thread opens at its forum now.
    expect({ alice: postCount(w, w.aliceUser), bob: postCount(w, w.bobUser) }).toEqual(before);
    expect((await w.call("threads.get", w.alice, { threadId: s.threads.first })).node.id).toBe(
      s.target,
    );
    const listed = (await w.call("nodes.list", w.alice, {})).items as Row[];
    expect(listed.map((node) => node.id)).not.toContain(s.doomed);
    // Audited at both ends, with the counts.
    const log = w.ctx.sqlite
      .prepare<{ action: string; details: string }, []>(
        "SELECT action, details FROM moderator_log WHERE action LIKE 'node.delete%' ORDER BY id",
      )
      .all();
    expect(log.map((entry) => entry.action)).toEqual(["node.delete", "node.delete.completed"]);
    expect(JSON.parse(log[0]!.details)).toMatchObject({
      title: expect.any(String),
      threads: { action: "move", nodeId: s.target },
      children: "moveUp",
      forums: 1,
      threadCount: 2,
    });
    expect(JSON.parse(log[1]!.details)).toMatchObject({ forums: 1, movedThreads: 3 });
  });

  test("a thread keeps a prefix the target offers and loses one it does not", async () => {
    const s = await scene();
    const { w } = s;
    const color = scalar(w, "SELECT id AS n FROM palette_colors WHERE kind = 'prefix' LIMIT 1");
    const prefix = (label: string) =>
      w.ctx.sqlite
        .prepare<{ id: number }, [string, number]>(
          "INSERT INTO thread_prefixes (label, color_id, created_at, updated_at) VALUES (?1, ?2, 1, 1) RETURNING id",
        )
        .get(label, color)!.id;
    const offered = prefix("Offered");
    const other = prefix("Other");
    w.ctx.sqlite
      .prepare("INSERT INTO forum_prefixes (node_id, prefix_id) VALUES (?1, ?2)")
      .run(s.target, offered);
    const set = w.ctx.sqlite.prepare("UPDATE threads SET prefix_id = ?1 WHERE id = ?2");
    set.run(offered, s.threads.first);
    set.run(other, s.threads.second);
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await finish(w);
    const read = (id: number) =>
      w.ctx.sqlite
        .prepare<{ prefix_id: number | null }, [number]>(
          "SELECT prefix_id FROM threads WHERE id = ?1",
        )
        .get(id)!.prefix_id;
    expect(read(s.threads.first)).toBe(offered);
    expect(read(s.threads.second)).toBeNull();
  });

  test("a merged thread's old address moves with the rest and still leads on", async () => {
    const s = await scene();
    const { w } = s;
    const merged = await w.call("threads.merge", w.admin, {
      threadId: s.threads.first,
      sourceThreadIds: [s.threads.second],
    });
    expect(merged.completed).toBe(true);
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await finish(w);
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.second)).toBe(
      s.target,
    );
    const got = await w.call("threads.get", w.alice, { threadId: s.threads.second });
    expect(got.thread.id).toBe(s.threads.first);
  });

  test("moves a forum with many threads in chunks, and the forum stays read-only until the end", async () => {
    const s = await scene();
    const { w } = s;
    const ids = fillThreads(w.ctx, s.doomed, w.bobUser.id, 450);
    w.ctx.sqlite
      .prepare("UPDATE nodes SET thread_count = thread_count + 450 WHERE id = ?1")
      .run(s.doomed);
    await del(s, { threads: { action: "move", nodeId: s.target } });
    expect(
      (await w.call("nodes.get", w.alice, { nodeId: s.doomed })).node.settings.isReadOnly,
    ).toBe(true);
    await expect(
      w.call("threads.create", w.alice, { nodeId: s.doomed, title: "Late", body: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    // One chunk: part of the threads are over, the forum and the job are still there, once.
    const inTarget = () =>
      scalar(w, "SELECT count(*) AS n FROM threads WHERE node_id = ?1", s.target);
    expect(inTarget()).toBe(MOVE_THREADS);
    expect(exists(w, s.doomed)).toBe(true);
    expect(jobs(w)).toHaveLength(1);
    await finish(w);
    expect(inTarget()).toBe(450 + 3);
    expect(
      ids.every(
        (id) => scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", id) === s.target,
      ),
    ).toBe(true);
    expect(scalar(w, "SELECT thread_count AS n FROM nodes WHERE id = ?1", s.target)).toBe(450 + 2);
  });

  test("a thread being merged or split waits, the rest goes, and it follows once it is free", async () => {
    const s = await scene();
    const { w } = s;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, 'merge_source', 1, 'k', ?2)",
      )
      .run(s.threads.first, w.ctx.now());
    await del(s, { threads: { action: "move", nodeId: s.target } });
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.first)).toBe(
      s.doomed,
    );
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.second)).toBe(
      s.target,
    );
    // Only the thread in the middle of a merge is left: the next look is later, not at once.
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    const [waiting] = jobs(w);
    expect(waiting!.run_at).toBeGreaterThan(w.ctx.now() + 10_000);
    w.ctx.sqlite.prepare("DELETE FROM thread_transfers").run();
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.first)).toBe(
      s.target,
    );
  });
});

describe("nodes.delete: deleting the threads", () => {
  test("removes the threads for good with the subforum, and gives back what they counted", async () => {
    const s = await scene();
    const { w } = s;
    const merged = await w.call("threads.merge", w.admin, {
      threadId: s.threads.first,
      sourceThreadIds: [s.threads.second],
    });
    expect(merged.completed).toBe(true);
    w.ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 1)")
      .run(s.doomed);
    await w.call("nodes.watch", w.carol, { nodeId: s.doomed, mode: "threads", email: false });
    await w.call("nodes.markRead", w.carol, { nodeId: s.doomed });
    await w.call("feed.hideForum", w.carol, { nodeId: s.doomed, hidden: true });
    const settings = readSiteSettings(w.ctx);
    storeSiteSettings(w.ctx, { ...settings, feedExcludedForumIds: [s.doomed, s.target] });
    await del(s, { threads: { action: "delete" }, children: "delete" });
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    expect(exists(w, s.kid)).toBe(false);
    expect(exists(w, s.target)).toBe(true);
    const ids = [...Object.values(s.threads), s.inKid];
    for (const id of ids)
      expect(scalar(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", id)).toBe(0);
    expect(
      scalar(
        w,
        "SELECT count(*) AS n FROM posts WHERE thread_id IN (SELECT value FROM json_each(?1))",
        JSON.stringify(ids),
      ),
    ).toBe(0);
    expect(scalar(w, "SELECT count(*) AS n FROM post_bodies")).toBe(0);
    expect(postCount(w, w.aliceUser)).toBe(0);
    expect(postCount(w, w.bobUser)).toBe(0);
    for (const table of ["node_watches", "node_reads", "feed_hidden_nodes", "node_permissions"])
      expect(
        scalar(w, `SELECT count(*) AS n FROM ${table} WHERE node_id IN (?1, ?2)`, s.doomed, s.kid),
      ).toBe(0);
    expect(readSiteSettings(w.ctx).feedExcludedForumIds).toEqual([s.target]);
    // The event the deletion publishes is consumed without trouble.
    await dispatchEvents(w.ctx);
    const log = w.ctx.sqlite
      .prepare<{ details: string }, []>(
        "SELECT details FROM moderator_log WHERE action = 'node.delete.completed'",
      )
      .get()!;
    expect(JSON.parse(log.details)).toMatchObject({ forums: 2, removedThreads: 3 });
  });

  test("with the subforum kept, only the forum's own threads go", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "delete" } });
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    expect(exists(w, s.kid)).toBe(true);
    expect(scalar(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", s.inKid)).toBe(1);
    expect(scalar(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", s.threads.first)).toBe(0);
    // Alice keeps the one post she made in the subforum.
    expect(postCount(w, w.aliceUser)).toBe(1);
  });

  test("a forum with many threads goes in chunks, resuming from what the database holds", async () => {
    const s = await scene();
    const { w } = s;
    fillThreads(w.ctx, s.doomed, w.bobUser.id, 120);
    w.ctx.sqlite
      .prepare(
        "UPDATE nodes SET thread_count = thread_count + 120, post_count = post_count + 120 WHERE id = ?1",
      )
      .run(s.doomed);
    await del(s, { threads: { action: "delete" } });
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    const left = scalar(w, "SELECT count(*) AS n FROM threads WHERE node_id = ?1", s.doomed);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(120);
    expect(jobs(w)).toHaveLength(1);
    // The job is lost and found again after its lease: the next run carries on.
    w.ctx.sqlite
      .prepare(
        "UPDATE jobs SET status = 'running', locked_until = 1 WHERE type = 'forums.deleteNode'",
      )
      .run();
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    expect(scalar(w, "SELECT count(*) AS n FROM threads WHERE node_id = ?1", s.doomed)).toBe(0);
  });

  test("a deleted thread's own long run of posts is taken a chunk at a time", async () => {
    const s = await scene();
    const { w } = s;
    // A thread of 1,200 posts takes three chunks of 500.
    const long = s.threads.first;
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    for (let i = 2; i < 1200; i++) insert.run(long, w.bobUser.id, i, w.ctx.now());
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 1199 WHERE id = ?1").run(long);
    await del(s, { threads: { action: "delete" } });
    let runs = 0;
    for (; runs < 50 && jobs(w).length > 0; runs++) {
      w.ctx.clock.advance(60_000);
      await runDueJobs(w.ctx, { limit: 1 });
    }
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(exists(w, s.doomed)).toBe(false);
    expect(scalar(w, "SELECT count(*) AS n FROM posts WHERE thread_id = ?1", long)).toBe(0);
  });
});

describe("nodes.delete: who may, and what is refused", () => {
  test("checks the permission and the identity before the input", async () => {
    const s = await scene();
    const { w } = s;
    const input = { threads: { action: "delete" } };
    await expect(del(s, input, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(del(s, input, w.alice)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(del(s, input, w.mod)).rejects.toBeInstanceOf(ForbiddenError);
    // Not even the shape of the input is looked at before that.
    await expect(
      w.call("nodes.delete", w.alice, { nodeId: 99999, threads: { action: "delete" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // A browser session confirms with the password; a key or token never deletes.
    await expect(del(s, input, interactive(w.admin))).rejects.toBeInstanceOf(ValidationError);
    await expect(del(s, input, { ...w.admin, kind: "token", tokenId: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(exists(w, s.doomed)).toBe(true);
    expect(jobs(w)).toEqual([]);
    expect(scalar(w, "SELECT is_read_only AS n FROM nodes WHERE id = ?1", s.doomed)).toBe(0);
  });

  test("refuses a missing node, a bad target and a second deletion", async () => {
    const s = await scene();
    const { w } = s;
    await expect(
      w.call("nodes.delete", w.admin, { nodeId: 99999, threads: { action: "delete" } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const nodeId of [99999, w.category.id, s.doomed, s.kid])
      await expect(
        del(s, { threads: { action: "move", nodeId }, children: "delete" }),
      ).rejects.toBeInstanceOf(ValidationError);
    // With the subforum kept, it is a fine place for the threads.
    expect(jobs(w)).toEqual([]);
    await del(s, { threads: { action: "delete" } });
    await expect(del(s, { threads: { action: "delete" } })).rejects.toBeInstanceOf(ConflictError);
    expect(jobs(w)).toHaveLength(1);
    expect(
      enqueueJob(w.ctx, "forums.deleteNode", {}, { uniqueKey: nodeDeleteKey(s.doomed) }),
    ).toBeNull();
  });

  test("keeps a forum that a credit rule or a reaction type is limited to", async () => {
    const s = await scene();
    const { w } = s;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO credit_rules (title, trigger, amount, node_ids, created_at, updated_at) VALUES ('Posting here', 'thread_created', 1, ?1, 0, 0)",
      )
      .run(JSON.stringify([s.kid]));
    await expect(del(s, { threads: { action: "delete" }, children: "delete" })).rejects.toThrow(
      /Posting here/,
    );
    // Kept as a subforum it is not being deleted, so nothing names it in vain.
    await del(s, { threads: { action: "delete" } });
    expect(jobs(w)).toHaveLength(1);
    const t = await scene();
    t.w.ctx.sqlite
      .prepare(
        "UPDATE reaction_types SET forum_ids = ?1 WHERE id = (SELECT min(id) FROM reaction_types)",
      )
      .run(JSON.stringify([t.doomed]));
    await expect(del(t, { threads: { action: "delete" } })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("nodes.delete: what the review found", () => {
  test("a forum moved up out of a hidden category stays hidden from those who could not see it", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const root = insertNode(w.ctx, { type: "category", title: "Root" });
    const hidden = insertNode(w.ctx, { type: "category", parentId: root.id, title: "Staff" });
    const forum = insertNode(w.ctx, { parentId: hidden.id, title: "Private" });
    const target = insertNode(w.ctx, { parentId: root.id, title: "Elsewhere" });
    invalidate(w.ctx, "node_tree");
    for (const group of [1, 2]) setEntry(w.ctx, group, "node.view", -1, hidden.id);
    await w.thread(w.mod, forum.id, "Secret");
    await expect(w.call("nodes.get", w.carol, { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await w.call("nodes.delete", w.admin, {
      nodeId: hidden.id,
      threads: { action: "move", nodeId: target.id },
      children: "moveUp",
    });
    await finish(w);
    expect(exists(w, hidden.id)).toBe(false);
    expect(scalar(w, "SELECT parent_id AS n FROM nodes WHERE id = ?1", forum.id)).toBe(root.id);
    for (const actor of [GUEST, w.carol])
      await expect(w.call("nodes.get", actor, { nodeId: forum.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    await expect(w.call("threads.list", GUEST, { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Staff who could see it still do; the forum holds a copy of the category's two entries.
    expect((await w.call("nodes.get", w.mod, { nodeId: forum.id })).node.id).toBe(forum.id);
    expect(
      scalar(
        w,
        "SELECT count(*) AS n FROM permission_entries WHERE node_id = ?1 AND value = -1",
        forum.id,
      ),
    ).toBe(2);
  });

  test("a forum with its own allow under a hidden category is still hidden after the category goes", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const root = insertNode(w.ctx, { type: "category", title: "Root" });
    const hidden = insertNode(w.ctx, { type: "category", parentId: root.id, title: "Staff" });
    const forum = insertNode(w.ctx, { parentId: hidden.id, title: "Opened once" });
    const deeper = insertNode(w.ctx, { parentId: forum.id, title: "Deeper" });
    const target = insertNode(w.ctx, { parentId: root.id, title: "Elsewhere" });
    invalidate(w.ctx, "node_tree");
    for (const group of [1, 2]) {
      setEntry(w.ctx, group, "node.view", -1, hidden.id);
      setEntry(w.ctx, group, "node.view", 1, forum.id);
      setEntry(w.ctx, group, "node.view", 1, deeper.id);
    }
    // And a member-specific restriction on the hidden category against an allow of the forum's own.
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, ?1, 0, ?2, -1 FROM permission_definitions WHERE key = 'node.view'",
      )
      .run(hidden.id, w.aliceUser.id);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, ?1, 0, ?2, 1 FROM permission_definitions WHERE key = 'node.view'",
      )
      .run(forum.id, w.aliceUser.id);
    invalidate(w.ctx, "permissions");
    const seen = async (id: number) =>
      Promise.all(
        [GUEST, w.carol, w.alice, w.mod].map((actor) =>
          w.call("nodes.get", actor, { nodeId: id }).then(
            () => true,
            () => false,
          ),
        ),
      );
    expect(await seen(forum.id)).toEqual([false, false, false, true]);
    await w.call("nodes.delete", w.admin, {
      nodeId: hidden.id,
      threads: { action: "move", nodeId: target.id },
      children: "moveUp",
    });
    await finish(w);
    expect(await seen(forum.id)).toEqual([false, false, false, true]);
    expect(await seen(deeper.id)).toEqual([false, false, false, true]);
  });

  test("a forum with its own never under a visible category stays hidden after the category goes", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const root = insertNode(w.ctx, { type: "category", title: "Root" });
    const open = insertNode(w.ctx, { type: "category", parentId: root.id, title: "Open" });
    const forum = insertNode(w.ctx, { parentId: open.id, title: "Closed" });
    const target = insertNode(w.ctx, { parentId: root.id, title: "Elsewhere" });
    invalidate(w.ctx, "node_tree");
    for (const group of [1, 2]) {
      setEntry(w.ctx, group, "node.view", 1, open.id);
      setEntry(w.ctx, group, "node.view", -1, forum.id);
    }
    await w.call("nodes.delete", w.admin, {
      nodeId: open.id,
      threads: { action: "move", nodeId: target.id },
      children: "moveUp",
    });
    await finish(w);
    await expect(w.call("nodes.get", w.carol, { nodeId: forum.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("moved-up nodes go after the siblings of the deleted one, in their own order", async () => {
    const s = await scene();
    const { w } = s;
    const second = insertNode(w.ctx, { parentId: s.doomed, title: "Second kid" });
    invalidate(w.ctx, "node_tree");
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await finish(w);
    const position = (id: number) => scalar(w, "SELECT position AS n FROM nodes WHERE id = ?1", id);
    const siblings = [w.secret.id, s.target];
    for (const id of siblings) expect(position(s.kid)).toBeGreaterThan(position(id));
    expect(position(second.id)).toBeGreaterThan(position(s.kid));
  });

  test("a top-level forum may lose its subforums to the top level", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const forum = insertNode(w.ctx, { title: "Root forum" });
    insertNode(w.ctx, { parentId: forum.id, title: "Sub" });
    invalidate(w.ctx, "node_tree");
    await w.call("nodes.delete", w.admin, {
      nodeId: forum.id,
      threads: { action: "delete" },
      children: "moveUp",
    });
    await finish(w);
    expect(exists(w, forum.id)).toBe(false);
  });

  test("nothing can be put under a node that is being deleted", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "delete" } });
    await expect(
      w.call("nodes.create", w.admin, { parentId: s.doomed, type: "forum", title: "New" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.call("nodes.create", w.admin, { parentId: s.kid, type: "forum", title: "New" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.call("nodes.update", w.admin, { nodeId: s.target, parentId: s.doomed }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Elsewhere is open, and a node under the deleted one can still be renamed in place.
    await w.call("nodes.create", w.admin, { parentId: w.category.id, type: "forum", title: "New" });
    await w.call("nodes.update", w.admin, { nodeId: s.kid, title: "Renamed" });
  });

  test("a forum that arrived under a top-level category meanwhile stops the job instead of being lifted", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const top = insertNode(w.ctx, { type: "category", title: "Top" });
    insertNode(w.ctx, { type: "category", parentId: top.id, title: "Inner" });
    const sink = insertNode(w.ctx, { parentId: w.category.id, title: "Sink" });
    invalidate(w.ctx, "node_tree");
    await w.call("nodes.delete", w.admin, {
      nodeId: top.id,
      threads: { action: "move", nodeId: sink.id },
      children: "moveUp",
    });
    const late = insertNode(w.ctx, { parentId: top.id, title: "Late" });
    invalidate(w.ctx, "node_tree");
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 5 });
    expect(jobs(w)).toEqual([]);
    expect(exists(w, top.id)).toBe(true);
    expect(scalar(w, "SELECT parent_id AS n FROM nodes WHERE id = ?1", late.id)).toBe(top.id);
    const reasons = w.ctx.sqlite
      .prepare<{ details: string }, []>(
        "SELECT details FROM moderator_log WHERE action = 'node.delete.failed'",
      )
      .all()
      .map((row) => JSON.parse(row.details).reason);
    expect(reasons).toEqual(["forumsAtTop"]);
  });

  test("a forum another deletion moves its threads into cannot be deleted meanwhile", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await expect(
      w.call("nodes.delete", w.admin, { nodeId: s.target, threads: { action: "delete" } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("a job whose chunks keep failing leaves the node read-only and says so in the log", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "delete" } });
    w.ctx.sqlite.exec(
      "CREATE TRIGGER boom BEFORE UPDATE ON threads BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    for (let attempt = 0; attempt < 6; attempt++) {
      w.ctx.clock.advance(2 * 3_600_000);
      await runDueJobs(w.ctx, { limit: 1 });
    }
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'forums.deleteNode' AND status = 'failed'",
        )
        .get()!.n,
    ).toBe(1);
    const failed = w.ctx.sqlite
      .prepare<{ details: string; actor_id: number }, []>(
        "SELECT details, actor_id FROM moderator_log WHERE action = 'node.delete.failed'",
      )
      .get()!;
    expect(JSON.parse(failed.details)).toMatchObject({ reason: "error" });
    expect(failed.actor_id).toBe(actorUserId(w.admin) as number);
    expect(scalar(w, "SELECT is_read_only AS n FROM nodes WHERE id = ?1", s.doomed)).toBe(1);
  });

  test("the forums of a top-level category cannot move up to the top level, its categories can", async () => {
    const s = await scene();
    const { w } = s;
    const top = insertNode(w.ctx, { type: "category", title: "Top" });
    insertNode(w.ctx, { parentId: top.id, title: "Inside" });
    invalidate(w.ctx, "node_tree");
    await expect(
      w.call("nodes.delete", w.admin, {
        nodeId: top.id,
        threads: { action: "delete" },
        children: "moveUp",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(jobs(w)).toEqual([]);
    // Deleting them with it is fine, and so is a root category that holds categories only.
    await w.call("nodes.delete", w.admin, {
      nodeId: top.id,
      threads: { action: "delete" },
      children: "delete",
    });
    await finish(w);
    expect(exists(w, top.id)).toBe(false);
  });

  test("a target that is gone stops the job cleanly, leaves the forum read-only and says why", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "move", nodeId: s.target } });
    w.ctx.sqlite.prepare("UPDATE nodes SET type = 'category' WHERE id = ?1").run(s.target);
    invalidate(w.ctx, "node_tree");
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    expect(jobs(w)).toEqual([]);
    expect(exists(w, s.doomed)).toBe(true);
    expect(scalar(w, "SELECT is_read_only AS n FROM nodes WHERE id = ?1", s.doomed)).toBe(1);
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.first)).toBe(
      s.doomed,
    );
    const failed = w.ctx.sqlite
      .prepare<{ details: string }, []>(
        "SELECT details FROM moderator_log WHERE action = 'node.delete.failed'",
      )
      .all();
    expect(failed.map((row) => JSON.parse(row.details).reason)).toEqual(["targetGone"]);
    // Choosing a forum that exists carries it on.
    const other = insertNode(w.ctx, { parentId: w.category.id, title: "Other" });
    invalidate(w.ctx, "node_tree");
    await del(s, { threads: { action: "move", nodeId: other.id } });
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
    expect(scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", s.threads.first)).toBe(
      other.id,
    );
  });

  test("a target moved into the nodes being deleted stops the job instead of looping", async () => {
    const s = await scene();
    const { w } = s;
    await del(s, { threads: { action: "move", nodeId: s.target }, children: "delete" });
    w.ctx.sqlite.prepare("UPDATE nodes SET parent_id = ?1 WHERE id = ?2").run(s.doomed, s.target);
    invalidate(w.ctx, "node_tree");
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    expect(jobs(w)).toEqual([]);
    expect(
      scalar(w, "SELECT count(*) AS n FROM moderator_log WHERE action = 'node.delete.failed'"),
    ).toBe(1);
  });

  test("a forum that is itself being deleted is no place to move threads", async () => {
    const s = await scene();
    const { w } = s;
    await w.call("nodes.delete", w.admin, { nodeId: s.target, threads: { action: "delete" } });
    await expect(del(s, { threads: { action: "move", nodeId: s.target } })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(scalar(w, "SELECT is_read_only AS n FROM nodes WHERE id = ?1", s.doomed)).toBe(0);
  });

  test("moving to a forum that does not count posts takes the count off the authors, and only then", async () => {
    const s = await scene();
    const { w } = s;
    w.ctx.sqlite.prepare("UPDATE nodes SET counts_posts = 0 WHERE id = ?1").run(s.target);
    expect([postCount(w, w.aliceUser), postCount(w, w.bobUser)]).toEqual([2, 2]);
    await del(s, { threads: { action: "move", nodeId: s.target } });
    await finish(w);
    // First (alice) with bob's reply, and Second (bob) moved out; the thread in the subforum stays.
    expect([postCount(w, w.aliceUser), postCount(w, w.bobUser)]).toEqual([1, 0]);
  });

  test("a chunk counts every post of a thread, hidden ones too", async () => {
    const s = await scene();
    const { w } = s;
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'deleted', ?4)",
    );
    for (const id of [s.threads.first, s.threads.second])
      for (let i = 0; i < MOVE_POSTS * 0.6; i++) insert.run(id, w.bobUser.id, 10 + i, w.ctx.now());
    await del(s, { threads: { action: "move", nodeId: s.target } });
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    const moved = [s.threads.first, s.threads.second].filter(
      (id) => scalar(w, "SELECT node_id AS n FROM threads WHERE id = ?1", id) === s.target,
    );
    expect(moved).toHaveLength(1);
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
  });

  test("hiding big visible threads is charged to the chunk: one goes, the next waits", async () => {
    const s = await scene();
    const { w } = s;
    w.ctx.sqlite
      .prepare("UPDATE threads SET reply_count = 400 WHERE id IN (?1, ?2)")
      .run(s.threads.first, s.threads.second);
    await del(s, { threads: { action: "delete" } });
    w.ctx.clock.advance(60_000);
    await runDueJobs(w.ctx, { limit: 1 });
    const left = [s.threads.first, s.threads.second].filter(
      (id) => scalar(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", id) === 1,
    );
    // The small ones may also have gone; of the two big ones exactly one is left, still visible.
    expect(left).toHaveLength(1);
    expect(
      w.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(left[0]!)!.state,
    ).toBe("visible");
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
  });

  test("a group that holds admin.nodes but not forum.hardDelete may delete a forum", async () => {
    const s = await scene();
    const { w } = s;
    const keeper = customMember(w.ctx, ["admin.nodes", "node.view"]);
    await del(s, { threads: { action: "delete" } }, keeper.actor);
    await finish(w);
    expect(exists(w, s.doomed)).toBe(false);
  });
});

/** A view entry of a group (`userId` 0) or of one member (`groupId` 0). */
function viewEntry(
  w: World,
  nodeId: number,
  layer: { groupId?: number; userId?: number },
  value: number,
) {
  w.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, ?1, ?2, ?3, ?4 FROM permission_definitions WHERE key = 'node.view' ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
    )
    .run(nodeId, layer.groupId ?? 0, layer.userId ?? 0, value);
  invalidate(w.ctx, "permissions");
}

/**
 * Root > Staff (deleted, its nodes moving up) > Mid (category) > Deep (forum), and Staff > Direct
 * (forum). Who sees what, as the permission engine decides, must not change.
 */
async function moveUpCase(
  entries: (w: World, nodes: Record<string, number>, ids: Record<string, number>) => void,
) {
  const w = world();
  registerForumTransferJobs(w.ctx);
  const root = insertNode(w.ctx, { type: "category", title: "Root" });
  const staff = insertNode(w.ctx, { type: "category", parentId: root.id, title: "Staff" });
  const mid = insertNode(w.ctx, { type: "category", parentId: staff.id, title: "Mid" });
  const deep = insertNode(w.ctx, { parentId: mid.id, title: "Deep" });
  const direct = insertNode(w.ctx, { parentId: staff.id, title: "Direct" });
  const target = insertNode(w.ctx, { parentId: root.id, title: "Elsewhere" });
  invalidate(w.ctx, "node_tree");
  // Dana is a member who also belongs to a second group, without entries of her own.
  const second = customMember(w.ctx, []);
  const dana = insertUser(w.ctx, { username: "dana" });
  w.ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
    .run(dana.id, second.groupId);
  const nodes = { staff: staff.id, mid: mid.id, deep: deep.id, direct: direct.id };
  entries(w, nodes, { alice: w.aliceUser.id, second: second.groupId });
  invalidate(w.ctx, "permissions");
  const actors = {
    guest: GUEST,
    carol: w.carol,
    alice: w.alice,
    dana: userActor(dana),
    mod: w.mod,
  };
  const sees = () =>
    Object.fromEntries(
      Object.entries(actors).map(([name, actor]) => [
        name,
        [mid.id, deep.id, direct.id].map((nodeId) => can(w.ctx, actor, "node.view", { nodeId })),
      ]),
    );
  const before = sees();
  await w.call("nodes.delete", w.admin, {
    nodeId: staff.id,
    threads: { action: "move", nodeId: target.id },
    children: "moveUp",
  });
  await finish(w);
  expect(exists(w, staff.id)).toBe(false);
  expect(scalar(w, "SELECT parent_id AS n FROM nodes WHERE id = ?1", mid.id)).toBe(root.id);
  return { before, after: sees() };
}

describe("nodes.delete: moving nodes up keeps who sees them", () => {
  test("never on the deleted category, against an own allow of the groups below", async () => {
    const { before, after } = await moveUpCase((w, n) => {
      for (const group of [1, 2]) {
        viewEntry(w, n.staff!, { groupId: group }, -1);
        viewEntry(w, n.deep!, { groupId: group }, 1);
        viewEntry(w, n.direct!, { groupId: group }, 1);
      }
    });
    expect(before.carol).toEqual([false, false, false]);
    expect(before.mod).toEqual([true, true, true]);
    expect(after).toEqual(before);
  });

  test("no on the deleted category, against a member's own allow on a forum", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.direct!, { userId: id.alice }, 1);
    });
    expect(before.alice).toEqual([false, false, false]);
    expect(after).toEqual(before);
  });

  test("no on the deleted category, against a member's own allow on a middle category", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.mid!, { userId: id.alice }, 1);
    });
    expect(before.alice).toEqual([false, false, false]);
    expect(after).toEqual(before);
  });

  test("no on the deleted category, against an allow of a second group a member also holds", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.direct!, { groupId: id.second }, 1);
      viewEntry(w, n.mid!, { groupId: id.second }, 1);
    });
    expect(before.dana).toEqual([false, false, false]);
    expect(after).toEqual(before);
  });

  test("a member who saw the deleted category keeps what they saw, others still do not", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.staff!, { userId: id.alice }, 1);
      viewEntry(w, n.direct!, { groupId: 2 }, 1);
      viewEntry(w, n.deep!, { groupId: 2 }, -1);
    });
    expect(before.alice).toEqual([true, false, true]);
    expect(before.carol).toEqual([false, false, false]);
    expect(after).toEqual(before);
  });

  test("a node further down keeps the allow its moved-up parent gave it before that was lowered", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.staff!, { userId: id.alice }, 1);
      viewEntry(w, n.mid!, { groupId: 2 }, 1);
      viewEntry(w, n.deep!, { userId: id.alice }, 0);
    });
    expect(before.alice).toEqual([true, true, true]);
    expect(before.carol).toEqual([false, false, false]);
    expect(after).toEqual(before);
  });

  test("a member who saw the deleted category through a group and a forum through their own allow keeps it", async () => {
    const { before, after } = await moveUpCase((w, n, id) => {
      viewEntry(w, n.staff!, { groupId: 1 }, -1);
      viewEntry(w, n.staff!, { groupId: 2 }, 1);
      viewEntry(w, n.direct!, { groupId: 2 }, 0);
      viewEntry(w, n.direct!, { userId: id.alice }, 1);
    });
    expect(before.alice).toEqual([true, true, true]);
    expect(before.carol).toEqual([true, true, false]);
    expect(after).toEqual(before);
  });

  /**
   * Carol was once in the second group with an entry of her own (the combination of that time is
   * still stored), then left it. Staff is open to that group only; Direct says no to it and allows
   * members.
   */
  const leftTheGroup = (keepsEntry: boolean) =>
    moveUpCase((w, n, id) => {
      const carol = w.carolUser.id;
      w.ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
        .run(carol, id.second!);
      viewEntry(w, w.open.id, { userId: carol }, 1);
      if (!keepsEntry)
        w.ctx.sqlite.prepare("DELETE FROM permission_entries WHERE user_id = ?1").run(carol);
      w.ctx.sqlite
        .prepare("DELETE FROM user_groups WHERE user_id = ?1 AND group_id = ?2")
        .run(carol, id.second!);
      for (const group of [1, 2]) viewEntry(w, n.staff!, { groupId: group }, 0);
      viewEntry(w, n.staff!, { groupId: id.second }, 1);
      viewEntry(w, n.direct!, { groupId: id.second }, 0);
      viewEntry(w, n.direct!, { groupId: 2 }, 1);
    });
  /** Nobody sees a node after the move that they did not see before. */
  const noneGains = (before: Record<string, boolean[]>, after: Record<string, boolean[]>) => {
    for (const [name, seen] of Object.entries(after))
      seen.forEach((now, k) => {
        if (now) expect([name, before[name]![k]]).toEqual([name, true]);
      });
  };

  test("a member who left a group gains nothing from the combination they held in it", async () => {
    const { before, after } = await leftTheGroup(false);
    expect(before.carol).toEqual([false, false, false]);
    expect(after.carol).toEqual([false, false, false]);
    noneGains(before, after);
  });

  test("a combination nobody holds any more does not stop the deletion", async () => {
    const { before, after } = await leftTheGroup(true);
    expect(before.carol).toEqual([false, false, false]);
    expect(after.carol).toEqual([false, false, false]);
    noneGains(before, after);
  });

  test("a move up that would still show a node to more members is undone and the job stops", async () => {
    const w = world();
    registerForumTransferJobs(w.ctx);
    const root = insertNode(w.ctx, { type: "category", title: "Root" });
    const staff = insertNode(w.ctx, { type: "category", parentId: root.id, title: "Staff" });
    const direct = insertNode(w.ctx, { parentId: staff.id, title: "Direct" });
    const target = insertNode(w.ctx, { parentId: root.id, title: "Elsewhere" });
    invalidate(w.ctx, "node_tree");
    for (const group of [1, 2]) viewEntry(w, staff.id, { groupId: group }, -1);
    // Something else in the same transaction opens the forum to guests as it moves.
    w.ctx.sqlite.exec(
      `CREATE TRIGGER leak AFTER UPDATE OF parent_id ON nodes WHEN new.id = ${direct.id} BEGIN INSERT OR REPLACE INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, new.id, 1, 0, 1 FROM permission_definitions WHERE key = 'node.view'; END`,
    );
    const entries = () =>
      w.ctx.sqlite
        .prepare("SELECT group_id, user_id, value FROM permission_entries WHERE node_id = ?1")
        .all(direct.id);
    const held = entries();
    await w.call("nodes.delete", w.admin, {
      nodeId: staff.id,
      threads: { action: "move", nodeId: target.id },
      children: "moveUp",
    });
    for (let attempt = 0; attempt < 6; attempt++) {
      w.ctx.clock.advance(2 * 3_600_000);
      await runDueJobs(w.ctx, { limit: 1 });
    }
    const logged = (action: string) =>
      scalar(w, "SELECT count(*) AS n FROM moderator_log WHERE action = ?1", action);
    expect(logged("node.delete.failed")).toBe(1);
    expect(logged("node.delete.completed")).toBe(0);
    const error = w.ctx.sqlite
      .prepare<{ last_error: string }, []>(
        "SELECT last_error FROM jobs WHERE type = 'forums.deleteNode' AND status = 'failed'",
      )
      .get()!.last_error;
    expect(error).toContain(`Moving node ${direct.id} up would show it`);
    expect(exists(w, staff.id)).toBe(true);
    expect(scalar(w, "SELECT is_read_only AS n FROM nodes WHERE id = ?1", staff.id)).toBe(1);
    expect(scalar(w, "SELECT parent_id AS n FROM nodes WHERE id = ?1", direct.id)).toBe(staff.id);
    expect(entries()).toEqual(held);
    expect(can(w.ctx, GUEST, "node.view", { nodeId: direct.id })).toBe(false);
  });
});

test("the deletion's lookups hit their indexes", async () => {
  const s = await scene();
  expectNoTableScan(s.w.ctx, nodeDeleteSql.free, [s.doomed, DELETE_THREADS]);
  expectNoTableScan(s.w.ctx, nodeDeleteSql.any, [s.doomed]);
  expectNoTableScan(s.w.ctx, nodeDeleteSql.creditRules, ["[1]"]);
});
