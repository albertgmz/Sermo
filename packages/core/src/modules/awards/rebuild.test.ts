import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, tokenActor, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { assertInvariants } from "../../economy/helpers";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { levelFor } from "../../shared/levels";
import { runDueJobs } from "../jobs/queue";
import { evaluateMember } from "./automatic";
import { registerAwardJobs } from "./index";
import { REBUILD_BUDGET, REBUILD_CHUNK, REBUILD_JOB } from "./rebuild";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const call = (name: string, input: unknown = {}, actor = admin) =>
    execute(ctx, getOperation(`awards.${name}`), actor, input);
  registerAwardJobs(ctx);
  const sql = (text: string, ...args: unknown[]) =>
    ctx.sqlite.prepare(text).all(...(args as never[]));
  const posts = (ids: number[], count: number) =>
    ctx.sqlite
      .prepare("UPDATE users SET post_count = ?2 WHERE id IN (SELECT value FROM json_each(?1))")
      .run(JSON.stringify(ids), count);
  const drain = async () => {
    while (await runDueJobs(ctx, { limit: 1 })) {}
  };
  const events = async () => {
    for (let i = 0; i < 50; i++) if ((await dispatchEvents(ctx)) === 0) return;
    throw new Error("Events did not terminate.");
  };
  const user = (id: number) =>
    ctx.sqlite.prepare("SELECT award_xp, award_count, credits FROM users WHERE id = ?1").get(id);
  const everything = () => ({
    users: sql("SELECT id, award_xp, award_count, credits FROM users ORDER BY id"),
    grants: sql("SELECT * FROM member_awards ORDER BY id"),
    totals: sql("SELECT * FROM member_award_totals ORDER BY id"),
    ledger: sql("SELECT * FROM credit_transactions ORDER BY id"),
  });
  return { ctx, adminUser, admin, call, sql, posts, drain, events, user, everything };
}
const postRule = { match: "all", conditions: [{ criterion: "post_count", value: 1 }] };

