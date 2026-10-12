import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";
import { jobsSql, keyedCountSql, probeSql, topSql } from "./home";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
type Run = (name: string, actor: object, input?: object) => Promise<any>;

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const start = ctx.now();
  // The staff are older than the window.
  ctx.clock.set(start - 50 * DAY);
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const moderator = insertUser(ctx, { groupId: 3, username: "Moderator" });
  const member = insertUser(ctx, { username: "Plain" });
  ctx.clock.set(start);
  const run: Run = (name, actor, input = {}) =>
    execute(ctx, getOperation(name), actor as never, input);
  // Rows reference members that fixtures do not create.
  ctx.sqlite.run("PRAGMA foreign_keys = OFF");
  return { ctx, run, start, founder, moderator, member };
}

type World = ReturnType<typeof world>;

let reportTarget = 1;

/** One row in each log, at `ago` before now. */
function logRows(w: World, ago: number) {
  const at = w.start - ago;
  w.ctx.sqlite
    .prepare(
      "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at) VALUES (?1, 'x.y', 'user', 1, '', '{}', ?2)",
    )
    .run(w.founder.id, at);
  const group = w.ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO report_groups (target_type, target_id, created_at, updated_at) VALUES ('user', ?1, ?2, ?2) RETURNING id",
    )
    .get(reportTarget++, at)!;
  w.ctx.sqlite
    .prepare(
      "INSERT INTO reports (group_id, reporter_id, reason, created_at) VALUES (?1, ?2, 'r', ?3)",
    )
    .run(group.id, w.member.id, at);
  w.ctx.sqlite
    .prepare(
      "INSERT INTO credit_transactions (user_id, amount, balance_after, type, created_at) VALUES (?1, 5, 5, 'adjustment', ?2)",
    )
    .run(w.member.id, at);
  // Not a manual adjustment: never counted.
  w.ctx.sqlite
    .prepare(
      "INSERT INTO credit_transactions (user_id, amount, balance_after, type, created_at) VALUES (?1, 5, 5, 'event', ?2)",
    )
    .run(w.member.id, at);
  w.ctx.sqlite
    .prepare(
      "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, price, created_at) VALUES (1, ?1, ?1, 10, ?2)",
    )
    .run(w.member.id, at);
  w.ctx.sqlite
    .prepare(
      "INSERT INTO promotion_log (user_id, promotion_id, action, created_at) VALUES (?1, 1, 'promote', ?2)",
    )
    .run(w.member.id, at);
  w.ctx.sqlite
    .prepare(
      "INSERT INTO promotion_log (user_id, promotion_id, action, created_at) VALUES (?1, 1, 'demote', ?2)",
    )
    .run(w.member.id, at);
}

