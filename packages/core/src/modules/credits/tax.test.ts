import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { moveCredits } from "../../shared/credits";
import { evaluate, loadFacts } from "../../shared/criteria";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "../../testing";
import { registerEmailJobs } from "../email";
import { LEASE_MS, runDueJobs } from "../jobs/queue";
import { runDailyTasks } from "../jobs/scheduler";
import {
  notificationChannels,
  notificationPushPhrase,
  notificationsSetPreferencesOp,
} from "../notifications";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { registerCreditJobs } from "./index";
import {
  inactiveMonths,
  monthStart,
  scheduleCreditTax,
  TAX_CHUNK,
  TAX_JOB,
  TAX_NOTICE_MS,
  taxCharge,
  taxSql,
} from "./tax";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

/** A UTC time, e.g. "2026-11-01" (midnight) or "2026-11-01T03:00". */
const at = (time: string) => Date.parse(time.length === 10 ? `${time}T00:00Z` : `${time}Z`);
const RATES = { fee: 50, minimum: 1000, step: 2 };

type Row = { user_id: number; amount: number; balance_after: number; source_id: number };
type Run = {
  id: number;
  kind: string;
  chargeOn: string;
  state: string;
  members: number;
  credits: number;
  top: { user: { id: number }; balance: number; months: number; charge: number }[];
};

