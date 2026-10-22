import { afterEach, describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ForbiddenError, ValidationError } from "../../errors";
import { expectNoTableScan, insertNode } from "../../testing";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { registerJobHandler, runDueJobs } from "../jobs/queue";
import { runMinuteTasks } from "../jobs/scheduler";
import { type World, world } from "./fixtures.test";
import { registerStandingJobs as registerAllStandingJobs } from "./index";
import { redecideChunk, redecideSql } from "./redecide";
import { DECIDED_KEY, refreshStandings, registerStandingJobs, standingSql } from "./standings";

const DEC = (day: number) => Date.UTC(2025, 11, day, 12);
const JAN = (day: number) => Date.UTC(2026, 0, day, 12);
const FEB = (day: number) => Date.UTC(2026, 1, day, 12);

/** Content with explicit dates. Insert it in date order: the job relies on ids growing with time. */
function content(w: Pick<World, "ctx">) {
  const node = insertNode(w.ctx, {}).id;
  let sequence = 0;
  let reactionId = 0;
  const thread = (userId: number, at: number, state = "visible") =>
    w.ctx.sqlite
      .prepare<{ id: number }, [number, number, string, number]>(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 't', ?3, ?4, ?4, ?2) RETURNING id",
      )
      .get(node, userId, state, at)!.id;
  const post = (userId: number, threadId: number, at: number, state = "visible") => {
    sequence += 1;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(threadId, userId, sequence, state, at);
  };
  const reactions = (authorId: number, reactorId: number, count: number, at: number) => {
    for (let i = 0; i < count; i++) {
      reactionId += 1;
      w.ctx.sqlite
        .prepare(
          "INSERT INTO reactions (content_type, content_id, user_id, content_user_id, reaction_type_id, score, created_at) VALUES ('post', ?1, ?2, ?3, 1, 1, ?4)",
        )
        .run(reactionId, reactorId, authorId, at);
    }
  };
  const posts = (userId: number, count: number, at: number) => {
    const id = thread(userId, at);
    for (let i = 0; i < count; i++) post(userId, id, at);
  };
  const referral = (referrer: number, memberId: number, at: number) =>
    w.ctx.sqlite
      .prepare("UPDATE users SET referred_by = ?1, referred_at = ?2 WHERE id = ?3")
      .run(referrer, at, memberId);
  return { thread, post, posts, reactions, referral };
}

type Entry = {
  card: { id: number };
  posts: number;
  reactions: number;
  referrals: number;
  points: number;
};
const month = (w: World, which: string, extra: object = {}, actor: object = w.memberActor) =>
  w.call("standings.month", actor, { month: which, ...extra }) as Promise<{
    items: Entry[];
    nextCursor: string | null;
    year: number;
    month: number;
    scoring: { postPoints: number; reactionsPerPoint: number; referralPoints: number };
  }>;
const winners = (w: World, actor: object = w.memberActor) =>
  w.call("standings.winners", actor, {}) as Promise<{
    items: (Entry & { year: number; month: number })[];
  }>;
const rows = (w: World, key: number) =>
  w.ctx.sqlite
    .prepare<
      {
        user_id: number;
        posts: number;
        reactions: number;
        referrals: number;
        points_tenths: number;
      },
      [number]
    >(
      "SELECT user_id, posts, reactions, referrals, points_tenths FROM member_month_stats WHERE month = ?1 ORDER BY user_id",
    )
    .all(key);

/** December and January of a small forum; the clock sits in the middle of January. */
function scenario() {
  const w = world();
  const c = content(w);
  const [alice, bob, carol, dave, erin] = [1, 2, 3, 4, 5].map((i) => w.user({ username: `m${i}` }));
  w.ctx.clock.set(JAN(15));
  // December: alice 2 posts and a referral (22 points) beats bob's 3 posts and 10 reactions (4).
  c.posts(alice!.id, 2, DEC(3));
  c.posts(bob!.id, 3, DEC(4));
  c.reactions(bob!.id, carol!.id, 10, DEC(5));
  c.referral(alice!.id, dave!.id, DEC(10));
  // January: counted and not counted.
  c.posts(alice!.id, 1, JAN(2));
  const hidden = c.thread(alice!.id, JAN(2), "deleted");
  c.post(alice!.id, hidden, JAN(2));
  const visible = c.thread(alice!.id, JAN(2));
  c.post(alice!.id, visible, JAN(2), "deleted");
  c.post(alice!.id, visible, JAN(2), "moderated");
  c.posts(bob!.id, 2, JAN(3));
  c.reactions(bob!.id, carol!.id, 25, JAN(4));
  c.reactions(carol!.id, bob!.id, 5, JAN(5));
  c.referral(carol!.id, erin!.id, JAN(6));
  // February content is outside January.
  c.posts(dave!.id, 4, FEB(1));
  c.reactions(dave!.id, bob!.id, 30, FEB(1));
  return { w, c, alice: alice!, bob: bob!, carol: carol!, dave: dave!, erin: erin! };
}