describe("admin.activity", () => {
  test("counts the last day, week and thirty days of each kind", async () => {
    const w = world();
    for (const ago of [40 * DAY, 20 * DAY, 3 * DAY, 2 * HOUR]) {
      w.ctx.clock.set(w.start - ago);
      insertUser(w.ctx);
      logRows(w, ago);
    }
    w.ctx.clock.set(w.start);
    // An old row of every kind lies below the window on every table: bisecting must skip it.
    const result = await w.run("admin.activity", userActor(w.founder));
    const expected = { day: 1, week: 2, month: 3 };
    expect(result.items).toEqual([
      { kind: "moderation", ...expected },
      { kind: "reports", ...expected },
      { kind: "creditAdjustments", ...expected },
      { kind: "shopPurchases", ...expected },
      { kind: "promotions", ...expected },
      { kind: "registrations", ...expected },
    ]);
  });

  test("an empty window is zeros, and the window moves with the clock", async () => {
    const w = world();
    const first = await w.run("admin.activity", userActor(w.founder));
    for (const item of first.items) expect(item).toMatchObject({ day: 0, week: 0, month: 0 });
    logRows(w, 0);
    w.ctx.clock.advance(8 * DAY);
    const later = await w.run("admin.activity", userActor(w.founder));
    expect(later.items.find((item: { kind: string }) => item.kind === "moderation")).toMatchObject({
      day: 0,
      week: 0,
      month: 1,
    });
    w.ctx.clock.advance(23 * DAY);
    const gone = await w.run("admin.activity", userActor(w.founder));
    expect(gone.items.find((item: { kind: string }) => item.kind === "reports")).toMatchObject({
      month: 0,
    });
  });

  test("each actor sees only the kinds they may read", async () => {
    const w = world();
    logRows(w, HOUR);
    const kinds = async (actor: object) =>
      (await w.run("admin.activity", actor)).items.map((item: { kind: string }) => item.kind);
    expect(await kinds(userActor(w.founder))).toHaveLength(6);
    // Moderators read the report queue and the credit ledger.
    expect(await kinds(resolvedActor(w.ctx, w.moderator.id))).toEqual([
      "reports",
      "creditAdjustments",
    ]);
    // A member holding only one administration permission sees only that kind.
    await w.run("permissions.set", userActor(w.founder), {
      userId: w.member.id,
      entries: [{ permission: "admin.shop", value: "allow" }],
    });
    expect(await kinds(resolvedActor(w.ctx, w.member.id))).toEqual(["shopPurchases"]);
  });

  test("a forum moderator reads the report queue of their forum", async () => {
    const w = world();
    const forum = insertNode(w.ctx, { title: "Forum", type: "forum" });
    invalidate(w.ctx, "node_tree");
    const helper = insertUser(w.ctx);
    await w.run("permissions.set", userActor(w.founder), {
      userId: helper.id,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    await w.run("permissions.set", userActor(w.founder), {
      userId: helper.id,
      nodeId: forum.id,
      entries: [{ permission: "forum.manageReports", value: "allow" }],
    });
    const result = await w.run("admin.activity", resolvedActor(w.ctx, helper.id));
    expect(result.items.map((item: { kind: string }) => item.kind)).toEqual(["reports"]);
  });

  test("a guest, a member and a banned administrator get a not-found; a token acts as its member", async () => {
    const w = world();
    await expect(w.run("admin.activity", GUEST)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.run("admin.activity", userActor(w.member))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await w.run("admin.activity", tokenActor(w.founder))).items.length).toBe(6);
    const other = insertUser(w.ctx, { groupId: 4 });
    w.ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(other.id);
    await expect(w.run("admin.activity", resolvedActor(w.ctx, other.id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("every count reads an index range of its window", () => {
    const w = world();
    const params = [0, 0, 0] as const;
    expectNoTableScan(
      w.ctx,
      "SELECT coalesce(sum(created_at >= ?1), 0), coalesce(sum(created_at >= ?2), 0), count(*) FROM moderator_log WHERE created_at >= ?3",
      [...params],
    );
    expectNoTableScan(
      w.ctx,
      "SELECT count(*) FROM promotion_log WHERE created_at >= ?3 AND action = 'promote' AND ?1 = ?2",
      [...params],
    );
    expectNoTableScan(
      w.ctx,
      "SELECT count(*) FROM credit_transactions WHERE type = 'adjustment' AND created_at >= ?3 AND ?1 = ?2",
      [...params],
    );
    for (const table of ["reports", "shop_purchases", "users"]) {
      expectNoTableScan(w.ctx, keyedCountSql(table), [0, 0, 0, 1]);
      expectNoTableScan(w.ctx, probeSql(table), [1]);
      expectNoTableScan(w.ctx, topSql(table));
    }
  });
});

describe("admin.staffOnline", () => {
  test("lists the staff seen in the last fifteen minutes, newest first, from stored or buffered activity", async () => {
    const w = world();
    const helper = insertUser(w.ctx, { groupId: 3, username: "Helper" });
    const idle = insertUser(w.ctx, { groupId: 3, username: "Idle" });
    const setSeen = (id: number, ago: number | null) =>
      w.ctx.sqlite
        .prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2")
        .run(ago === null ? null : w.start - ago, id);
    setSeen(w.founder.id, 10 * 60_000);
    setSeen(w.moderator.id, 20 * 60_000);
    setSeen(helper.id, 2 * 60_000);
    setSeen(idle.id, 16 * 60_000);
    setSeen(w.member.id, 60_000);
    // The moderator was seen a minute ago by a request whose time is still buffered.
    w.ctx.activity.set(w.moderator.id, w.start - 60_000);
    const result = await w.run("admin.staffOnline", userActor(w.founder));
    expect(result.items.map((item: { card: { username: string } }) => item.card.username)).toEqual([
      "Moderator",
      "Helper",
      "Founder",
    ]);
    expect(result.items[0].lastActivityAt).toBe(new Date(w.start - 60_000).toISOString());
  });

  test("leaves banned staff out and caps the list", async () => {
    const w = world();
    w.ctx.activity.set(w.moderator.id, w.start);
    await w.run("bans.create", userActor(w.founder), {
      userId: w.moderator.id,
      reason: "Rule",
      expiresAt: null,
    });
    expect(
      (await w.run("admin.staffOnline", userActor(w.founder))).items.map(
        (item: { card: { id: number } }) => item.card.id,
      ),
    ).not.toContain(w.moderator.id);
    for (let i = 0; i < 60; i++) {
      const staff = insertUser(w.ctx, { groupId: 3 });
      w.ctx.activity.set(staff.id, w.start - i * 1000);
    }
    expect((await w.run("admin.staffOnline", userActor(w.founder))).items).toHaveLength(50);
  });

  test("whoever may open any part of the panel reads it; others get a not-found", async () => {
    const w = world();
    await w.run("admin.staffOnline", resolvedActor(w.ctx, w.moderator.id));
    await w.run("permissions.set", userActor(w.founder), {
      userId: w.member.id,
      entries: [{ permission: "admin.announcements", value: "allow" }],
    });
    await w.run("admin.staffOnline", resolvedActor(w.ctx, w.member.id));
    const stranger = insertUser(w.ctx);
    await expect(
      w.run("admin.staffOnline", resolvedActor(w.ctx, stranger.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.run("admin.staffOnline", GUEST)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("admin.jobs", () => {
  const job = (w: World, status: string, runAt: number, error: string | null = null) =>
    w.ctx.sqlite
      .prepare(
        "INSERT INTO jobs (type, status, run_at, last_error, created_at, updated_at) VALUES ('t.job', ?1, ?2, ?3, ?2, ?2)",
      )
      .run(status, runAt, error);

  test("counts by status, the oldest due pending job, and the newest failures first", async () => {
    const w = world();
    job(w, "pending", w.start - 5 * HOUR);
    job(w, "pending", w.start - HOUR);
    job(w, "pending", w.start + HOUR);
    job(w, "running", w.start - 1000);
    job(w, "done", w.start - 9 * HOUR);
    for (let i = 0; i < 25; i++) job(w, "failed", w.start - i * 1000, `boom ${i}`);
    const result = await w.run("admin.jobs", userActor(w.founder));
    expect(result).toMatchObject({
      pending: 3,
      running: 1,
      failed: 25,
      oldestPendingAt: new Date(w.start - 5 * HOUR).toISOString(),
    });
    expect(result.failures).toHaveLength(20);
    expect(result.failures[0]).toMatchObject({ type: "t.job", error: "boom 0" });
    expect(result.failures[19].error).toBe("boom 19");
  });

  test("an empty queue is zeros with no oldest job", async () => {
    const w = world();
    job(w, "pending", w.start + HOUR);
    expect(await w.run("admin.jobs", userActor(w.founder))).toEqual({
      pending: 1,
      running: 0,
      failed: 0,
      oldestPendingAt: null,
      failures: [],
    });
  });

  test("requires admin.settings", async () => {
    const w = world();
    await expect(w.run("admin.jobs", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(w.run("admin.jobs", userActor(w.member))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.run("admin.jobs", userActor(w.moderator))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await w.run("permissions.set", userActor(w.founder), {
      userId: w.member.id,
      entries: [{ permission: "admin.settings", value: "allow" }],
    });
    await w.run("admin.jobs", userActor(w.member));
    await w.run("admin.jobs", tokenActor(w.founder));
  });

  test("the statements read the status index", () => {
    const w = world();
    expectNoTableScan(w.ctx, jobsSql.counts);
    expectNoTableScan(w.ctx, jobsSql.oldestDue, [0]);
    expectNoTableScan(w.ctx, jobsSql.failures);
  });
});