function world(start = "2026-10-01T10:00") {
  const ctx = createTestContext();
  storeSiteSettings(ctx, { ...readSiteSettings(ctx), defaultLanguage: "en" });
  contexts.push(ctx);
  ctx.clock.set(at(start));
  registerCreditJobs(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const call = (name: string, input: unknown = {}, actor = admin) =>
    execute(ctx, getOperation(name), actor, input) as Promise<never>;
  const sql = <T>(text: string, ...params: (string | number | null)[]) =>
    ctx.sqlite.prepare<T, (string | number | null)[]>(text).all(...params);
  const give = (userId: number, amount: number) =>
    writeTx(ctx, () => moveCredits(ctx, [{ userId, amount, type: "adjustment" }]));
  /** A member with a balance, last seen at `seen` (null: never, so the sign-up counts). */
  function member(balance: number, seen: string | null, signedUp = "2020-01-01") {
    const id = insertUser(ctx).id;
    sql(
      "UPDATE users SET created_at = ?2, last_activity_at = ?3 WHERE id = ?1",
      id,
      at(signedUp),
      seen === null ? null : at(seen),
    );
    if (balance !== 0) give(id, balance);
    return id;
  }
  const balance = (userId: number) =>
    sql<{ credits: number }>("SELECT credits FROM users WHERE id = ?1", userId)[0]!.credits;
  const taxRows = () =>
    sql<Row>(
      "SELECT user_id, amount, balance_after, source_id FROM credit_transactions WHERE type = 'tax' ORDER BY user_id",
    );
  const turn = (on: boolean) => call("settings.update", { creditTaxEnabled: on });
  async function drain() {
    while ((await runDueJobs(ctx)) > 0);
  }
  /** The daily look at `time`, then every job it queued. */
  async function daily(time: string) {
    ctx.clock.set(at(time));
    scheduleCreditTax(ctx);
    await drain();
  }
  /** The daily looks of a charge (e.g. "2026-11"): its notice 7 days before, then the 1st. */
  async function cycle(month: string) {
    const notice = at(`${month}-01`) - TAX_NOTICE_MS + 3 * 3_600_000;
    await daily(new Date(notice).toISOString().slice(0, 16));
    await daily(`${month}-01T03:00`);
  }
  const status = () =>
    call("credits.taxStatus") as Promise<{
      enabled: boolean;
      nextChargeOn: string | null;
      preview: Run | null;
      lastCharge: Run | null;
    }>;
  const notices = () =>
    sql<{ user_id: number; content_id: number; data: string }>(
      "SELECT user_id, content_id, data FROM notifications WHERE type = 'credits.tax' ORDER BY user_id",
    );
  return {
    ctx,
    admin,
    call,
    sql,
    give,
    member,
    balance,
    taxRows,
    turn,
    drain,
    daily,
    cycle,
    status,
    notices,
  };
}

describe("the charge", () => {
  test("the formula: fee only, percentage only, both, the 50% cap, and balances of 0 or below", () => {
    // Fee only: above the minimum, no inactive month.
    expect(taxCharge(2000, 0, RATES)).toBe(50);
    // Percentage only: at or below the minimum, 3 months at 2%.
    expect(taxCharge(1000, 3, RATES)).toBe(60);
    expect(taxCharge(555, 3, RATES)).toBe(33);
    // Both.
    expect(taxCharge(2000, 2, RATES)).toBe(130);
    // The percentage stops at 50%: 25 months and 60 months take the same.
    expect(taxCharge(1000, 25, RATES)).toBe(500);
    expect(taxCharge(1000, 60, RATES)).toBe(500);
    expect(taxCharge(3001, 60, RATES)).toBe(50 + 1500);
    // Never more than the balance, never from a balance of 0 or below.
    expect(taxCharge(60, 60, { fee: 50, minimum: 0, step: 2 })).toBe(60);
    expect(taxCharge(0, 10, RATES)).toBe(0);
    expect(taxCharge(-40, 10, RATES)).toBe(0);
    // Rounded down, exactly, for the largest balances too.
    expect(taxCharge(99, 1, RATES)).toBe(1);
    expect(taxCharge(9_007_199_254_740_991, 60, RATES)).toBe(50 + 4_503_599_627_370_495);
  });

  test("inactive months are whole calendar months between the last visit and the charge", () => {
    const charge = at("2026-11-01");
    expect(inactiveMonths(at("2026-10-31T23:59:59.999"), charge)).toBe(0);
    expect(inactiveMonths(at("2026-10-01"), charge)).toBe(0);
    expect(inactiveMonths(at("2026-09-30T23:59:59.999"), charge)).toBe(1);
    expect(inactiveMonths(at("2026-11-01"), charge)).toBe(0);
    expect(inactiveMonths(at("2026-11-01T02:00"), charge)).toBe(0);
    expect(inactiveMonths(at("2024-11-15"), charge)).toBe(23);
    expect(inactiveMonths(at("2026-11-15"), at("2027-01-01"))).toBe(1);
  });

  test("the tax is off by default and charges nobody", async () => {
    const w = world();
    const settings = (await w.call("settings.get")) as Record<string, unknown>;
    expect(settings).toMatchObject({
      creditTaxEnabled: false,
      creditTaxFee: 50,
      creditTaxMinimum: 1000,
      creditTaxStep: 2,
    });
    const idle = w.member(5000, "2020-05-01");
    await w.daily("2026-11-01T03:00");
    await w.daily("2026-12-01T03:00");
    expect(w.taxRows()).toEqual([]);
    expect(w.balance(idle)).toBe(5000);
    expect(w.sql("SELECT id FROM credit_tax_runs")).toEqual([]);
    expect((await w.status()).nextChargeOn).toBeNull();
  });

  test("each member is charged once on the 1st, as the formula says; exempt accounts are not", async () => {
    const w = world();
    const feeOnly = w.member(2000, "2026-10-31T23:59:59");
    const percentOnly = w.member(1000, "2026-07-20");
    const both = w.member(2000, "2026-08-31T23:59:59");
    const capped = w.member(1000, "2019-03-01");
    const neverVisited = w.member(800, null, "2026-06-15");
    const zero = w.member(0, "2020-01-01");
    const negative = w.member(-40, "2020-01-01");
    const erased = w.member(3000, "2020-01-01");
    w.sql("UPDATE users SET erased_at = 1 WHERE id = ?1", erased);
    w.sql("UPDATE users SET credits = 3000 WHERE id = ?1", GUEST_ACCOUNT_ID);
    await w.turn(true);
    // The daily looks in October: the notice, no charge yet.
    await w.daily("2026-10-25T03:00");
    await w.daily("2026-10-31T03:00");
    expect(w.taxRows()).toEqual([]);
    // A visit on the 1st itself, before the charge, counts as a visit in the month of the charge.
    const visitedOnTheFirst = w.member(1000, "2026-11-01T01:00");
    await w.daily("2026-11-01T03:00");
    const rows = w.taxRows();
    expect(rows).toEqual([
      { user_id: feeOnly, amount: -50, balance_after: 1950, source_id: 202611 },
      // August, September and October without a visit: 6%.
      { user_id: percentOnly, amount: -60, balance_after: 940, source_id: 202611 },
      // September and October: 4% and the fee.
      { user_id: both, amount: -130, balance_after: 1870, source_id: 202611 },
      { user_id: capped, amount: -500, balance_after: 500, source_id: 202611 },
      // Signed up in June, never seen: July to October, 8%.
      { user_id: neverVisited, amount: -64, balance_after: 736, source_id: 202611 },
    ]);
    for (const id of [zero, negative, erased, visitedOnTheFirst]) {
      expect(rows.some((row) => row.user_id === id)).toBe(false);
    }
    expect(w.balance(zero)).toBe(0);
    expect(w.balance(negative)).toBe(-40);
    expect(w.balance(erased)).toBe(3000);
    expect(w.balance(GUEST_ACCOUNT_ID)).toBe(3000);
    // A system row: no actor, no stored text.
    expect(
      w.sql(
        "SELECT DISTINCT actor_id, reason, source_type FROM credit_transactions WHERE type = 'tax'",
      ),
    ).toEqual([{ actor_id: null, reason: "", source_type: "tax" }]);
    const charge = (await w.status()).lastCharge!;
    expect(charge).toMatchObject({
      kind: "charge",
      chargeOn: "2026-11-01",
      state: "done",
      members: 5,
      credits: 50 + 60 + 130 + 500 + 64,
    });
    expect(charge.top.map((entry) => [entry.user.id, entry.charge, entry.months])).toEqual([
      [capped, 500, 91],
      [both, 130, 2],
      [neverVisited, 64, 4],
      [percentOnly, 60, 3],
      [feeOnly, 50, 0],
    ]);
  });

  test("a second look, a second job and the scheduler all charge a member at most once a month", async () => {
    const w = world();
    const idle = w.member(1000, "2026-01-01");
    await w.turn(true);
    await w.cycle("2026-11");
    await w.daily("2026-11-02T03:00");
    await w.daily("2026-11-20T03:00");
    expect(w.taxRows()).toHaveLength(1);
    // The first chunk delivered again (a duplicate job) charges nothing more.
    const runId = (await w.status()).lastCharge!.id;
    w.sql(
      "INSERT INTO jobs (type, payload, run_at, created_at, updated_at) VALUES (?1, ?2, 0, 0, 0)",
      TAX_JOB,
      JSON.stringify({ runId, after: 0 }),
    );
    await w.drain();
    expect(w.taxRows()).toHaveLength(1);
    // The ledger itself refuses a second tax row for the member and month.
    expect(() =>
      writeTx(w.ctx, () =>
        moveCredits(w.ctx, [
          { userId: idle, amount: -1, type: "tax", source: { type: "tax", id: 202611 } },
        ]),
      ),
    ).toThrow(/UNIQUE/);
    // The next month charges again: October and November without a visit now.
    await w.cycle("2026-12");
    expect(w.taxRows().map((row) => [row.source_id, row.amount])).toEqual([
      [202611, -180],
      [202612, -164],
    ]);
  });

  test("a member who already has a tax row for the month is passed over", async () => {
    const w = world();
    const paid = w.member(1000, "2026-01-01");
    const other = w.member(1000, "2026-01-01");
    writeTx(w.ctx, () =>
      moveCredits(w.ctx, [
        { userId: paid, amount: -7, type: "tax", source: { type: "tax", id: 202611 } },
      ]),
    );
    await w.turn(true);
    await w.cycle("2026-11");
    expect(w.taxRows().map((row) => [row.user_id, row.amount])).toEqual([
      [paid, -7],
      [other, -180],
    ]);
    expect((await w.status()).lastCharge).toMatchObject({ state: "done", members: 1 });
  });

  test("the daily tasks start the charge", async () => {
    const w = world();
    w.member(1000, "2026-01-01");
    await w.turn(true);
    w.ctx.clock.set(at("2026-10-25T03:00"));
    runDailyTasks(w.ctx);
    await w.drain();
    w.ctx.clock.set(at("2026-11-01T03:00"));
    runDailyTasks(w.ctx);
    expect(w.sql("SELECT kind, month, state FROM credit_tax_runs ORDER BY id")).toEqual([
      { kind: "notice", month: 202611, state: "done" },
      { kind: "charge", month: 202611, state: "running" },
    ]);
  });

  test("a restart in the middle of a run charges every member once", async () => {
    const w = world();
    const members = Array.from({ length: TAX_CHUNK + 20 }, () => w.member(100, "2026-01-01"));
    await w.turn(true);
    await w.daily("2026-10-25T03:00");
    w.ctx.clock.set(at("2026-11-01T03:00"));
    scheduleCreditTax(w.ctx);
    await runDueJobs(w.ctx, { limit: 1 });
    expect(w.taxRows()).toHaveLength(TAX_CHUNK);
    // A stale copy of the first chunk changes nothing.
    const runId = (await w.status()).lastCharge!.id;
    w.sql(
      "INSERT INTO jobs (type, payload, run_at, created_at, updated_at) VALUES (?1, ?2, 0, 0, 0)",
      TAX_JOB,
      JSON.stringify({ runId, after: 0 }),
    );
    await runDueJobs(w.ctx, { limit: 1 });
    expect(w.taxRows()).toHaveLength(TAX_CHUNK);
    expect((await w.status()).lastCharge!.state).toBe("running");
    // The process stops while it holds the second chunk; another claims it after the lease.
    w.sql(
      "UPDATE jobs SET status = 'running', locked_until = ?1 WHERE type = ?2 AND status = 'pending'",
      w.ctx.now() + LEASE_MS,
      TAX_JOB,
    );
    w.ctx.clock.advance(LEASE_MS + 1);
    await w.drain();
    const rows = w.taxRows();
    expect(rows.map((row) => row.user_id)).toEqual(members);
    expect(rows.every((row) => row.amount === -18)).toBe(true);
    expect((await w.status()).lastCharge).toMatchObject({
      state: "done",
      members: members.length,
      credits: 18 * members.length,
    });
  });

  test("a run whose job kept failing goes on from where it stopped at the next daily look", async () => {
    const w = world();
    const members = Array.from({ length: TAX_CHUNK + 5 }, () => w.member(100, "2026-01-01"));
    await w.turn(true);
    await w.daily("2026-10-25T03:00");
    w.ctx.clock.set(at("2026-11-01T03:00"));
    scheduleCreditTax(w.ctx);
    await runDueJobs(w.ctx, { limit: 1 });
    w.sql("UPDATE credit_tax_runs SET state = 'failed' WHERE kind = 'charge'");
    w.sql("UPDATE jobs SET status = 'failed', unique_key = NULL WHERE status = 'pending'");
    await w.daily("2026-11-02T03:00");
    expect(w.taxRows().map((row) => row.user_id)).toEqual(members);
    expect((await w.status()).lastCharge!.state).toBe("done");
  });

  test("turning the tax on charges first on the next 1st whose notice window it covers", async () => {
    // Turned on exactly 7 days before the 1st: the notice goes that day, the charge on the 1st.
    const w = world("2026-10-25T00:00");
    const early = w.member(1000, "2026-01-01");
    await w.turn(true);
    expect((await w.status()).nextChargeOn).toBe("2026-11-01");
    await w.cycle("2026-11");
    expect(w.notices().map((row) => row.user_id)).toEqual([early]);
    expect(w.taxRows().map((row) => row.user_id)).toEqual([early]);

    // A moment later the notice window has begun: nothing in November, the first charge in December.
    const v = world("2026-10-25T00:00:00.001");
    const late = v.member(1000, "2026-01-01");
    await v.turn(true);
    expect((await v.status()).nextChargeOn).toBe("2026-12-01");
    await v.cycle("2026-11");
    await v.daily("2026-11-20T03:00");
    expect(v.notices()).toEqual([]);
    expect(v.taxRows()).toEqual([]);
    await v.cycle("2026-12");
    expect(v.notices().map((row) => [row.user_id, row.content_id])).toEqual([[late, 202612]]);
    expect(v.taxRows().map((row) => [row.user_id, row.source_id])).toEqual([[late, 202612]]);
  });

  test("turning the tax off and on again moves its first charge to the next 1st", async () => {
    const w = world("2026-10-10T10:00");
    w.member(1000, "2026-01-01");
    await w.turn(true);
    await w.daily("2026-10-25T03:00");
    expect(w.notices()).toHaveLength(1);
    // Off and on again inside the notice window: November is not charged, December is next.
    w.ctx.clock.set(at("2026-10-27T10:00"));
    await w.turn(false);
    await w.turn(true);
    await w.daily("2026-11-01T03:00");
    expect(w.taxRows()).toEqual([]);
    expect((await w.status()).nextChargeOn).toBe("2026-12-01");
  });

  test("a run stops when the tax is turned off while it is under way", async () => {
    const w = world();
    Array.from({ length: TAX_CHUNK + 5 }, () => w.member(100, "2026-01-01"));
    await w.turn(true);
    await w.daily("2026-10-25T03:00");
    w.ctx.clock.set(at("2026-11-01T03:00"));
    scheduleCreditTax(w.ctx);
    await runDueJobs(w.ctx, { limit: 1 });
    await w.turn(false);
    await w.drain();
    expect(w.taxRows()).toHaveLength(TAX_CHUNK);
    expect((await w.status()).lastCharge!.state).toBe("stopped");
    // Turned on again later, the month is not charged again.
    await w.turn(true);
    await w.daily("2026-11-02T03:00");
    expect(w.taxRows()).toHaveLength(TAX_CHUNK);
  });

  test("credits earned do not count the tax", async () => {
    const w = world();
    const id = insertUser(w.ctx).id;
    w.sql("UPDATE users SET last_activity_at = ?1 WHERE id = ?2", at("2026-01-01"), id);
    writeTx(w.ctx, () => moveCredits(w.ctx, [{ userId: id, amount: 10, type: "event" }]));
    await w.turn(true);
    await w.cycle("2026-11");
    expect(w.taxRows()).toHaveLength(1);
    const rule = {
      match: "all" as const,
      conditions: [{ criterion: "credits_earned", value: 10 }],
    };
    expect(evaluate(rule, loadFacts(w.ctx, [id], [rule]).get(id)!)).toBe(true);
  });
});

describe("the notice", () => {
  test("goes 7 days before the charge, once, to members whose charge is more than the fee", async () => {
    const w = world();
    const idle = w.member(2000, "2026-09-10");
    w.member(2000, "2026-10-01T00:00");
    w.member(4, "2026-01-01");
    const erased = w.member(2000, "2020-01-01");
    w.sql("UPDATE users SET erased_at = 1 WHERE id = ?1", erased);
    await w.turn(true);
    await w.daily("2026-10-24T03:00");
    expect(w.notices()).toEqual([]);
    await w.daily("2026-10-25T03:00");
    await w.daily("2026-10-26T03:00");
    await w.daily("2026-10-31T03:00");
    // October without a visit: 2% of 2000 and the fee. The member seen on 1 October owes the fee
    // alone, and 18% of 4 rounds down to 0: no notice for either.
    expect(w.notices()).toEqual([
      { user_id: idle, content_id: 202611, data: JSON.stringify({ amount: 90, fee: 50 }) },
    ]);
    expect(w.sql("SELECT kind, state, members, credits FROM credit_tax_runs")).toEqual([
      { kind: "notice", state: "done", members: 1, credits: 90 },
    ]);
    // A visit before the 1st avoids all but the fee.
    w.sql("UPDATE users SET last_activity_at = ?1 WHERE id = ?2", at("2026-10-28"), idle);
    await w.daily("2026-11-01T03:00");
    expect(w.taxRows().find((row) => row.user_id === idle)?.amount).toBe(-50);
  });

  test("is e-mailed by default with the amount, unless the member turned e-mail off; push names it too", async () => {
    const w = world();
    const capture = registerEmailJobs(
      w.ctx,
      { driver: "capture", sender: "forum@example.test" },
      notificationChannels,
    )!;
    const idle = w.member(2000, "2026-09-10");
    const quiet = w.member(2000, "2026-09-10");
    await execute(w.ctx, notificationsSetPreferencesOp, userActor({ id: quiet, groupId: 2 }), {
      items: [{ type: "credits.tax", email: false }],
    });
    // Before this release: one member unsubscribed from all e-mail, one turned some types off;
    // then the data step of the migration runs.
    const unsubscribed = w.member(2000, "2026-09-10");
    const partial = w.member(2000, "2026-09-10");
    const types = Object.keys(notificationChannels.defaults).filter(
      (type) => type !== "credits.tax" && !notificationChannels.securityTypes.has(type),
    );
    for (const type of [...types, "digest.weekly"])
      w.sql(
        "INSERT INTO notification_preferences (user_id, type, email) VALUES (?1, ?2, 0)",
        unsubscribed,
        type,
      );
    for (const type of types.slice(0, 5))
      w.sql(
        "INSERT INTO notification_preferences (user_id, type, email) VALUES (?1, ?2, 0)",
        partial,
        type,
      );
    const migration = readFileSync(
      new URL("../../../drizzle/0081_credit_tax.sql", import.meta.url),
      "utf8",
    );
    w.ctx.sqlite.run(migration.split("--> statement-breakpoint").at(-1)!);
    await w.turn(true);
    await w.daily("2026-10-25T03:00");
    expect(w.notices().map((row) => row.user_id)).toEqual([idle, quiet, unsubscribed, partial]);
    const emailOf = (id: number) =>
      w.sql<{ email: string }>("SELECT email FROM auth_user WHERE id = ?1", id)[0]!.email;
    expect(capture.messages.map((message) => message.to).sort()).toEqual(
      [emailOf(idle), emailOf(partial)].sort(),
    );
    expect(capture.messages[0]!.text).toContain("the credit tax takes 90 credits from you");
    const [notice] = w.sql<{ id: number }>("SELECT id FROM notifications WHERE user_id = ?1", idle);
    const item = {
      notificationId: notice!.id,
      userId: idle,
      type: "credits.tax",
      contentType: "credit_tax",
      contentId: 202611,
      threadId: null,
      actorId: null,
      data: { amount: 90, fee: 50 },
    };
    const render = notificationPushPhrase(w.ctx);
    expect(render(item, "en").bodyHtml).toContain("takes 90 credits from you");
    expect(render(item, "es").bodyHtml).toContain("te descontará 90 créditos en total");
  });

  test("is not sent for a charge the tax will not make", async () => {
    // Turned on inside the window of 1 November: no notice and no charge in November.
    const w = world("2026-10-25T10:00");
    const idle = w.member(2000, "2026-01-01");
    await w.daily("2026-10-26T03:00");
    expect(w.notices()).toEqual([]);
    await w.turn(true);
    await w.daily("2026-10-26T03:00");
    await w.daily("2026-11-01T03:00");
    expect(w.notices()).toEqual([]);
    expect(w.taxRows()).toEqual([]);
    await w.daily("2026-11-24T03:00");
    expect(w.notices().map((row) => [row.user_id, row.content_id])).toEqual([[idle, 202612]]);
    // Turned off: no charge, and no notice for the month after.
    await w.turn(false);
    await w.daily("2026-12-01T03:00");
    await w.daily("2026-12-25T03:00");
    expect(w.notices()).toHaveLength(1);
    expect(w.taxRows()).toEqual([]);
  });

  test("a notice stopped half way and the tax on again: nobody is charged that month", async () => {
    const w = world();
    const members = Array.from({ length: TAX_CHUNK + 5 }, () => w.member(100, "2026-01-01"));
    await w.turn(true);
    w.ctx.clock.set(at("2026-10-25T03:00"));
    scheduleCreditTax(w.ctx);
    await runDueJobs(w.ctx, { limit: 1 });
    w.ctx.clock.set(at("2026-10-26T10:00"));
    await w.turn(false);
    await w.drain();
    expect(w.notices()).toHaveLength(TAX_CHUNK);
    await w.turn(true);
    await w.daily("2026-10-27T03:00");
    await w.daily("2026-11-01T03:00");
    expect(w.taxRows()).toEqual([]);
    // December has its whole notice, then its charge, for every member.
    await w.cycle("2026-12");
    expect(w.taxRows().map((row) => row.user_id)).toEqual(members);
  });

  test("a failed notice goes on while its window is open; without a finished notice no charge", async () => {
    const w = world();
    const members = Array.from({ length: TAX_CHUNK + 5 }, () => w.member(100, "2026-01-01"));
    await w.turn(true);
    const failNotice = async (time: string) => {
      w.ctx.clock.set(at(time));
      scheduleCreditTax(w.ctx);
      await runDueJobs(w.ctx, { limit: 1 });
      w.sql(
        "UPDATE credit_tax_runs SET state = 'failed' WHERE kind = 'notice' AND state = 'running'",
      );
      w.sql("UPDATE jobs SET status = 'failed', unique_key = NULL WHERE status = 'pending'");
    };
    await failNotice("2026-10-25T03:00");
    await w.daily("2026-10-26T03:00");
    expect(w.notices().map((row) => row.user_id)).toEqual(members);
    await w.daily("2026-11-01T03:00");
    expect(w.taxRows()).toHaveLength(members.length);
    // December's notice fails on its last day: the window closes and December is not charged.
    await failNotice("2026-11-30T03:00");
    await w.daily("2026-12-01T03:00");
    await w.daily("2026-12-02T03:00");
    expect(w.taxRows().filter((row) => row.source_id === 202612)).toEqual([]);
    expect((await w.status()).nextChargeOn).toBe("2027-01-01");
  });

  test("a notice that finished less than 5 days before the 1st does not let that month be charged", async () => {
    // The server was down from the 25th: the notice goes at the first look after, at 00:00 on the 27th.
    const w = world();
    const idle = w.member(1000, "2026-01-01");
    await w.turn(true);
    await w.daily("2026-10-27T00:00");
    await w.daily("2026-11-01T03:00");
    expect(w.taxRows().map((row) => row.user_id)).toEqual([idle]);
    // A moment later is too late: the members had less than 5 days.
    const v = world();
    v.member(1000, "2026-01-01");
    await v.turn(true);
    await v.daily("2026-10-27T00:00:00.001");
    expect(v.notices()).toHaveLength(1);
    await v.daily("2026-11-01T03:00");
    expect(v.taxRows()).toEqual([]);
    expect((await v.status()).nextChargeOn).toBe("2026-12-01");
  });

  test("the notice and the charge across the year and in February", async () => {
    const w = world();
    const idle = w.member(1000, "2026-11-15");
    await w.turn(true);
    // 1 January: December without a visit.
    await w.daily("2026-12-24T03:00");
    expect(w.notices()).toEqual([]);
    await w.cycle("2027-01");
    expect(w.notices().map((row) => [row.user_id, row.content_id])).toEqual([[idle, 202701]]);
    expect(w.taxRows()).toEqual([
      { user_id: idle, amount: -20, balance_after: 980, source_id: 202701 },
    ]);
    await w.cycle("2027-02");
    // 1 March: the notice goes on 22 February, 7 days before.
    await w.daily("2027-02-21T03:00");
    expect(w.notices()).toHaveLength(2);
    await w.daily("2027-02-22T03:00");
    expect(w.notices().map((row) => row.content_id)).toEqual([202701, 202702, 202703]);
    await w.daily("2027-03-01T03:00");
    expect(w.taxRows().map((row) => [row.source_id, row.amount])).toEqual([
      [202701, -20],
      [202702, -39],
      [202703, -56],
    ]);
  });
});

describe("the preview", () => {
  test("counts the next charge with the settings as they are, charging nothing, even while off", async () => {
    const w = world("2026-10-10T10:00");
    const idle = w.member(1000, "2026-01-01");
    const active = w.member(2000, "2026-10-05");
    w.member(10, "2026-10-05");
    await w.call("settings.update", { creditTaxFee: 20 });
    const started = (await w.call("credits.taxPreview")) as Run;
    expect(started).toMatchObject({ kind: "preview", chargeOn: "2026-11-01", state: "running" });
    await expect(w.call("credits.taxPreview")).rejects.toBeInstanceOf(ConflictError);
    await w.drain();
    const preview = (await w.status()).preview!;
    // February to October without a visit: 18% of 1000 (not above the minimum); the fee of 20.
    expect(preview).toMatchObject({ state: "done", members: 2, credits: 180 + 20 });
    expect(
      preview.top.map((entry) => [entry.user.id, entry.balance, entry.months, entry.charge]),
    ).toEqual([
      [idle, 1000, 9, 180],
      [active, 2000, 0, 20],
    ]);
    expect(w.taxRows()).toEqual([]);
    expect(w.notices()).toEqual([]);
    // A new preview can start once the last one is done.
    expect(((await w.call("credits.taxPreview")) as Run).state).toBe("running");
  });

  test("the preview and the status need credits.adjust", async () => {
    const w = world();
    const member = userActor(insertUser(w.ctx));
    await expect(w.call("credits.taxPreview", {}, member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.call("credits.taxStatus", {}, member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.call("credits.taxPreview", {}, GUEST)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(w.call("credits.taxStatus", {}, GUEST)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await w.status()).toEqual({
      enabled: false,
      nextChargeOn: null,
      preview: null,
      lastCharge: null,
    });
  });
});

describe("query plans", () => {
  test("the member walk and the latest run read through indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, taxSql.members, [0, TAX_CHUNK]);
    expectNoTableScan(w.ctx, taxSql.latest, ["preview"]);
    expectNoTableScan(w.ctx, taxSql.ofMonth, ["charge", 202611]);
    expectNoTableScan(w.ctx, taxSql.charged, [1, 202611]);
    expect(monthStart(202611)).toBe(at("2026-11-01"));
  });
});
