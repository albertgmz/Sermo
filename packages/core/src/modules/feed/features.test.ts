import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { addFeature, featureSql, PAID_FEATURE_MS } from "../forums/features";
import { fillThreads, type World, world } from "./fixtures.test";
import { refreshRankings } from "./rankings";

const DAY = 86_400_000;
type Item = { type: string; featured: string | null; thread: { id: number } };

const hotIds = async (w: World, viewer: Parameters<World["call"]>[1]) =>
  (await w.call("feed.list", viewer, { scope: "hot" })).items.map((item: Item) => item.thread.id);
const featuredIds = async (w: World, viewer: Parameters<World["call"]>[1], limit = 3) =>
  (await w.call("threads.featured", viewer, { limit })).items.map(
    (item: { thread: { id: number } }) => item.thread.id,
  );
const feature = (w: World, actor: Parameters<World["call"]>[1], threadId: number, on = true) =>
  w.call("threads.setFeatured", actor, { threadId, isFeatured: on });
/** A paid promotion, as shop.use writes it. */
const promote = (w: World, threadId: number, userId: number) =>
  addFeature(w.ctx, {
    threadId,
    kind: "paid",
    userId,
    now: w.ctx.now(),
    endsAt: w.ctx.now() + PAID_FEATURE_MS,
  });
const rows = (w: World) =>
  w.ctx.sqlite
    .prepare<
      {
        thread_id: number;
        kind: string;
        user_id: number;
        started_at: number;
        ends_at: number | null;
      },
      []
    >("SELECT thread_id, kind, user_id, started_at, ends_at FROM thread_features ORDER BY id")
    .all();

describe("threads.setFeatured", () => {
  test("a moderator or administrator features a thread; guests and members may not", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Pick");
    await expect(feature(w, GUEST, t.thread.id)).rejects.toBeInstanceOf(UnauthenticatedError);
    // The author is a member without the permission, in their own thread too.
    await expect(feature(w, w.alice, t.thread.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(feature(w, w.bob, t.thread.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(rows(w)).toEqual([]);
    expect(await feature(w, w.mod, t.thread.id)).toMatchObject({ id: t.thread.id });
    expect(rows(w)).toEqual([
      {
        thread_id: t.thread.id,
        kind: "staff",
        user_id: actorUserId(w.mod)!,
        started_at: w.ctx.now(),
        ends_at: null,
      },
    ]);
    const other = await w.thread(w.alice, w.open.id, "Other");
    await feature(w, w.admin, other.thread.id);
    expect(rows(w)).toHaveLength(2);
  });

  test("threads.get says why a thread is featured, and nothing once the pick ends", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Pick");
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBeNull();
    await feature(w, w.mod, t.thread.id);
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBe("staff");
    w.ctx.clock.advance(1000);
    await feature(w, w.mod, t.thread.id, false);
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBeNull();
    expect(rows(w)).toMatchObject([{ kind: "staff", ends_at: w.ctx.now() }]);
  });

  test("asking for the state a thread already has changes and logs nothing", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Pick");
    await feature(w, w.mod, t.thread.id, false);
    await feature(w, w.mod, t.thread.id);
    await feature(w, w.admin, t.thread.id);
    expect(rows(w)).toHaveLength(1);
    await feature(w, w.mod, t.thread.id, false);
    await feature(w, w.mod, t.thread.id, false);
    const log = await w.call("moderatorLog.list", w.admin, { action: "thread.feature" });
    expect(log.items.map((entry: { details: object }) => entry.details)).toEqual([
      { isFeatured: false },
      { isFeatured: true },
    ]);
  });

  test("it is a moderator action in the log, with its reason and forum", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Pick");
    await w.call("threads.setFeatured", w.mod, {
      threadId: t.thread.id,
      isFeatured: true,
      reason: "Great guide",
    });
    const log = await w.call("moderatorLog.list", w.admin, { nodeId: w.open.id });
    expect(log.items).toMatchObject([
      {
        actorId: actorUserId(w.mod)!,
        action: "thread.feature",
        targetType: "thread",
        targetId: t.thread.id,
        reason: "Great guide",
        details: { isFeatured: true },
      },
    ]);
  });

  test("only a visible thread can be featured, and a hidden one is not found", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Gone");
    await w.call("threads.delete", w.mod, { threadId: t.thread.id, reason: "x", notify: false });
    await expect(feature(w, w.mod, t.thread.id)).rejects.toBeInstanceOf(ConflictError);
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    await expect(feature(w, w.alice, secret.thread.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(rows(w)).toEqual([]);
    // A thread that was deleted after it was picked can still be unpicked.
    const kept = await w.thread(w.alice, w.open.id, "Kept");
    await feature(w, w.mod, kept.thread.id);
    await w.call("threads.delete", w.mod, { threadId: kept.thread.id, reason: "x", notify: false });
    await feature(w, w.mod, kept.thread.id, false);
    expect(rows(w)).toMatchObject([{ ends_at: w.ctx.now() }]);
  });

  test("a staff pick may be added to a thread that is being promoted, and ends alone", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Both");
    promote(w, t.thread.id, w.aliceUser.id);
    await feature(w, w.mod, t.thread.id);
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBe("staff");
    w.ctx.clock.advance(1000);
    await feature(w, w.mod, t.thread.id, false);
    // The promotion runs on.
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBe("paid");
    expect(rows(w).map((row) => [row.kind, row.ends_at === null])).toEqual([
      ["paid", false],
      ["staff", false],
    ]);
  });

  test("a second staff pick row for one thread cannot exist at all", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Pick");
    await feature(w, w.mod, t.thread.id);
    expect(() =>
      addFeature(w.ctx, {
        threadId: t.thread.id,
        kind: "staff",
        userId: actorUserId(w.mod)!,
        now: w.ctx.now(),
        endsAt: null,
      }),
    ).toThrow();
  });
});

