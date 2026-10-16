import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import { GUEST } from "./actor";
import { cached, closeContext, createContext, invalidate } from "./context";
import * as contracts from "./contracts";
import { holdCheckpoints, paceWal, startCheckpointer } from "./db/checkpointer";
import { writeTx } from "./db/tx";
import { ValidationError } from "./errors";
import { enqueueJob, registerJobHandler, runDueJobs } from "./modules/jobs/queue";
import { defineContract, execute, implement } from "./operation";
import { decodeCursor, encodeCursor } from "./pagination";
import { renderBbCode } from "./render";
import { loadViewerReactions, reactionSummary } from "./shared/reactions";
import { loadUserSummaries } from "./shared/users";
import { createTestContext, expectNoTableScan, insertNode, insertUser, userActor } from "./testing";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sermo-test-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

describe("database connection", () => {
  test("applies the required pragmas on a file database", () => {
    const ctx = createContext({ path: tempDbPath(), migrate: true });
    const pragma = (name: string) =>
      Object.values(ctx.sqlite.query(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];
    expect(pragma("journal_mode")).toBe("wal");
    expect(pragma("synchronous")).toBe(1); // NORMAL
    expect(pragma("foreign_keys")).toBe(1);
    expect(pragma("busy_timeout")).toBe(5000);
    expect(pragma("journal_size_limit")).toBe(64 * 1024 * 1024);
    closeContext(ctx);
  });

  test("migrations create the default groups and reaction types", () => {
    const ctx = createTestContext();
    const groups = ctx.sqlite.query("SELECT id, title FROM groups ORDER BY id").all();
    expect(groups).toEqual([
      { id: 1, title: "Guest" },
      { id: 2, title: "Member" },
      { id: 3, title: "Moderator" },
      { id: 4, title: "Administrator" },
      { id: 5, title: "Unconfirmed" },
    ]);
    const types = ctx.sqlite.query("SELECT count(*) AS n FROM reaction_types").get() as {
      n: number;
    };
    expect(types.n).toBe(6);
  });

  test("foreign keys are enforced", () => {
    const ctx = createTestContext();
    expect(() =>
      ctx.sqlite.run(
        "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (999, 999, 't', 0, 0, 0)",
      ),
    ).toThrow();
  });

  test("writeTx rolls back on throw", () => {
    const ctx = createTestContext();
    expect(() =>
      writeTx(ctx, () => {
        insertUser(ctx, { username: "rolledback" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const row = ctx.sqlite.query("SELECT count(*) AS n FROM users").get() as { n: number };
    expect(row.n).toBe(0);
  });
});

describe("search index triggers", () => {
  function createThreadWithPost(
    ctx: ReturnType<typeof createTestContext>,
    title: string,
    body: string,
  ) {
    const user = insertUser(ctx);
    const node = insertNode(ctx, { type: "forum" });
    return writeTx(ctx, () => {
      const thread = ctx.sqlite
        .query<{ id: number }, [number, number, string]>(
          "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, ?3, 0, 0, ?2) RETURNING id",
        )
        .get(node.id, user.id, title)!;
      const insertPost = (position: number, source: string) => {
        const row = ctx.sqlite
          .query<{ id: number }, [number, number, number]>(
            "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, ?3, 0) RETURNING id",
          )
          .get(thread.id, user.id, position)!;
        ctx.sqlite.run(
          "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, ?2, '')",
          [row.id, source],
        );
        return row;
      };
      const post = insertPost(0, body);
      ctx.sqlite.run("UPDATE threads SET first_post_id = ?1 WHERE id = ?2", [post.id, thread.id]);
      const reply = insertPost(1, "a reply about kittens");
      return { threadId: thread.id, postId: post.id, replyId: reply.id };
    });
  }
  const search = (ctx: ReturnType<typeof createTestContext>, q: string) =>
    ctx.sqlite
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rowid",
      )
      .all(q)
      .map((r) => r.rowid);

  test("indexes the title on the first post only, and bodies on every post", () => {
    const ctx = createTestContext();
    const { postId, replyId } = createThreadWithPost(ctx, "Gardening tips", "Tomatoes need sun");
    expect(search(ctx, "title:gardening")).toEqual([postId]);
    expect(search(ctx, "tomatoes")).toEqual([postId]);
    expect(search(ctx, "kittens")).toEqual([replyId]);
  });

  test("follows title edits and body edits", () => {
    const ctx = createTestContext();
    const { threadId, postId } = createThreadWithPost(ctx, "Gardening tips", "Tomatoes need sun");
    ctx.sqlite.run("UPDATE threads SET title = 'Cooking tips' WHERE id = ?1", [threadId]);
    expect(search(ctx, "title:gardening")).toEqual([]);
    expect(search(ctx, "title:cooking")).toEqual([postId]);
    ctx.sqlite.run("UPDATE post_bodies SET body_source = 'Peppers need water' WHERE post_id = ?1", [
      postId,
    ]);
    expect(search(ctx, "tomatoes")).toEqual([]);
    expect(search(ctx, "peppers")).toEqual([postId]);
    expect(search(ctx, "title:cooking")).toEqual([postId]);
  });
});

describe("versioned caches", () => {
  test("invalidation in one context is seen by another context on the same file", () => {
    const path = tempDbPath();
    const a = createContext({ path, migrate: true });
    const b = createContext({ path });
    let builds = 0;
    const read = () => cached(b, "node_tree", () => ++builds);
    expect(read()).toBe(1);
    expect(read()).toBe(1);
    writeTx(a, () => invalidate(a, "node_tree"));
    expect(read()).toBe(2);
    closeContext(a);
    closeContext(b);
  });
});

describe("cursors", () => {
  test("round-trip and reject garbage", () => {
    const schema = z.tuple([z.number(), z.number()]);
    expect(decodeCursor(encodeCursor([123, 45]), schema)).toEqual([123, 45]);
    expect(() => decodeCursor("not-a-cursor", schema)).toThrow(ValidationError);
    expect(() => decodeCursor(encodeCursor(["x"]), schema)).toThrow(ValidationError);
  });
});

describe("rendering", () => {
  test("renders BB code and leaves Markdown as typed", () => {
    expect(renderBbCode("[B]hi[/B] [I]there[/I]")).toBe(
      "<p><strong>hi</strong> <em>there</em></p>",
    );
    expect(renderBbCode("**hi** _there_")).toBe("<p>**hi** _there_</p>");
  });

  test("escapes raw HTML and strips dangerous URLs", () => {
    const html = renderBbCode(
      '<script>alert(1)</script>\n\n[URL=javascript:alert(1)]x[/URL] <img src=x onerror="alert(1)">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  test("adds rel to links", () => {
    expect(renderBbCode("[URL=https://example.com]a[/URL]")).toContain(
      'rel="nofollow ugc noopener"',
    );
  });
});

describe("operations", () => {
  const echo = implement(
    defineContract({
      name: "test.echo",
      summary: "",
      kind: "read",
      input: z.object({ n: z.number().int() }),
      output: z.object({ n: z.number().int() }),
    }),
    (_ctx, _actor, input) => ({ n: input.n }),
  );
  const broken = implement({ ...echo }, () => ({ n: "nope" as unknown as number }));

  test("execute validates input and maps errors to ValidationError", async () => {
    const ctx = createTestContext();
    expect(await execute(ctx, echo, GUEST, { n: 2 })).toEqual({ n: 2 });
    const error = await execute(ctx, echo, GUEST, { n: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.issues[0].path).toEqual(["n"]);
  });

  test("execute validates output when configured", async () => {
    const ctx = createTestContext();
    expect(execute(ctx, broken, GUEST, { n: 1 })).rejects.toThrow("violates its contract");
  });

  test("contract names are unique and dotted", () => {
    const isContract = (v: unknown): v is { name: string } =>
      typeof v === "object" && v !== null && "kind" in v && "input" in v && "output" in v;
    const names = (Object.values(contracts) as unknown[]).filter(isContract).map((c) => c.name);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
  });
});

describe("shared loaders", () => {
  test("loadUserSummaries batches and tolerates missing ids", () => {
    const ctx = createTestContext();
    const u = insertUser(ctx, { username: "alice" });
    const get = loadUserSummaries(ctx, [u.id, u.id, 9999]);
    expect(get(u.id)).toEqual({ id: u.id, username: "alice" });
    expect(get(9999).id).toBe(9999);
    expectNoTableScan(
      ctx,
      "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
      ["[1,2]"],
    );
  });

  test("loadViewerReactions returns the viewer's reactions only", () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const viewer = insertUser(ctx);
    const other = insertUser(ctx);
    const insert = ctx.sqlite.prepare(
      "INSERT INTO reactions (content_type, content_id, user_id, content_user_id, reaction_type_id, score, created_at) VALUES ('post', ?1, ?2, ?3, ?4, 1, 0)",
    );
    insert.run(10, viewer.id, author.id, 2);
    insert.run(11, other.id, author.id, 1);
    const map = loadViewerReactions(ctx, userActor(viewer), "post", [10, 11, 12]);
    expect([...map]).toEqual([[10, 2]]);
    expect(loadViewerReactions(ctx, GUEST, "post", [10]).size).toBe(0);
    expectNoTableScan(
      ctx,
      "SELECT content_id, reaction_type_id FROM reactions WHERE content_type = ?1 AND user_id = ?2 AND content_id IN (SELECT value FROM json_each(?3))",
      ["post", 1, "[1]"],
    );
  });

  test("reactionSummary totals counts and drops zeroes", () => {
    expect(reactionSummary('{"1":3,"2":0,"4":1}', 4)).toEqual({
      counts: { "1": 3, "4": 1 },
      total: 4,
      mine: 4,
    });
    expect(reactionSummary("{}", undefined)).toEqual({ counts: {}, total: 0, mine: null });
  });
});

describe("review regressions", () => {
  test("a value built inside a rolled-back transaction is never cached", () => {
    const path = tempDbPath();
    const a = createContext({ path, migrate: true });
    const b = createContext({ path });
    const read = (ctx: typeof a) =>
      cached(ctx, "permissions", () => {
        const row = ctx.sqlite.query("SELECT can_post FROM groups WHERE id = 2").get() as {
          can_post: number;
        };
        return row.can_post;
      });
    expect(read(a)).toBe(1);
    expect(() =>
      writeTx(a, () => {
        a.sqlite.run("UPDATE groups SET can_post = 0 WHERE id = 2");
        invalidate(a, "permissions");
        expect(read(a)).toBe(0);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    writeTx(b, () => invalidate(b, "permissions"));
    expect(read(a)).toBe(1);
    closeContext(a);
    closeContext(b);
  });

  test("writeTx refuses async callbacks and rolls back their synchronous part", () => {
    const ctx = createTestContext();
    expect(() =>
      writeTx(ctx, (async () => {
        insertUser(ctx, { username: "asyncwriter" });
        await Promise.resolve();
      }) as unknown as () => void),
    ).toThrow("synchronous");
    const row = ctx.sqlite.query("SELECT count(*) AS n FROM users").get() as { n: number };
    expect(row.n).toBe(0);
  });

  test("deeply nested quotes are a validation error, not a crash", () => {
    expect(() => renderBbCode("[QUOTE]".repeat(5000) + "[/QUOTE]".repeat(5000))).toThrow(
      ValidationError,
    );
    expect(renderBbCode("[QUOTE][QUOTE]quoted twice[/QUOTE][/QUOTE]")).toContain("<blockquote");
  });

  test("expectNoTableScan resolves aliases and rejects temp B-tree sorts", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, "SELECT n.id FROM nodes n");
    expect(() => expectNoTableScan(ctx, "SELECT p.id FROM posts p")).toThrow();
    expect(() =>
      expectNoTableScan(ctx, "SELECT id FROM posts WHERE thread_id = ?1 ORDER BY created_at", [1]),
    ).toThrow();
  });
});

describe("checkpointer", () => {
  test("turns off auto-checkpoint and checkpoints the WAL on a worker thread", async () => {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    const stop = startCheckpointer(ctx, { intervalMs: 20 });
    const pragma = () =>
      (ctx.sqlite.query("PRAGMA wal_autocheckpoint").get() as { wal_autocheckpoint: number })
        .wal_autocheckpoint;
    expect(pragma()).toBe(0);
    for (let i = 0; i < 200; i++) insertUser(ctx);
    const walSize = () => Bun.file(`${path}-wal`).size;
    expect(walSize()).toBeGreaterThan(0);
    // Once the worker has checkpointed, the next write restarts the WAL from the beginning
    // instead of appending, so its size stops growing.
    await Bun.sleep(200);
    const before = walSize();
    for (let i = 0; i < 200; i++) insertUser(ctx);
    expect(walSize()).toBe(before);
    await stop();
    expect(pragma()).toBe(1000);
    closeContext(ctx);
  });

  test("defers checkpoints while background work holds them", async () => {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    const stop = startCheckpointer(ctx, { intervalMs: 20 });
    const walSize = () => Bun.file(`${path}-wal`).size;
    const release = holdCheckpoints(ctx);
    for (let i = 0; i < 200; i++) insertUser(ctx);
    await Bun.sleep(200);
    // Nothing was checkpointed, so further writes keep appending.
    const held = walSize();
    for (let i = 0; i < 200; i++) insertUser(ctx);
    expect(walSize()).toBeGreaterThan(held);
    release();
    // The checkpoint that follows the release copies everything the hold let pile up, which
    // takes longer the larger the schema's writes are: wait until a write no longer makes the
    // WAL grow (at most five seconds) instead of a fixed pause.
    const deadline = Date.now() + 5000;
    for (;;) {
      await Bun.sleep(50);
      const before = walSize();
      insertUser(ctx);
      if (walSize() === before || Date.now() > deadline) break;
    }
    const released = walSize();
    for (let i = 0; i < 200; i++) insertUser(ctx);
    expect(walSize()).toBe(released);
    await stop();
    closeContext(ctx);
  });

  test("paceWal stops a job until the WAL can restart once the file is past its limit", async () => {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    ctx.sqlite.run("CREATE TABLE junk (id INTEGER PRIMARY KEY, v BLOB)");
    const limit = 256 * 1024;
    ctx.sqlite.run(`PRAGMA journal_size_limit = ${limit}`);
    const stop = startCheckpointer(ctx, { intervalMs: 20 });
    const walSize = () => Bun.file(`${path}-wal`).size;
    const insert = ctx.sqlite.prepare("INSERT INTO junk (v) VALUES (randomblob(2000))");
    // A job writing back to back: its hold keeps the periodic checkpoints away for 30 s.
    const release = holdCheckpoints(ctx);
    for (let i = 0; i < 1000; i++) insert.run();
    expect(walSize()).toBeGreaterThan(limit * 4);
    await paceWal(ctx);
    // Everything was copied while the job waited, so the next write restarts the WAL and the
    // file is cut back to the limit.
    insert.run();
    expect(walSize()).toBeLessThanOrEqual(limit);
    release();
    await stop();
    closeContext(ctx);
  });

  /** A file database with a checkpointer, a small WAL limit and helpers to grow the WAL. */
  function pacedFixture() {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    ctx.sqlite.run("CREATE TABLE junk (id INTEGER PRIMARY KEY, v BLOB)");
    ctx.sqlite.run("PRAGMA journal_size_limit = 65536");
    const stopCheckpointer = startCheckpointer(ctx, { intervalMs: 20 });
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopping ??= stopCheckpointer();
      return stopping;
    };
    const insert = ctx.sqlite.prepare("INSERT INTO junk (v) VALUES (randomblob(2000))");
    const readers: Database[] = [];
    return {
      ctx,
      stop,
      walSize: () => Bun.file(`${path}-wal`).size,
      grow: (rows: number) => {
        for (let i = 0; i < rows; i++) insert.run();
      },
      /** A reader at the current snapshot: no checkpoint can copy the frames written after it. */
      pin: () => {
        const reader = new Database(path);
        readers.push(reader);
        reader.run("BEGIN");
        reader.query("SELECT COUNT(*) FROM junk").get();
        return () => reader.run("COMMIT");
      },
      timed: async (maxWaitMs: number) => {
        const started = performance.now();
        await paceWal(ctx, maxWaitMs);
        return performance.now() - started;
      },
      close: async () => {
        for (const reader of readers) reader.close();
        await stop();
        closeContext(ctx);
      },
    };
  }

  test("paceWal gives up on a checkpoint a reader holds back, and waits again only once the WAL doubles", async () => {
    const fixture = pacedFixture();
    try {
      fixture.pin();
      fixture.grow(200);
      expect(await fixture.timed(300)).toBeGreaterThanOrEqual(300);
      expect(await fixture.timed(300)).toBeLessThan(100);
      fixture.grow(400);
      expect(await fixture.timed(300)).toBeGreaterThanOrEqual(300);
    } finally {
      await fixture.close();
    }
  });

  test("paceWal forgets a give-up once the WAL is back under its limit", async () => {
    const fixture = pacedFixture();
    try {
      const release = fixture.pin();
      fixture.grow(200);
      expect(await fixture.timed(300)).toBeGreaterThanOrEqual(300);
      release();
      // The periodic checkpoint catches up, a write restarts the WAL and the file is cut back.
      for (let i = 0; fixture.walSize() > 65536 && i < 100; i++) {
        await Bun.sleep(30);
        fixture.grow(1);
      }
      expect(fixture.walSize()).toBeLessThanOrEqual(65536);
      await fixture.timed(300); // under the limit: clears the memory of the give-up
      // Below twice the earlier give-up size, so only a cleared memory waits again.
      fixture.pin();
      fixture.grow(60);
      expect(fixture.walSize()).toBeGreaterThan(65536);
      expect(await fixture.timed(300)).toBeGreaterThanOrEqual(300);
    } finally {
      await fixture.close();
    }
  });

  test("paceWal keeps waiting while the checkpoint still copies frames", async () => {
    const fixture = pacedFixture();
    try {
      const release = fixture.pin();
      fixture.grow(200);
      const waited = fixture.timed(400);
      // Part-way through the wait the first reader goes and a later one takes its place: the
      // checkpoint copies the frames between them, which is progress, then is held back again.
      await Bun.sleep(250);
      release();
      fixture.grow(100);
      fixture.pin();
      fixture.grow(50);
      // Without progress the wait would end 400 ms in; with it, 400 ms after the copy.
      expect(await waited).toBeGreaterThanOrEqual(600);
    } finally {
      await fixture.close();
    }
  });

  test("stopping the checkpointer ends a wait", async () => {
    const fixture = pacedFixture();
    try {
      fixture.pin();
      fixture.grow(200);
      const waited = fixture.timed(5000);
      await Bun.sleep(100);
      await fixture.stop();
      expect(await waited).toBeLessThan(1000);
    } finally {
      await fixture.close();
    }
  });

  test("paceWal returns at once when no checkpointer runs", async () => {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    ctx.sqlite.run("CREATE TABLE junk (id INTEGER PRIMARY KEY, v BLOB)");
    ctx.sqlite.run("PRAGMA journal_size_limit = 65536");
    ctx.sqlite.run("PRAGMA wal_autocheckpoint = 0");
    const insert = ctx.sqlite.prepare("INSERT INTO junk (v) VALUES (randomblob(2000))");
    for (let i = 0; i < 100; i++) insert.run();
    const size = Bun.file(`${path}-wal`).size;
    expect(size).toBeGreaterThan(65536);
    const started = performance.now();
    await paceWal(ctx); // no checkpointer: nothing would ever finish a checkpoint
    expect(performance.now() - started).toBeLessThan(500);
    expect(Bun.file(`${path}-wal`).size).toBe(size);
    closeContext(ctx);
  });

  test("back-to-back jobs cannot hold checkpoints past the limit", async () => {
    const path = tempDbPath();
    const ctx = createContext({ path, migrate: true });
    ctx.sqlite.run("CREATE TABLE junk (id INTEGER PRIMARY KEY, v BLOB)");
    const stop = startCheckpointer(ctx, { intervalMs: 10, testMaxHoldMs: 50 });
    const insert = ctx.sqlite.prepare("INSERT INTO junk (v) VALUES (randomblob(2000))");
    const rows = 20;
    registerJobHandler(ctx, "test.write", async () => {
      for (let i = 0; i < rows; i++) insert.run();
      await Bun.sleep(20);
    });
    const jobs = 60;
    for (let i = 0; i < jobs; i++) enqueueJob(ctx, "test.write", {});
    // Wait until the worker checkpoints (a write then reuses the WAL instead of growing it), so
    // the limit counts from a recent checkpoint.
    const walSize = () => Bun.file(`${path}-wal`).size;
    for (let size = -1; size !== walSize(); ) {
      size = walSize();
      await Bun.sleep(50);
      insert.run();
    }
    // A hold is active for nearly the whole run. Every insert commits at least one WAL frame, so
    // without checkpoints the WAL would hold at least jobs * rows frames; checkpoints during the
    // run restart it, leaving only the frames written since the last restart.
    expect(await runDueJobs(ctx, { limit: jobs })).toBe(jobs);
    const { log } = ctx.sqlite.query("PRAGMA wal_checkpoint(PASSIVE)").get() as { log: number };
    expect(log).toBeLessThan((jobs * rows) / 2);
    await stop();
    closeContext(ctx);
  });
});