describe("rebuilding levels and awards", () => {
  test("XP and award counts are recomputed from the grants held, and the levels follow", async () => {
    const { ctx, call, posts, drain, events, user } = setup();
    const drifted = insertUser(ctx);
    const empty = insertUser(ctx);
    await call("create", { name: "Posts", tier: "bronze", xp: 5, credits: 0, rule: postRule });
    posts([drifted.id], 1);
    evaluateMember(ctx, drifted.id);
    await events();
    // The counters drifted: far too high for one member, nothing for the other who holds a grant.
    ctx.sqlite
      .prepare("UPDATE users SET award_xp = 950, award_count = 9 WHERE id = ?1")
      .run(drifted.id);
    ctx.sqlite
      .prepare("UPDATE users SET award_xp = 40, award_count = 3 WHERE id = ?1")
      .run(empty.id);
    expect(levelFor(950, 100).level).toBeGreaterThan(levelFor(5, 100).level);

    expect(await call("rebuild")).toEqual({ queued: true });
    await drain();
    await events();

    expect(user(drifted.id)).toEqual({ award_xp: 5, award_count: 1, credits: 0 });
    expect(user(empty.id)).toEqual({ award_xp: 0, award_count: 0, credits: 0 });
    const status = await call("rebuildStatus");
    expect(status).toMatchObject({ state: "done", progress: 1, granted: 0, takenBack: 0 });
    // Only the first member changed level (950 XP is level 4, 5 XP level 1); 40 XP and 0 are both level 1.
    expect(levelFor(40, 100).level).toBe(levelFor(0, 100).level);
    expect(status).toMatchObject({ levelsDown: 1, levelsUp: 0, xpCorrected: 2, xpChanged: 2 });
  });

  test("a met award is granted, an unmet automatic one taken back, a hand grant kept", async () => {
    const { ctx, adminUser, call, posts, drain, events, user, sql } = setup();
    const meets = insertUser(ctx);
    const loses = insertUser(ctx);
    const manual = insertUser(ctx);
    const award = await call("create", {
      name: "Posts",
      tier: "gold",
      xp: 5,
      credits: 10,
      rule: postRule,
    });
    const byHand = await call("create", {
      name: "By hand",
      tier: "bronze",
      xp: 7,
      credits: 3,
      rule: { match: "all", conditions: [{ criterion: "post_count", value: 50 }] },
    });
    posts([loses.id], 1);
    evaluateMember(ctx, loses.id);
    await call("grant", { userId: manual.id, awardId: byHand.id });
    await events();
    // `meets` met the rule with no pass to see it; `loses` no longer does.
    posts([meets.id], 1);
    posts([loses.id], 0);

    await call("rebuild");
    await drain();
    await events();

    expect(await call("rebuildStatus")).toMatchObject({
      state: "done",
      granted: 1,
      takenBack: 1,
      error: null,
    });
    expect(user(meets.id)).toEqual({ award_xp: 5, award_count: 1, credits: 10 });
    expect(user(loses.id)).toEqual({ award_xp: 0, award_count: 0, credits: 0 });
    expect(user(manual.id)).toEqual({ award_xp: 7, award_count: 1, credits: 3 });
    expect(
      sql("SELECT user_id, award_id FROM member_awards WHERE revoked_at IS NULL ORDER BY id"),
    ).toEqual([
      { user_id: manual.id, award_id: byHand.id },
      { user_id: meets.id, award_id: award.id },
    ]);
    // The trail, and no notice for anyone.
    expect(
      sql("SELECT actor_id, action FROM moderator_log ORDER BY id").map((row) => row as object),
    ).toEqual([
      { actor_id: adminUser.id, action: "awards.rebuild.start" },
      { actor_id: adminUser.id, action: "awards.rebuild.done" },
    ]);
    expect(sql("SELECT id FROM notifications")).toEqual([]);
  });

  test("a second run changes nothing", async () => {
    const { ctx, call, posts, drain, events, everything } = setup();
    const members = [insertUser(ctx).id, insertUser(ctx).id, insertUser(ctx).id];
    await call("create", { name: "Posts", tier: "bronze", xp: 5, credits: 2, rule: postRule });
    posts(members, 1);
    evaluateMember(ctx, members[0]!);
    posts([members[0]!], 0);
    ctx.sqlite.prepare("UPDATE users SET award_xp = 99 WHERE id = ?1").run(members[1]!);
    await call("rebuild");
    await drain();
    await events();
    const first = everything();
    expect(await call("rebuildStatus")).toMatchObject({ granted: 2, takenBack: 1 });

    expect(await call("rebuild")).toEqual({ queued: true });
    await drain();
    await events();

    expect(everything()).toEqual(first);
    expect(await call("rebuildStatus")).toMatchObject({
      state: "done",
      granted: 0,
      takenBack: 0,
      levelsUp: 0,
      levelsDown: 0,
    });
  });

  test("guests, members and keys are refused before the input is read", async () => {
    const { ctx, call, sql } = setup();
    const member = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const bad = { actorPassword: 12 };
    for (const actor of [member, moderator]) {
      await expect(call("rebuild", bad, actor)).rejects.toThrow(ForbiddenError);
      await expect(call("rebuildStatus", {}, actor)).rejects.toThrow(ForbiddenError);
    }
    await expect(call("rebuild", bad, GUEST)).rejects.toThrow(UnauthenticatedError);
    await expect(call("rebuildStatus", {}, GUEST)).rejects.toThrow(UnauthenticatedError);
    // A browser session confirms with its password; a key cannot start it at all.
    const admin = insertUser(ctx, { groupId: 4 });
    await expect(
      call("rebuild", {}, { ...userActor(admin), interactive: true } as never),
    ).rejects.toThrow(ValidationError);
    await expect(call("rebuild", {}, tokenActor(admin))).rejects.toThrow(ForbiddenError);
    expect(sql("SELECT id FROM jobs WHERE type = ?1", REBUILD_JOB)).toEqual([]);
    expect(sql("SELECT id FROM site_settings WHERE key LIKE 'awards.%'")).toEqual([]);
  });

  test("a run that stopped resumes from the member it stopped at, and one under way is not started twice", async () => {
    const { ctx, call, posts, drain, events, sql, user } = setup();
    await call("create", { name: "Posts", tier: "bronze", xp: 1, credits: 0, rule: postRule });
    const members: number[] = [];
    for (let i = 0; i < REBUILD_CHUNK * 2; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    await call("rebuild");
    expect(await call("rebuild")).toEqual({ queued: false });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    const partway = await call("rebuildStatus");
    expect(partway.state).toBe("running");
    expect(partway.progress).toBeGreaterThan(0);
    expect(partway.progress).toBeLessThan(1);
    const passed = (
      JSON.parse(
        (
          sql("SELECT payload FROM jobs WHERE unique_key = ?1", REBUILD_JOB)[0] as {
            payload: string;
          }
        ).payload,
      ) as { after: number }
    ).after;
    // Every grant after the first chunk fails.
    ctx.sqlite.exec(
      `CREATE TRIGGER refuse BEFORE INSERT ON member_awards WHEN NEW.user_id > ${passed} BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    );
    for (let attempt = 0; attempt < 6; attempt++) {
      ctx.clock.advance(2 * 3_600_000);
      await runDueJobs(ctx);
    }
    const failed = await call("rebuildStatus");
    expect(failed.state).toBe("failed");
    expect(failed.error).toContain("disk full");
    expect(failed.members).toBe(partway.members);
    expect(sql("SELECT action FROM moderator_log ORDER BY id")).toEqual([
      { action: "awards.rebuild.start" },
      { action: "awards.rebuild.failed" },
    ]);

    ctx.sqlite.exec("DROP TRIGGER refuse");
    expect(await call("rebuild")).toEqual({ queued: true });
    expect(
      JSON.parse(
        (
          sql("SELECT payload FROM jobs WHERE unique_key = ?1", REBUILD_JOB)[0] as {
            payload: string;
          }
        ).payload,
      ),
    ).toEqual({ after: passed });
    await drain();
    await events();

    const done = await call("rebuildStatus");
    expect(done).toMatchObject({ state: "done", granted: members.length, takenBack: 0 });
    expect(done.members).toBeGreaterThanOrEqual(members.length);
    for (const id of members) expect(user(id)).toMatchObject({ award_xp: 1, award_count: 1 });
  });

  test("every member corrected is counted, also when the budget ends a chunk early", async () => {
    const { ctx, call, posts, drain, events, user } = setup();
    const awards = 5;
    for (let i = 0; i < awards; i++)
      await call("create", {
        name: `Posts ${i}`,
        tier: "bronze",
        xp: 1,
        credits: 0,
        rule: postRule,
      });
    const members: number[] = [];
    const total = Math.floor(REBUILD_BUDGET / awards) + 11;
    for (let i = 0; i < total; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    // The budget ends the first page after REBUILD_BUDGET / awards members; these come after it.
    const late = members.slice(Math.floor(REBUILD_BUDGET / awards) + 2, REBUILD_CHUNK);
    expect(late.length).toBeGreaterThan(0);
    ctx.sqlite
      .prepare("UPDATE users SET award_xp = 5000 WHERE id IN (SELECT value FROM json_each(?1))")
      .run(JSON.stringify(late));

    await call("rebuild");
    await drain();
    await events();

    expect(await call("rebuildStatus")).toMatchObject({
      state: "done",
      xpCorrected: late.length,
      levelsDown: late.length,
      granted: total * awards,
    });
    for (const id of late) expect(user(id)).toMatchObject({ award_xp: awards });
  });

  test("the award counters are set to what the grants held add up to", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = insertUser(ctx);
    const award = await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    ctx.sqlite.prepare("UPDATE member_award_totals SET count = 4").run();
    ctx.sqlite.prepare("UPDATE awards SET grant_count = 77").run();

    await call("rebuild");
    await drain();
    await events();

    expect(sql("SELECT count FROM member_award_totals")).toEqual([{ count: 1 }]);
    expect(sql("SELECT grant_count FROM awards WHERE id = ?1", award.id)).toEqual([
      { grant_count: 1 },
    ]);
    assertInvariants(ctx);
  });

  test("an award taken back in a pass is not given again in the same pass", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = insertUser(ctx);
    // Held while the member has at least 10 credits; the other pays 10 credits once it is held.
    const needs = await call("create", {
      name: "Rich",
      tier: "bronze",
      xp: 1,
      credits: 0,
      rule: { match: "all", conditions: [{ criterion: "credits_at_least", value: 10 }] },
    });
    await call("create", { name: "Pays", tier: "bronze", xp: 1, credits: 10, rule: postRule });
    ctx.sqlite.prepare("UPDATE users SET credits = 10 WHERE id = ?1").run(member.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, created_at) VALUES (?1, 10, 10, 'adjustment', 0)",
      )
      .run(member.id);
    await call("grant", { userId: member.id, awardId: needs.id });
    ctx.sqlite.prepare("UPDATE member_award_totals SET auto_granted = 1, count = 1").run();
    ctx.sqlite.prepare("UPDATE member_awards SET granted_by = NULL").run();
    ctx.sqlite
      .prepare("UPDATE credit_transactions SET amount = 0, balance_after = 0 WHERE user_id = ?1")
      .run(member.id);
    ctx.sqlite.prepare("UPDATE users SET credits = 0 WHERE id = ?1").run(member.id);
    posts([member.id], 1);
    await call("rebuild");
    await drain();
    await events();
    const grants = sql(
      "SELECT award_id FROM member_awards WHERE user_id = ?1 AND award_id = ?2",
      member.id,
      needs.id,
    );
    // Taken back once, and not given back although the other award's credits would qualify it.
    expect(grants).toHaveLength(1);
    expect(
      sql(
        "SELECT revoked_at IS NOT NULL AS revoked FROM member_awards WHERE award_id = ?1",
        needs.id,
      ),
    ).toEqual([{ revoked: 1 }]);
  });

  test("a preview writes nothing and reports what a real run then does", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const gets = insertUser(ctx);
    const loses = insertUser(ctx);
    const drifted = insertUser(ctx);
    const award = await call("create", {
      name: "Posts",
      tier: "gold",
      xp: 150,
      credits: 10,
      rule: postRule,
    });
    posts([loses.id], 1);
    evaluateMember(ctx, loses.id);
    await events();
    // Spent already: taking the award back leaves the balance below zero.
    ctx.sqlite.prepare("UPDATE users SET credits = 0 WHERE id = ?1").run(loses.id);
    posts([loses.id], 0);
    posts([gets.id], 1);
    ctx.sqlite.prepare("UPDATE users SET award_xp = 950 WHERE id = ?1").run(drifted.id);
    const snapshot = () => ({
      users: sql("SELECT id, award_xp, award_count, credits FROM users ORDER BY id"),
      grants: sql("SELECT * FROM member_awards ORDER BY id"),
      totals: sql("SELECT * FROM member_award_totals ORDER BY id"),
      ledger: sql("SELECT * FROM credit_transactions ORDER BY id"),
      awards: sql("SELECT * FROM awards ORDER BY id"),
      events: sql("SELECT id FROM domain_events ORDER BY id"),
    });
    const before = snapshot();
    // A browser session needs no password to preview.
    const session = {
      ...userActor(
        ctx.sqlite
          .prepare("SELECT id, group_id AS groupId FROM users WHERE group_id = 4")
          .get() as never,
      ),
      interactive: true,
    };

    expect(await call("rebuild", { dryRun: true }, session as never)).toEqual({ queued: true });
    await drain();
    await events();

    expect(snapshot()).toEqual(before);
    const preview = await call("rebuildStatus");
    expect(preview).toMatchObject({
      state: "done",
      dryRun: true,
      granted: 1,
      takenBack: 1,
      creditsPaid: 10,
      creditsRemoved: 10,
      newlyNegative: 1,
      xpCorrected: 1,
      levelsDown: 2,
      levelsUp: 1,
      awards: [{ awardId: award.id, name: "Posts", granted: 1, takenBack: 1 }],
    });
    expect(
      sql("SELECT action, details FROM moderator_log ORDER BY id").map(
        (row) => (row as { action: string }).action,
      ),
    ).toEqual(["awards.rebuildPreview.start", "awards.rebuildPreview.done"]);

    await call("rebuild");
    await drain();
    await events();
    const real = await call("rebuildStatus");
    expect(real.dryRun).toBe(false);
    for (const key of [
      "members",
      "xpCorrected",
      "xpChanged",
      "levelsUp",
      "levelsDown",
      "granted",
      "takenBack",
      "creditsPaid",
      "creditsRemoved",
      "newlyNegative",
      "awards",
    ] as const)
      expect(real[key], key).toEqual(preview[key]);
    expect(snapshot()).not.toEqual(before);
  });

  test("a run is stopped before its next chunk, resumes when started again, and a preview waits for it", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = userActor(insertUser(ctx));
    await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    const members: number[] = [];
    for (let i = 0; i < REBUILD_CHUNK * 2; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    expect(await call("rebuildStop")).toEqual({ stopped: false });
    await expect(call("rebuildStop", {}, member)).rejects.toThrow(ForbiddenError);

    await call("rebuild");
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    expect(await call("rebuildStop")).toEqual({ stopped: true });
    await drain();

    const stopped = await call("rebuildStatus");
    expect(stopped.state).toBe("stopped");
    expect(stopped.members).toBeLessThan(members.length);
    expect(
      sql("SELECT id FROM jobs WHERE type = ?1 AND status IN ('pending','running')", REBUILD_JOB),
    ).toEqual([]);
    expect(
      sql("SELECT action FROM moderator_log ORDER BY id").map(
        (row) => (row as { action: string }).action,
      ),
    ).toEqual(["awards.rebuild.start", "awards.rebuild.stopped"]);
    await expect(call("rebuild", { dryRun: true })).rejects.toThrow(ConflictError);

    expect(await call("rebuild")).toEqual({ queued: true });
    await drain();
    await events();
    expect(await call("rebuildStatus")).toMatchObject({ state: "done", granted: members.length });
  });

  test("a held grant with no counter row is counted, so a non-stackable award is not given twice", async () => {
    const { ctx, call, posts, drain, events, sql, user } = setup();
    const member = insertUser(ctx);
    const award = await call("create", {
      name: "Posts",
      tier: "bronze",
      xp: 3,
      credits: 0,
      rule: postRule,
    });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    // As an import or hand-written SQL would leave it: the grant, no counter row.
    ctx.sqlite.prepare("DELETE FROM member_award_totals").run();

    await call("rebuild", { dryRun: true });
    await drain();
    expect(await call("rebuildStatus")).toMatchObject({
      dryRun: true,
      granted: 0,
      takenBack: 0,
      totalsCorrected: 1,
    });
    expect(sql("SELECT id FROM member_award_totals")).toEqual([]);

    await call("rebuild");
    await drain();
    await events();

    expect(await call("rebuildStatus")).toMatchObject({ granted: 0, totalsCorrected: 1 });
    expect(
      sql("SELECT count, auto_granted FROM member_award_totals WHERE award_id = ?1", award.id),
    ).toEqual([{ count: 1, auto_granted: 0 }]);
    expect(sql("SELECT id FROM member_awards WHERE revoked_at IS NULL")).toHaveLength(1);
    expect(user(member.id)).toMatchObject({ award_xp: 3, award_count: 1 });
    assertInvariants(ctx);
  });

  test("a stopped preview is logged as a preview and a real run after it starts from the first member", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    const members: number[] = [];
    for (let i = 0; i < REBUILD_CHUNK * 2; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    await call("rebuild", { dryRun: true });
    await runDueJobs(ctx, { limit: 1 });
    await call("rebuildStop");
    await drain();
    expect(await call("rebuildStatus")).toMatchObject({ state: "stopped", dryRun: true });
    expect(
      sql("SELECT action FROM moderator_log ORDER BY id").map(
        (row) => (row as { action: string }).action,
      ),
    ).toEqual(["awards.rebuildPreview.start", "awards.rebuildPreview.stopped"]);

    await call("rebuild");
    await drain();
    await events();
    expect(await call("rebuildStatus")).toMatchObject({
      state: "done",
      dryRun: false,
      granted: members.length,
    });
  });
});