describe("featured threads in hot", () => {
  test("a featured thread is listed below the activity floor, first, ahead of the hot ones", async () => {
    const w = world();
    const busy = await w.thread(w.alice, w.open.id, "Busy");
    const quiet = await w.thread(w.bob, w.open.id, "Quiet");
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 9 WHERE id = ?1").run(busy.thread.id);
    refreshRankings(w.ctx);
    expect(await hotIds(w, GUEST)).toEqual([busy.thread.id]);
    await feature(w, w.mod, quiet.thread.id);
    const hot = (await w.call("feed.list", GUEST, { scope: "hot" })).items as Item[];
    expect(hot.map((item) => [item.thread.id, item.featured])).toEqual([
      [quiet.thread.id, "staff"],
      [busy.thread.id, null],
    ]);
    expect(hot.every((item) => item.type === "thread")).toBe(true);
  });

  test("features are listed newest first, a thread that is also hot once, and ranked ones follow in order", async () => {
    const w = world();
    const [a, b, c, d] = [
      await w.thread(w.alice, w.open.id, "A"),
      await w.thread(w.alice, w.open.id, "B"),
      await w.thread(w.alice, w.open.id, "C"),
      await w.thread(w.alice, w.open.id, "D"),
    ];
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 9 WHERE id = ?1").run(a.thread.id);
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 5 WHERE id = ?1").run(b.thread.id);
    refreshRankings(w.ctx);
    expect(await hotIds(w, GUEST)).toEqual([a.thread.id, b.thread.id]);
    await feature(w, w.mod, c.thread.id);
    w.ctx.clock.advance(1000);
    await feature(w, w.mod, b.thread.id);
    w.ctx.clock.advance(1000);
    promote(w, d.thread.id, w.aliceUser.id);
    const hot = (await w.call("feed.list", GUEST, { scope: "hot" })).items as Item[];
    expect(hot.map((item) => [item.thread.id, item.featured])).toEqual([
      [d.thread.id, "paid"],
      [b.thread.id, "staff"],
      [c.thread.id, "staff"],
      [a.thread.id, null],
    ]);
  });

  test("a paid promotion is listed for 24 hours and then drops out by itself", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Promoted");
    promote(w, t.thread.id, w.aliceUser.id);
    expect(await hotIds(w, GUEST)).toEqual([t.thread.id]);
    w.ctx.clock.advance(PAID_FEATURE_MS - 1);
    expect(await hotIds(w, GUEST)).toEqual([t.thread.id]);
    expect(await featuredIds(w, GUEST)).toEqual([t.thread.id]);
    w.ctx.clock.advance(1);
    expect(await hotIds(w, GUEST)).toEqual([]);
    expect(await featuredIds(w, GUEST)).toEqual([]);
    expect((await w.call("threads.get", GUEST, { threadId: t.thread.id })).featured).toBeNull();
  });

  test("hot features follow the visibility of hot: hidden forums, deleted threads, ignored authors", async () => {
    const w = world();
    const open = await w.thread(w.alice, w.open.id, "Open");
    const secret = await w.thread(w.admin, w.secret.id, "Secret");
    const gone = await w.thread(w.alice, w.open.id, "Gone");
    const bobs = await w.thread(w.bob, w.open.id, "Bobs");
    for (const t of [open, secret, gone, bobs]) {
      w.ctx.clock.advance(1000);
      await feature(w, w.admin, t.thread.id);
    }
    expect(await hotIds(w, w.carol)).toEqual([bobs.thread.id, gone.thread.id, open.thread.id]);
    expect(await hotIds(w, GUEST)).toEqual([bobs.thread.id, gone.thread.id, open.thread.id]);
    // Staff may open the hidden forum.
    expect(await hotIds(w, w.admin)).toEqual([
      bobs.thread.id,
      gone.thread.id,
      secret.thread.id,
      open.thread.id,
    ]);
    await w.call("threads.delete", w.mod, { threadId: gone.thread.id, reason: "x", notify: false });
    await w.call("users.block", w.carol, { userId: w.bobUser.id });
    expect(await hotIds(w, w.carol)).toEqual([open.thread.id]);
    expect(await hotIds(w, GUEST)).toEqual([bobs.thread.id, open.thread.id]);
    // The same filters apply to the home block.
    expect(await featuredIds(w, w.carol)).toEqual([open.thread.id]);
    expect(await featuredIds(w, GUEST)).toEqual([bobs.thread.id, open.thread.id]);
    // A thread that moves to a forum the viewer cannot open drops out; a restore brings it back.
    await w.call("threads.move", w.admin, { threadId: open.thread.id, nodeId: w.secret.id });
    expect(await hotIds(w, GUEST)).toEqual([bobs.thread.id]);
    expect(await featuredIds(w, GUEST)).toEqual([bobs.thread.id]);
  });

  test("a thread awaiting approval or merged away is not listed", async () => {
    const w = world();
    const waiting = await w.thread(w.alice, w.open.id, "Waiting");
    const merged = await w.thread(w.alice, w.open.id, "Merged");
    const target = await w.thread(w.alice, w.open.id, "Target");
    await feature(w, w.mod, waiting.thread.id);
    await feature(w, w.mod, merged.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(waiting.thread.id);
    w.ctx.sqlite
      .prepare("UPDATE threads SET merged_into_id = ?1, state = 'deleted' WHERE id = ?2")
      .run(target.thread.id, merged.thread.id);
    expect(await hotIds(w, GUEST)).toEqual([]);
    expect(await featuredIds(w, GUEST)).toEqual([]);
  });

  test("at most 10 features are pinned, newest first, and the ranked threads fill the rest", async () => {
    const w = world();
    const ids = fillThreads(w.ctx, w.open.id, w.aliceUser.id, 55);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO post_bodies (post_id, body_source, body_html) SELECT first_post_id, 'x', '<p>x</p>' FROM threads WHERE node_id = ?1",
      )
      .run(w.open.id);
    for (const id of ids) {
      w.ctx.clock.advance(1000);
      promote(w, id, w.aliceUser.id);
    }
    const hot = await w.call("feed.list", GUEST, { scope: "hot" });
    expect(hot.nextCursor).toBeNull();
    expect(hot.items.map((item: Item) => item.thread.id)).toEqual(ids.slice(-10).reverse());
    // A ranked thread is not pushed out, and a featured thread beyond the 10 shows where it ranks,
    // with its mark.
    const busy = ids[0]!;
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 9 WHERE id = ?1").run(busy);
    const other = await w.thread(w.bob, w.open.id, "Busy and plain");
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 8 WHERE id = ?1").run(other.thread.id);
    refreshRankings(w.ctx);
    const items = (await w.call("feed.list", GUEST, { scope: "hot" })).items as Item[];
    expect(items.map((item) => [item.thread.id, item.featured])).toEqual([
      ...ids
        .slice(-10)
        .reverse()
        .map((id) => [id, "paid"]),
      [busy, "paid"],
      [other.thread.id, null],
    ]);
    // The home block still lists them in order, beyond what Hot pins.
    expect(await featuredIds(w, GUEST, 20)).toEqual(ids.slice(-20).reverse());
  });

  test("the cards of the other feeds mark a featured thread too", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Marked");
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    await feature(w, w.mod, t.thread.id);
    for (const scope of ["latest", "following"]) {
      if (scope === "following") await w.call("users.follow", w.carol, { userId: w.aliceUser.id });
      const items = (await w.call("feed.list", scope === "latest" ? GUEST : w.carol, { scope }))
        .items as Item[];
      const marks = Object.fromEntries(items.map((item) => [item.thread.id, item.featured]));
      expect(marks).toEqual({ [t.thread.id]: "staff", [plain.thread.id]: null });
    }
  });
});