describe("the standings job", () => {
  test("counts visible posts in visible threads, reactions received and referrals of the month", () => {
    const { w, alice, bob, carol } = scenario();
    refreshStandings(w.ctx);
    const jan = rows(w, 202601);
    expect(jan).toEqual([
      { user_id: alice.id, posts: 1, reactions: 0, referrals: 0, points_tenths: 10 },
      { user_id: bob.id, posts: 2, reactions: 25, referrals: 0, points_tenths: 45 },
      { user_id: carol.id, posts: 0, reactions: 5, referrals: 1, points_tenths: 205 },
    ]);
  });

  test("standings.month lists the month most points first and says which month it is", async () => {
    const { w, alice, bob, carol } = scenario();
    refreshStandings(w.ctx);
    const current = await month(w, "current");
    expect([current.year, current.month]).toEqual([2026, 1]);
    expect(current.items.map((entry) => entry.card.id)).toEqual([carol.id, bob.id, alice.id]);
    expect(current.items[0]).toMatchObject({ posts: 0, reactions: 5, referrals: 1, points: 20.5 });
    expect(current.nextCursor).toBeNull();
    const previous = await month(w, "previous");
    expect([previous.year, previous.month]).toEqual([2025, 12]);
    expect(previous.items.map((entry) => entry.card.id)).toEqual([alice.id, bob.id]);
    expect(previous.items[0]).toMatchObject({ posts: 2, referrals: 1, points: 22 });
    expect(previous.items[1]).toMatchObject({ posts: 3, reactions: 10, points: 4 });
  });

  test("a month named as YYYY-MM is that month's standing, and a month nothing is kept for lists nobody", async () => {
    const { w } = scenario();
    refreshStandings(w.ctx);
    expect(await month(w, "2026-01")).toEqual(await month(w, "current"));
    expect(await month(w, "2025-12")).toEqual(await month(w, "previous"));
    const older = await month(w, "2025-06");
    expect([older.year, older.month, older.items, older.nextCursor]).toEqual([2025, 6, [], null]);
  });

  test("a month after the current one, and a month that is not YYYY-MM, are refused", async () => {
    const { w } = scenario();
    await expect(month(w, "2026-02")).rejects.toBeInstanceOf(ValidationError);
    await expect(month(w, "2027-01")).rejects.toBeInstanceOf(ValidationError);
    // Before the first year: a heading would read 0050 as 1950.
    await expect(month(w, "0050-05")).rejects.toBeInstanceOf(ValidationError);
    await expect(month(w, "1999-12")).rejects.toBeInstanceOf(ValidationError);
    expect((await month(w, "2000-01")).year).toBe(2000);
    await expect(month(w, "2026-13")).rejects.toBeInstanceOf(ValidationError);
    await expect(month(w, "last")).rejects.toBeInstanceOf(ValidationError);
    await expect(month(w, "2026-1")).rejects.toBeInstanceOf(ValidationError);
  });

  test("the standing says how its points are counted, and follows the settings", async () => {
    const { w } = scenario();
    expect((await month(w, "current")).scoring).toEqual({
      postPoints: 1,
      reactionsPerPoint: 10,
      referralPoints: 20,
    });
    await w.call("settings.update", w.adminActor, {
      standingPostPoints: 3,
      standingReactionsPerPoint: 5,
      standingReferralPoints: 0,
    });
    expect((await month(w, "2025-12")).scoring).toEqual({
      postPoints: 3,
      reactionsPerPoint: 5,
      referralPoints: 0,
    });
  });

  test("the previous month's winner is decided once and never rewritten", async () => {
    const { w, c, alice, bob } = scenario();
    refreshStandings(w.ctx);
    const decided = w.ctx.sqlite
      .prepare<{ month: number; user_id: number; points_tenths: number }, []>(
        "SELECT month, user_id, points_tenths FROM month_winners",
      )
      .all();
    expect(decided).toEqual([{ month: 202512, user_id: alice.id, points_tenths: 220 }]);
    // Changing December afterwards (a late reaction) changes nothing.
    c.reactions(bob.id, alice.id, 500, DEC(30));
    w.ctx.clock.advance(60_000);
    refreshStandings(w.ctx);
    expect(
      w.ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners").all(),
    ).toEqual([{ user_id: alice.id }]);
    expect((await winners(w)).items).toMatchObject([{ year: 2025, month: 12, points: 22 }]);
  });

  test("the winner is the best placed member who is neither banned nor erased when it is written", async () => {
    const { w, alice, bob } = scenario();
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(alice.id);
    refreshStandings(w.ctx);
    expect(
      w.ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners").all(),
    ).toEqual([{ user_id: bob.id }]);
    expect((await winners(w)).items).toMatchObject([{ year: 2025, month: 12, points: 4 }]);
  });

  test("an erased leader and an expired ban do not stop the next member or the leader", () => {
    const { w, alice, bob } = scenario();
    // Bob's ban has ended, Alice is erased: Bob wins.
    w.ctx.sqlite.prepare("UPDATE users SET erased_at = 1 WHERE id = ?1").run(alice.id);
    w.ctx.sqlite.prepare("UPDATE users SET banned_until = 1 WHERE id = ?1").run(bob.id);
    refreshStandings(w.ctx);
    expect(
      w.ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners").all(),
    ).toEqual([{ user_id: bob.id }]);
  });

  test("a month rollover decides the finished month and starts the new one", async () => {
    const { w, alice, carol, dave } = scenario();
    refreshStandings(w.ctx);
    w.ctx.clock.set(FEB(2));
    refreshStandings(w.ctx);
    const list = (await winners(w)).items;
    expect(list.map((item) => [item.year, item.month, item.card.id])).toEqual([
      [2026, 1, carol.id],
      [2025, 12, alice.id],
    ]);
    const current = await month(w, "current");
    expect([current.year, current.month]).toEqual([2026, 2]);
    // January moved to "previous" and keeps its last standing.
    expect((await month(w, "previous")).items[0]!.card.id).toBe(carol.id);
    expect(current.items).toMatchObject([
      { card: { id: dave.id }, posts: 4, reactions: 30, points: 7 },
    ]);
  });

  test("a month in which nobody scored gets no winner and is not recomputed", async () => {
    const w = world();
    w.ctx.clock.set(Date.UTC(2026, 3, 10));
    refreshStandings(w.ctx);
    expect(w.ctx.sqlite.prepare("SELECT 1 FROM month_winners").get()).toBeNull();
    const marker = () =>
      w.ctx.sqlite
        .prepare<{ value: string }, [string]>("SELECT value FROM site_settings WHERE key = ?1")
        .get(DECIDED_KEY)?.value;
    expect(marker()).toBe("202603");
    // Content for March that shows up afterwards is not picked up: the month is settled.
    const c = content(w);
    const member = w.user();
    c.posts(member.id, 3, Date.UTC(2026, 2, 5));
    refreshStandings(w.ctx);
    expect(w.ctx.sqlite.prepare("SELECT 1 FROM month_winners").get()).toBeNull();
    expect(rows(w, 202603)).toEqual([]);
    expect((await winners(w)).items).toEqual([]);
    expect(marker()).toBe("202603");
  });

  describe("catching up", () => {
    const winnerMonths = (w: World) =>
      w.ctx.sqlite
        .prepare<{ month: number; user_id: number }, []>(
          "SELECT month, user_id FROM month_winners ORDER BY month",
        )
        .all();
    const marker = (w: World) =>
      w.ctx.sqlite
        .prepare<{ value: string }, [string]>("SELECT value FROM site_settings WHERE key = ?1")
        .get(DECIDED_KEY)?.value;

    test("a job that runs in January and next in March decides January and February", () => {
      const w = world();
      const c = content(w);
      const [alice, bob] = [w.user(), w.user()];
      w.ctx.clock.set(JAN(10));
      c.posts(alice.id, 2, Date.UTC(2025, 11, 5));
      refreshStandings(w.ctx);
      expect(winnerMonths(w)).toEqual([{ month: 202512, user_id: alice.id }]);
      c.posts(alice.id, 3, JAN(20));
      c.posts(bob.id, 4, FEB(10));
      w.ctx.clock.set(Date.UTC(2026, 2, 5));
      refreshStandings(w.ctx);
      expect(winnerMonths(w)).toEqual([
        { month: 202512, user_id: alice.id },
        { month: 202601, user_id: alice.id },
        { month: 202602, user_id: bob.id },
      ]);
      expect(marker(w)).toBe("202602");
    });

    test("a site with posts in three past months and no marker gets three winners at once", async () => {
      const w = world();
      const c = content(w);
      const [a, b, d] = [w.user(), w.user(), w.user()];
      // Older than twelve months: not decided.
      c.posts(d.id, 5, Date.UTC(2024, 10, 5));
      c.posts(a.id, 1, Date.UTC(2025, 9, 5));
      c.posts(b.id, 2, Date.UTC(2025, 10, 5));
      c.posts(a.id, 3, Date.UTC(2025, 11, 5));
      w.ctx.clock.set(JAN(15));
      refreshStandings(w.ctx);
      expect(winnerMonths(w)).toEqual([
        { month: 202510, user_id: a.id },
        { month: 202511, user_id: b.id },
        { month: 202512, user_id: a.id },
      ]);
      expect(marker(w)).toBe("202512");
      expect((await winners(w)).items.map((item) => [item.year, item.month])).toEqual([
        [2025, 12],
        [2025, 11],
        [2025, 10],
      ]);
    });

    test("a month nobody scored in is decided without a winner and not recomputed", () => {
      const w = world();
      const c = content(w);
      const alice = w.user();
      w.ctx.clock.set(JAN(10));
      refreshStandings(w.ctx);
      c.posts(alice.id, 1, JAN(20));
      w.ctx.clock.set(Date.UTC(2026, 2, 5));
      refreshStandings(w.ctx);
      expect(winnerMonths(w)).toEqual([{ month: 202601, user_id: alice.id }]);
      expect(marker(w)).toBe("202602");
      // February content that appears afterwards is not picked up.
      c.posts(alice.id, 9, FEB(20));
      w.ctx.clock.set(Date.UTC(2026, 2, 6));
      refreshStandings(w.ctx);
      expect(winnerMonths(w)).toEqual([{ month: 202601, user_id: alice.id }]);
      expect(rows(w, 202602)).toEqual([]);
    });

    test("the stats of months older than the previous one are removed, in batches", () => {
      const w = world();
      const insert = w.ctx.sqlite.prepare(
        "INSERT INTO member_month_stats (month, user_id, posts, reactions, referrals, points_tenths) VALUES (?1, ?2, 1, 0, 0, 10)",
      );
      const users = Array.from({ length: 450 }, () => w.user().id);
      for (const id of users) {
        insert.run(202401, id);
        insert.run(202402, id);
      }
      w.ctx.clock.set(JAN(15));
      refreshStandings(w.ctx);
      expect(rows(w, 202401)).toEqual([]);
      expect(rows(w, 202402)).toEqual([]);
    });

    test("the previous and the current month keep their stats", () => {
      const { w } = scenario();
      refreshStandings(w.ctx);
      w.ctx.clock.set(FEB(2));
      refreshStandings(w.ctx);
      expect(rows(w, 202512)).toEqual([]);
      expect(rows(w, 202601).length).toBeGreaterThan(0);
    });
  });

  test("ties go to more posts, then to the lower id", () => {
    const w = world();
    const c = content(w);
    const [many, few, same] = [w.user(), w.user(), w.user()];
    w.ctx.clock.set(Date.UTC(2026, 1, 3));
    // Two points each: two posts, or one post and ten reactions, or the same as `few`.
    c.posts(many.id, 2, JAN(3));
    c.posts(few.id, 1, JAN(3));
    c.reactions(few.id, many.id, 10, JAN(3));
    c.posts(same.id, 1, JAN(3));
    c.reactions(same.id, many.id, 10, JAN(4));
    refreshStandings(w.ctx);
    const winner = w.ctx.sqlite
      .prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners WHERE month = 202601")
      .get();
    expect(winner?.user_id).toBe(many.id);
    // Without `many`, the two with equal posts split on id.
    const second = world();
    const d = content(second);
    const [low, high] = [second.user(), second.user()];
    second.ctx.clock.set(Date.UTC(2026, 1, 3));
    d.posts(high.id, 1, JAN(3));
    d.posts(low.id, 1, JAN(3));
    refreshStandings(second.ctx);
    expect(
      second.ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners").get()
        ?.user_id,
    ).toBe(low.id);
  });

  test("a member who loses their points loses their row, and the month never empties", () => {
    const { w, alice } = scenario();
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).toContain(alice.id);
    w.ctx.sqlite.run(
      `UPDATE posts SET state = 'deleted' WHERE user_id = ${alice.id} AND created_at >= ${JAN(1)} AND created_at < ${FEB(1)}`,
    );
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).not.toContain(alice.id);
    expect(rows(w, 202601)).toHaveLength(2);
  });

  test("the points follow the site's standing settings", async () => {
    const { w, alice, bob } = scenario();
    await w.call("settings.update", w.adminActor, {
      standingPostPoints: 3,
      standingReactionsPerPoint: 5,
      standingReferralPoints: 0,
    });
    refreshStandings(w.ctx);
    const byUser = new Map(rows(w, 202601).map((row) => [row.user_id, row.points_tenths]));
    expect(byUser.get(alice.id)).toBe(30);
    expect(byUser.get(bob.id)).toBe(110);
    // Carol only has a referral (worth nothing now) and 5 reactions: 1 point.
    expect([...byUser.values()].sort((a, b) => a - b)).toEqual([10, 30, 110]);
  });

  test("banned members are left out of the standings and the winners at read time", async () => {
    const { w, alice, carol } = scenario();
    refreshStandings(w.ctx);
    w.ctx.clock.set(FEB(2));
    refreshStandings(w.ctx);
    w.set(carol.id, { banned_permanently: 1 });
    w.set(alice.id, { banned_until: FEB(2) + 86_400_000 });
    const previous = await month(w, "previous");
    expect(previous.items.map((entry) => entry.card.id)).not.toContain(carol.id);
    expect((await winners(w)).items).toEqual([]);
    w.set(alice.id, { banned_until: FEB(2) - 1 });
    expect((await winners(w)).items.map((item) => item.card.id)).toEqual([alice.id]);
  });

  test("pages through the standing with keyset pagination, ties included", async () => {
    const w = world();
    const c = content(w);
    const members = Array.from({ length: 8 }, () => w.user());
    w.ctx.clock.set(JAN(20));
    // posts: 3,3,3,2,2,1,1,1 (+ a reaction pair so points and posts disagree for one member)
    for (const [i, count] of [3, 3, 3, 2, 2, 1, 1, 1].entries())
      c.posts(members[i]!.id, count, JAN(2));
    c.reactions(members[7]!.id, members[0]!.id, 20, JAN(3));
    refreshStandings(w.ctx);
    const expected = rows(w, 202601)
      .sort(
        (a, b) => b.points_tenths - a.points_tenths || b.posts - a.posts || a.user_id - b.user_id,
      )
      .map((row) => row.user_id);
    for (const limit of [1, 3, 20]) {
      const seen: number[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await month(w, "current", { limit, cursor });
        seen.push(...result.items.map((entry) => entry.card.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(seen).toEqual(expected);
    }
    // Three posts and one post plus twenty reactions both make 3 points: more posts first.
    expect(expected.slice(0, 4)).toEqual([0, 1, 2, 7].map((i) => members[i]!.id));
  });

  test("requires profile.view, and open to guests otherwise", async () => {
    const w = world();
    expect((await month(w, "current", {}, GUEST)).items).toEqual([]);
    expect((await winners(w, GUEST)).items).toEqual([]);
    const group = (await w.call("groups.create", w.adminActor, { title: "Blind", rank: 1 })).id;
    await w.call("permissions.set", w.adminActor, {
      groupId: group,
      entries: [{ permission: "profile.view", value: "never" }],
    });
    const blind = w.user({ groupId: group });
    const actor = { kind: "user", userId: blind.id, groupId: group, sessionId: 0 };
    await expect(month(w, "current", {}, actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(winners(w, actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(month(w, "current", { cursor: "bad" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("runs as a job: registering twice queues one, and every tenth minute schedules it", async () => {
    const { w, alice } = scenario();
    registerStandingJobs(w.ctx);
    registerStandingJobs(w.ctx);
    const queued = () =>
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'standings.refresh' AND status = 'pending'",
        )
        .get()!.n;
    expect(queued()).toBe(1);
    expect(await runDueJobs(w.ctx)).toBeGreaterThanOrEqual(1);
    expect(rows(w, 202601).map((row) => row.user_id)).toContain(alice.id);
    expect(queued()).toBe(0);
    w.ctx.clock.set(Date.UTC(2026, 0, 15, 12, 5, 0));
    runMinuteTasks(w.ctx);
    expect(queued()).toBe(0);
    w.ctx.clock.set(Date.UTC(2026, 0, 15, 12, 10, 0));
    runMinuteTasks(w.ctx);
    runMinuteTasks(w.ctx);
    expect(queued()).toBe(1);
  });

  test("every statement reads an index or a bounded key range", () => {
    const { w } = scenario();
    const columns = standingSql.entryColumns;
    expectNoTableScan(w.ctx, standingSql.rowAtOrAfter("posts"), [10]);
    expectNoTableScan(w.ctx, standingSql.rowAtOrAfter("reactions"), [10]);
    expectNoTableScan(w.ctx, standingSql.lastId("posts"), []);
    expectNoTableScan(w.ctx, standingSql.lastId("reactions"), []);
    expectNoTableScan(w.ctx, standingSql.posts, [1, 100, 0, 10]);
    expectNoTableScan(w.ctx, standingSql.reactions, [1, 100, 0, 10]);
    expectNoTableScan(w.ctx, standingSql.visibleThreads, ["[1,2]"]);
    expectNoTableScan(w.ctx, standingSql.referrals, [0, 10, 0, 0, 100]);
    expectNoTableScan(w.ctx, standingSql.stored, [202601, 0, 10]);
    expectNoTableScan(w.ctx, standingSql.remove, [202601, "[1]"]);
    expectNoTableScan(w.ctx, standingSql.top, [202601]);
    expectNoTableScan(w.ctx, standingSql.winner, [202601]);
    expectNoTableScan(w.ctx, standingSql.prune, [202512, 200]);
    expectNoTableScan(w.ctx, standingSql.decided, []);
    expectNoTableScan(w.ctx, standingSql.sameScore(columns), [202601, 5, 2, 0, 21]);
    expectNoTableScan(w.ctx, standingSql.samePoints(columns), [202601, 5, 2, 21]);
    expectNoTableScan(w.ctx, standingSql.lowerPoints(columns), [202601, 5, 21]);
    expectNoTableScan(w.ctx, standingSql.winners, [202602, 12]);
  });
});

describe("members the site leaves out", () => {
  /** December: the moderator leads, then m1, then m2. January: the admin leads, then m1, then m2. */
  function staffScenario() {
    const w = world();
    const c = content(w);
    const [m1, m2] = [1, 2].map((i) => w.user({ username: `x${i}` }));
    w.ctx.clock.set(JAN(15));
    c.posts(w.moderator.id, 9, DEC(3));
    c.posts(m1!.id, 5, DEC(4));
    c.posts(m2!.id, 2, DEC(5));
    c.posts(w.admin.id, 8, JAN(2));
    c.posts(m1!.id, 4, JAN(3));
    c.posts(m2!.id, 1, JAN(4));
    return { w, m1: m1!, m2: m2! };
  }
  const ids = (list: { card: { id: number } }[]) => list.map((entry) => entry.card.id);

  test("staff are not stored for the month with the switch on, and are with it off", async () => {
    const { w, m1, m2 } = staffScenario();
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).toEqual([w.admin.id, m1.id, m2.id]);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).toEqual([m1.id, m2.id]);
  });

  test("members listed in the settings are not stored", async () => {
    const { w, m1, m2 } = staffScenario();
    await w.call("settings.update", w.adminActor, { standingExcludedUserIds: [m1.id] });
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).toEqual([w.admin.id, m2.id]);
  });

  test("standings.month leaves them out at once, without waiting for the job", async () => {
    const { w, m1, m2 } = staffScenario();
    refreshStandings(w.ctx);
    expect(ids((await month(w, "current")).items)).toEqual([w.admin.id, m1.id, m2.id]);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    expect(ids((await month(w, "current")).items)).toEqual([m1.id, m2.id]);
    await w.call("settings.update", w.adminActor, {
      standingExcludeStaff: false,
      standingExcludedUserIds: [m1.id],
    });
    expect(ids((await month(w, "current")).items)).toEqual([w.admin.id, m2.id]);
    // A page still fills from the rows behind the left-out ones.
    const first = await month(w, "current", { limit: 1 });
    expect(ids(first.items)).toEqual([w.admin.id]);
    const second = await month(w, "current", { limit: 1, cursor: first.nextCursor });
    expect(ids(second.items)).toEqual([m2.id]);
  });

  test("a member is staff by what they hold, not by their group", async () => {
    const { w, m1 } = staffScenario();
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    refreshStandings(w.ctx);
    expect(rows(w, 202601).map((row) => row.user_id)).toContain(m1.id);
    // Moving an ordinary member into the moderators' group makes them staff.
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(m1.id);
    expect(ids((await month(w, "current")).items)).not.toContain(m1.id);
  });

  test("the winner of a finished month is the best member who is not left out", async () => {
    const { w, m1 } = staffScenario();
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    refreshStandings(w.ctx);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
  });

  test("without exclusions the staff member wins, and a refresh alone does not rewrite a decided winner", async () => {
    const { w, m1 } = staffScenario();
    refreshStandings(w.ctx);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
    await w.call("settings.update", w.adminActor, {
      standingExcludeStaff: true,
      standingExcludedUserIds: [m1.id],
    });
    refreshStandings(w.ctx);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
  });
});

describe("past months follow the current rules", () => {
  afterEach(closeAll);

  /** Runs the queued jobs, the decision of past months among them, until none is left. */
  const settle = async (w: Pick<World, "ctx">) => {
    registerAllStandingJobs(w.ctx);
    await runDueJobs(w.ctx, { limit: 1000 });
  };
  const ids = (list: { card: { id: number } }[]) => list.map((entry) => entry.card.id);
  const stored = (w: Pick<World, "ctx">) =>
    w.ctx.sqlite
      .prepare<{ month: number; user_id: number; points_tenths: number }, []>(
        "SELECT month, user_id, points_tenths FROM month_winners ORDER BY month DESC",
      )
      .all();
  const jobs = (w: Pick<World, "ctx">, type = "standings.redecide") =>
    w.ctx.sqlite
      .prepare<{ n: number }, [string]>("SELECT count(*) AS n FROM jobs WHERE type = ?1")
      .get(type)!.n;
  const untouched = (w: Pick<World, "ctx">) =>
    w.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT (SELECT count(*) FROM notifications) + (SELECT count(*) FROM member_awards) + (SELECT count(*) FROM member_award_totals) AS n",
      )
      .get()!.n;

  /** December: the moderator leads, then m1, then m2. January: the admin leads, then m1, then m2. */
  function staff() {
    const w = world();
    const c = content(w);
    const [m1, m2] = [1, 2].map((i) => w.user({ username: `x${i}` }));
    w.ctx.clock.set(JAN(15));
    c.posts(w.moderator.id, 9, DEC(3));
    c.posts(m1!.id, 5, DEC(4));
    c.posts(m2!.id, 2, DEC(5));
    c.posts(w.admin.id, 8, JAN(2));
    c.posts(m1!.id, 4, JAN(3));
    c.posts(m2!.id, 1, JAN(4));
    return { w, m1: m1!, m2: m2! };
  }

  test("excluding the staff gives the month to the next member, and including them gives it back", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
    expect(stored(w)).toEqual([{ month: 202512, user_id: m1.id, points_tenths: 50 }]);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: false });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
  });

  test("listing a member, or changing a point weight, decides past months again", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    await w.call("settings.update", w.adminActor, { standingExcludedUserIds: [w.moderator.id] });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
    // Posts worth nothing and every ten reactions a point: nobody scored, so nobody wins.
    await w.call("settings.update", w.adminActor, {
      standingExcludedUserIds: [],
      standingPostPoints: 0,
    });
    await settle(w);
    expect(stored(w)).toEqual([]);
    // Two points for a post and a referral worth nothing: the order of posts decides again.
    await w.call("settings.update", w.adminActor, { standingPostPoints: 2 });
    await settle(w);
    expect(stored(w)).toEqual([{ month: 202512, user_id: w.moderator.id, points_tenths: 180 }]);
  });

  test("the points of the winner follow the weights", async () => {
    const { w, alice, bob } = scenario();
    refreshStandings(w.ctx);
    expect(stored(w)).toEqual([{ month: 202512, user_id: alice.id, points_tenths: 220 }]);
    await w.call("settings.update", w.adminActor, { standingReferralPoints: 0 });
    await settle(w);
    expect(stored(w)).toEqual([{ month: 202512, user_id: bob.id, points_tenths: 40 }]);
    expect((await winners(w)).items).toMatchObject([{ card: { id: bob.id }, points: 4 }]);
  });

  test("a rule on groups leaves out the members it matches, and an empty rule leaves out nobody", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    const group = w.group({ title: "Colaboradores", rank: 5 });
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(w.moderator.id, group);
    await w.call("settings.update", w.adminActor, {
      standingExcludeRule: {
        match: "all",
        conditions: [{ criterion: "in_group", ids: [group] }],
      },
    });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
    expect(ids((await month(w, "current")).items)).not.toContain(w.moderator.id);
    await w.call("settings.update", w.adminActor, {
      standingExcludeRule: { match: "all", conditions: [] },
    });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
  });

  test("the rule takes the cheap criteria only", async () => {
    const { w } = staff();
    await expect(
      w.call("settings.update", w.adminActor, {
        standingExcludeRule: {
          match: "all",
          conditions: [{ criterion: "warning_points_below", value: 3 }],
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("the winner is replaced without a notification, an award or a log of it for anyone", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    const before = untouched(w);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
    expect(untouched(w)).toBe(before);
    const mentioned = w.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM notifications WHERE user_id = ?1",
      )
      .get(w.moderator.id)!.n;
    expect(mentioned).toBe(0);
  });

  test("a ban replaces the winner, and lifting it gives the month back", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    const ban = await w.call("bans.create", w.adminActor, {
      userId: w.moderator.id,
      reason: "spam",
      expiresAt: null,
    });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([m1.id]);
    await w.call("bans.lift", w.adminActor, { banId: ban.id });
    await settle(w);
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
  });

  test("banning a member who won no month queues nothing", async () => {
    const { w, m2 } = staff();
    refreshStandings(w.ctx);
    await w.call("bans.create", w.adminActor, { userId: m2.id, reason: "spam", expiresAt: null });
    expect(jobs(w)).toBe(0);
    await w.call("bans.create", w.adminActor, {
      userId: w.moderator.id,
      reason: "spam",
      expiresAt: null,
    });
    expect(jobs(w)).toBe(1);
  });

  test("a ban that lands while a run is choosing a month is not lost", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    w.ctx.clock.set(FEB(2));
    refreshStandings(w.ctx);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    registerAllStandingJobs(w.ctx);
    let banned = false;
    // The run has chosen December (`m1`) and is still rewriting its standing when `m1` is banned.
    registerJobHandler(
      w.ctx,
      "standings.redecide",
      async (ctx, payload, job) => {
        const run = redecideChunk(ctx, (payload as { month: number }).month, job);
        while (!banned) {
          await new Promise((resolve) => setImmediate(resolve));
          if (rows(w, 202601).length > 0) {
            await w.call("bans.create", w.adminActor, {
              userId: m1.id,
              reason: "spam",
              expiresAt: null,
            });
            banned = true;
          }
        }
        await run;
      },
      { holdCheckpoints: false },
    );
    await runDueJobs(w.ctx, { limit: 1000 });
    expect(stored(w).map((row) => row.user_id)).toContain(m1.id);
    w.ctx.clock.advance(31_000);
    await runDueJobs(w.ctx, { limit: 1000 });
    expect(stored(w).map((row) => row.user_id)).not.toContain(m1.id);
  });

  test("a temporary ban hides a win while it lasts and does not take it away", async () => {
    const { w } = staff();
    refreshStandings(w.ctx);
    await w.call("bans.create", w.adminActor, {
      userId: w.moderator.id,
      reason: "spat",
      expiresAt: new Date(JAN(15) + 3 * 86_400_000).toISOString(),
    });
    expect(jobs(w)).toBe(0);
    expect((await winners(w)).items).toEqual([]);
    w.ctx.clock.set(JAN(20));
    expect(ids((await winners(w)).items)).toEqual([w.moderator.id]);
    // A run started for another reason keeps a temporarily banned leader as well.
    await w.call("settings.update", w.adminActor, { standingPostPoints: 2 });
    w.ctx.clock.set(JAN(16));
    await settle(w);
    expect(stored(w).map((row) => row.user_id)).toEqual([w.moderator.id]);
  });

  test("an erased member loses the months they won", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const [first, second] = [await w.register("First"), await w.register("Second")];
    const c = content(w);
    w.ctx.clock.set(JAN(15));
    c.posts(first.id, 6, DEC(3));
    c.posts(second.id, 3, DEC(4));
    refreshStandings(w.ctx);
    const leader = () =>
      w.ctx.sqlite.prepare<{ user_id: number }, []>("SELECT user_id FROM month_winners").get()
        ?.user_id;
    expect(leader()).toBe(first.id);
    await w.run("users.adminErase", founder.actor, {
      userId: first.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    await settle(w);
    expect(leader()).toBe(second.id);
  });

  test("months are decided newest first, one per run, and a run that stops resumes", async () => {
    const w = world();
    const c = content(w);
    const [a, b] = [w.user(), w.user()];
    w.ctx.clock.set(Date.UTC(2026, 3, 10));
    c.posts(a.id, 2, Date.UTC(2026, 0, 5));
    c.posts(b.id, 3, Date.UTC(2026, 1, 5));
    c.posts(a.id, 4, Date.UTC(2026, 2, 5));
    refreshStandings(w.ctx);
    expect(stored(w).map((row) => [row.month, row.user_id])).toEqual([
      [202603, a.id],
      [202602, b.id],
      [202601, a.id],
    ]);
    await w.call("settings.update", w.adminActor, { standingExcludedUserIds: [a.id, b.id] });
    registerAllStandingJobs(w.ctx);
    // One run: the newest month only.
    await runDueJobs(w.ctx, { limit: 1 });
    expect(stored(w).map((row) => row.month)).toEqual([202602, 202601]);
    expect(jobs(w)).toBe(2);
    await runDueJobs(w.ctx, { limit: 1000 });
    expect(stored(w)).toEqual([]);
    // The run ended: its key is free, and a new change starts another.
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM jobs WHERE unique_key = 'standings.redecide'").get(),
    ).toBeNull();
  });

  test("a change made while a run is under way queues a fresh run for when it ends", async () => {
    const w = world();
    const c = content(w);
    const [a, b] = [w.user(), w.user()];
    w.ctx.clock.set(Date.UTC(2026, 3, 10));
    c.posts(a.id, 5, Date.UTC(2026, 0, 5));
    c.posts(a.id, 5, Date.UTC(2026, 1, 5));
    c.posts(a.id, 5, Date.UTC(2026, 2, 5));
    c.posts(b.id, 1, Date.UTC(2026, 0, 6));
    c.posts(b.id, 1, Date.UTC(2026, 1, 6));
    c.posts(b.id, 1, Date.UTC(2026, 2, 6));
    refreshStandings(w.ctx);
    await w.call("settings.update", w.adminActor, { standingExcludedUserIds: [a.id] });
    registerAllStandingJobs(w.ctx);
    // March is decided without `a`; the run is under way when the second change comes.
    await runDueJobs(w.ctx, { limit: 1 });
    await w.call("settings.update", w.adminActor, { standingExcludedUserIds: [a.id, b.id] });
    expect(jobs(w, "standings.redecide.again")).toBe(1);
    await runDueJobs(w.ctx, { limit: 1000 });
    // March kept `b` for now: the run had passed it.
    expect(stored(w).map((row) => [row.month, row.user_id])).toEqual([[202603, b.id]]);
    w.ctx.clock.advance(31_000);
    await runDueJobs(w.ctx, { limit: 1000 });
    expect(stored(w)).toEqual([]);
  });

  test("a month whose posts are gone keeps the winner it has", async () => {
    const { w, m1 } = staff();
    refreshStandings(w.ctx);
    w.ctx.sqlite
      .prepare(
        "INSERT INTO month_winners (month, user_id, posts, reactions, referrals, points_tenths, decided_at) VALUES (201905, ?1, 7, 0, 0, 70, 0)",
      )
      .run(m1.id);
    await w.call("settings.update", w.adminActor, { standingExcludeStaff: true });
    await settle(w);
    expect(stored(w).map((row) => [row.month, row.user_id])).toEqual([
      [202512, m1.id],
      [201905, m1.id],
    ]);
  });

  test("the previous month's standing follows the weights as well", async () => {
    const { w, alice, bob } = scenario();
    refreshStandings(w.ctx);
    w.ctx.clock.set(FEB(2));
    refreshStandings(w.ctx);
    expect(rows(w, 202601).length).toBeGreaterThan(0);
    await w.call("settings.update", w.adminActor, { standingPostPoints: 10 });
    await settle(w);
    const byUser = new Map(rows(w, 202601).map((row) => [row.user_id, row.points_tenths]));
    expect(byUser.get(alice.id)).toBe(100);
    expect(byUser.get(bob.id)).toBe(20 * 10 + 25);
  });

  test("every statement of the decision reads an index or a bounded key range", () => {
    const { w } = scenario();
    expectNoTableScan(w.ctx, redecideSql.firstWinner, []);
    expectNoTableScan(w.ctx, redecideSql.eligible, ["[1,2]"]);
    expectNoTableScan(w.ctx, redecideSql.setWinner, [202512, 1, 1, 0, 0, 10, 0]);
    expectNoTableScan(w.ctx, redecideSql.clearWinner, [202512]);
  });
});