describe("threads.featured", () => {
  test("lists the features newest first with their kind and end, up to the limit", async () => {
    const w = world();
    const a = await w.thread(w.alice, w.open.id, "A");
    const b = await w.thread(w.alice, w.open.id, "B");
    const c = await w.thread(w.alice, w.open.id, "C");
    await feature(w, w.mod, a.thread.id);
    w.ctx.clock.advance(1000);
    promote(w, b.thread.id, w.aliceUser.id);
    w.ctx.clock.advance(1000);
    await feature(w, w.mod, c.thread.id);
    const all = await w.call("threads.featured", GUEST, { limit: 10 });
    expect(
      all.items.map((item: { kind: string; endsAt: string | null; thread: { id: number } }) => [
        item.thread.id,
        item.kind,
        item.endsAt,
      ]),
    ).toEqual([
      [c.thread.id, "staff", null],
      [b.thread.id, "paid", new Date(w.ctx.now() - 1000 + PAID_FEATURE_MS).toISOString()],
      [a.thread.id, "staff", null],
    ]);
    expect(await featuredIds(w, GUEST, 2)).toEqual([c.thread.id, b.thread.id]);
    // The default is a small fixed number.
    expect(await featuredIds(w, GUEST, 3)).toHaveLength(3);
    expect((await w.call("threads.featured", GUEST, {})).items).toHaveLength(3);
  });

  test("a thread with a staff pick and a promotion is listed once, as its pick", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Both");
    promote(w, t.thread.id, w.aliceUser.id);
    w.ctx.clock.advance(1000);
    await feature(w, w.mod, t.thread.id);
    const { items } = await w.call("threads.featured", GUEST, {});
    expect(items).toMatchObject([{ kind: "staff", endsAt: null }]);
  });

  test("a thread whose opening post is not visible is left out, as in hot", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Hidden opening");
    const shown = await w.thread(w.alice, w.open.id, "Shown");
    await feature(w, w.mod, t.thread.id);
    await feature(w, w.mod, shown.thread.id);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(t.post.id);
    expect(await hotIds(w, GUEST)).toEqual([shown.thread.id]);
    expect(await featuredIds(w, GUEST)).toEqual([shown.thread.id]);
  });

  test("keeps filling the limit past features the viewer cannot open", async () => {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Visible");
    await feature(w, w.mod, mine.thread.id);
    for (let i = 0; i < 6; i++) {
      const hidden = await w.thread(w.admin, w.secret.id, `Hidden ${i}`);
      w.ctx.clock.advance(1000);
      await feature(w, w.admin, hidden.thread.id);
    }
    expect(await featuredIds(w, GUEST, 1)).toEqual([mine.thread.id]);
    expect(await featuredIds(w, w.admin, 3)).toHaveLength(3);
  });
});

describe("thread features housekeeping", () => {
  test("the rankings job deletes features that ended over 30 days ago and nothing else", async () => {
    const w = world();
    const [a, b, c] = fillThreads(w.ctx, w.open.id, w.aliceUser.id, 3) as [number, number, number];
    const at = w.ctx.now();
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO thread_features (thread_id, kind, user_id, started_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    );
    insert.run(a, "paid", w.aliceUser.id, at - 40 * DAY, at - 39 * DAY);
    insert.run(b, "paid", w.aliceUser.id, at - 5 * DAY, at - 4 * DAY);
    insert.run(c, "staff", actorUserId(w.mod)!, at - 90 * DAY, null);
    refreshRankings(w.ctx);
    expect(rows(w).map((row) => row.thread_id)).toEqual([b, c]);
  });

  test("the reads use their indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, featureSql.active, [0]);
    expectNoTableScan(w.ctx, featureSql.forThreads, ["[1,2]", 0]);
    expectNoTableScan(w.ctx, featureSql.purge, [0, 500]);
    const plan = (sql: string, params: unknown[]) =>
      w.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => row.detail)
        .join("\n");
    expect(plan(featureSql.active, [0])).toContain("thread_features_end");
    expect(plan(featureSql.forThreads, ["[1,2]", 0])).toContain("thread_features_thread");
  });
});
