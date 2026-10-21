import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { registerNotificationJobs } from "../notifications";
import { evaluateMember, sweepChunk } from "./automatic";
import { registerAwardJobs } from "./index";
import { REVOKE_BUDGET, REVOKE_CHUNK, REVOKE_JOB, revokeChunk } from "./revoke";

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
  return { ctx, adminUser, admin, call, sql, posts, drain, events };
}
const postRule = { match: "all", conditions: [{ criterion: "post_count", value: 1 }] };
const totals = (ctx: ReturnType<typeof createTestContext>, userId: number, awardId: number) =>
  ctx.sqlite
    .prepare(
      "SELECT count, auto_granted FROM member_award_totals WHERE user_id = ?1 AND award_id = ?2",
    )
    .get(userId, awardId);

describe("taking back automatic awards from members who no longer meet the rule", () => {
  test("a count reads the grants and writes none: it lists what would be taken back by award", async () => {
    const { ctx, call, posts, drain, sql } = setup();
    const keeps = insertUser(ctx);
    const loses = insertUser(ctx);
    const award = await call("create", {
      name: "Posts",
      tier: "bronze",
      xp: 5,
      credits: 10,
      rule: postRule,
    });
    posts([keeps.id, loses.id], 1);
    evaluateMember(ctx, keeps.id);
    evaluateMember(ctx, loses.id);
    posts([loses.id], 0);
    expect(await call("revokeStatus")).toMatchObject({ state: "idle", mode: null, grants: 0 });
    const before = sql("SELECT * FROM member_awards");
    const xp = sql("SELECT id, award_xp, credits FROM users ORDER BY id");

    expect(await call("revokeUnqualified", { apply: false })).toEqual({ queued: true });
    expect(await call("revokeStatus")).toMatchObject({ state: "running", mode: "count" });
    await drain();

    const status = await call("revokeStatus");
    expect(status).toMatchObject({
      state: "done",
      mode: "count",
      progress: 1,
      members: 2,
      affectedMembers: 1,
      grants: 1,
      xp: 5,
      credits: 10,
      awards: [{ awardId: award.id, name: "Posts", grants: 1 }],
      error: null,
    });
    expect(status.finishedAt).not.toBeNull();
    expect(sql("SELECT * FROM member_awards")).toEqual(before);
    expect(sql("SELECT id, award_xp, credits FROM users ORDER BY id")).toEqual(xp);
    expect(sql("SELECT id FROM moderator_log")).toEqual([]);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(2);
  });

  test("a run revokes the unqualified, keeps the qualified, never touches hand grants, and takes XP and credits back", async () => {
    const { ctx, adminUser, call, posts, drain, events, sql } = setup();
    const keeps = insertUser(ctx);
    const loses = insertUser(ctx);
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
      rule: { match: "all", conditions: [{ criterion: "post_count", value: 5 }] },
    });
    // Given by hand to a member who does not meet its rule: that is not judged.
    await call("grant", { userId: loses.id, awardId: byHand.id });
    posts([keeps.id, loses.id], 1);
    evaluateMember(ctx, keeps.id);
    evaluateMember(ctx, loses.id);
    await events();
    posts([loses.id], 0);
    expect(
      ctx.sqlite
        .prepare("SELECT award_xp, award_count, credits FROM users WHERE id = ?1")
        .get(loses.id),
    ).toEqual({ award_xp: 12, award_count: 2, credits: 13 });

    await call("revokeUnqualified", { apply: true });
    await drain();
    await events();

    expect(await call("revokeStatus")).toMatchObject({
      state: "done",
      mode: "revoke",
      members: 2,
      affectedMembers: 1,
      grants: 1,
      xp: 5,
      credits: 10,
    });
    const held = (id: number) => call("member", { userId: id });
    expect(
      (await held(keeps.id)).items.map((item: { award: { id: number } }) => item.award.id),
    ).toEqual([award.id]);
    expect(
      (await held(loses.id)).items.map((item: { award: { id: number } }) => item.award.id),
    ).toEqual([byHand.id]);
    expect(
      ctx.sqlite
        .prepare("SELECT award_xp, award_count, credits FROM users WHERE id = ?1")
        .get(loses.id),
    ).toEqual({ award_xp: 7, award_count: 1, credits: 3 });
    expect(
      ctx.sqlite
        .prepare("SELECT award_xp, award_count, credits FROM users WHERE id = ?1")
        .get(keeps.id),
    ).toEqual({ award_xp: 5, award_count: 1, credits: 10 });
    expect((await call("get", { awardId: award.id })).grantCount).toBe(1);
    expect((await call("get", { awardId: byHand.id })).grantCount).toBe(1);
    expect(
      sql(
        "SELECT user_id, award_id, granted_by, revoked_by, revoked_at IS NOT NULL AS revoked FROM member_awards ORDER BY id",
      ),
    ).toEqual([
      {
        user_id: loses.id,
        award_id: byHand.id,
        granted_by: adminUser.id,
        revoked_by: null,
        revoked: 0,
      },
      { user_id: keeps.id, award_id: award.id, granted_by: null, revoked_by: null, revoked: 0 },
      {
        user_id: loses.id,
        award_id: award.id,
        granted_by: null,
        revoked_by: adminUser.id,
        revoked: 1,
      },
    ]);
    expect(
      sql(
        "SELECT amount, type, actor_id FROM credit_transactions WHERE user_id = ?1 AND type = 'award_revoked'",
        loses.id,
      ),
    ).toEqual([{ amount: -10, type: "award_revoked", actor_id: adminUser.id }]);
    // The trail: a line when it starts and one with the totals when it ends.
    const log = sql("SELECT actor_id, action, details FROM moderator_log ORDER BY id") as {
      actor_id: number;
      action: string;
      details: string;
    }[];
    expect(log.map((row) => [row.actor_id, row.action])).toEqual([
      [adminUser.id, "awards.revokeUnqualified.start"],
      [adminUser.id, "awards.revokeUnqualified.done"],
    ]);
    expect(JSON.parse(log[1]!.details)).toMatchObject({
      mode: "revoke",
      members: 2,
      affected: 1,
      grants: 1,
      xp: 5,
      credits: 10,
      byAward: { [award.id]: 1 },
    });
  });

  test("no member is notified of a loss", async () => {
    const { ctx, call, posts, drain, events } = setup();
    registerNotificationJobs(ctx);
    const loses = insertUser(ctx);
    await call("create", { name: "Posts", tier: "bronze", xp: 5, credits: 4, rule: postRule });
    posts([loses.id], 1);
    evaluateMember(ctx, loses.id);
    await events();
    await drain();
    posts([loses.id], 0);
    await call("revokeUnqualified", { apply: true });
    await drain();
    await events();
    await drain();
    expect(
      ctx.sqlite
        .prepare("SELECT count(*) AS n FROM member_awards WHERE revoked_at IS NOT NULL")
        .get(),
    ).toEqual({ n: 1 });
    expect(ctx.sqlite.prepare("SELECT id FROM notifications").all()).toEqual([]);
  });

  test("a grant taken back is given again when the member comes to meet the rule, and one revoked by hand is not", async () => {
    const { ctx, call, posts, drain, events } = setup();
    const lost = insertUser(ctx);
    const byHand = insertUser(ctx);
    const award = await call("create", { name: "Posts", tier: "bronze", xp: 2, rule: postRule });
    posts([lost.id, byHand.id], 1);
    evaluateMember(ctx, lost.id);
    evaluateMember(ctx, byHand.id);
    const handGrant = (await call("memberGrants", { userId: byHand.id })).items[0];
    await call("revoke", { memberAwardId: handGrant.id });
    posts([lost.id], 0);
    await call("revokeUnqualified", { apply: true });
    await drain();
    await events();
    expect(totals(ctx, lost.id, award.id)).toEqual({ count: 0, auto_granted: 0 });
    expect(totals(ctx, byHand.id, award.id)).toEqual({ count: 0, auto_granted: 1 });
    // Both now meet the rule: the one the run took back from is given it again.
    posts([lost.id, byHand.id], 1);
    expect(evaluateMember(ctx, lost.id)).toBe(1);
    expect(evaluateMember(ctx, byHand.id)).toBe(0);
    expect(totals(ctx, lost.id, award.id)).toEqual({ count: 1, auto_granted: 1 });
  });

  test("an award that needs another is judged with what the member is left with", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const loses = insertUser(ctx);
    const first = await call("create", {
      name: "First",
      tier: "bronze",
      xp: 2,
      credits: 6,
      rule: postRule,
    });
    const second = await call("create", {
      name: "Second",
      tier: "silver",
      xp: 3,
      rule: { match: "all", conditions: [{ criterion: "holds_awards", ids: [first.id] }] },
    });
    const third = await call("create", {
      name: "Third",
      tier: "gold",
      xp: 4,
      rule: { match: "all", conditions: [{ criterion: "holds_awards", ids: [second.id] }] },
    });
    posts([loses.id], 1);
    evaluateMember(ctx, loses.id);
    await events();
    expect((await call("member", { userId: loses.id })).items).toHaveLength(3);
    posts([loses.id], 0);
    await call("revokeUnqualified", { apply: true });
    await drain();
    await events();
    expect((await call("member", { userId: loses.id })).items).toEqual([]);
    expect(await call("revokeStatus")).toMatchObject({
      grants: 3,
      xp: 9,
      credits: 6,
      affectedMembers: 1,
    });
    expect(sql("SELECT award_xp, award_count FROM users WHERE id = ?1", loses.id)).toEqual([
      { award_xp: 0, award_count: 0 },
    ]);
    for (const award of [first, second, third])
      expect((await call("get", { awardId: award.id })).grantCount).toBe(0);
  });

  test("an award judged before the one it needs is judged again once that one is taken back", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = insertUser(ctx);
    const base = await call("create", { name: "Base", tier: "bronze", rule: postRule });
    const needy = await call("create", {
      name: "Needy",
      tier: "gold",
      rule: { match: "all", conditions: [{ criterion: "holds_awards", ids: [base.id] }] },
    });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    expect((await call("member", { userId: member.id })).items).toHaveLength(2);
    // The base's grant now comes after the one that needs it, as when it was given again.
    ctx.sqlite.prepare("UPDATE member_awards SET id = 1000 WHERE award_id = ?1").run(base.id);
    posts([member.id], 0);
    await call("revokeUnqualified", { apply: true });
    await drain();
    await events();
    expect(
      sql("SELECT award_id FROM member_awards WHERE revoked_at IS NULL ORDER BY award_id"),
    ).toEqual([]);
    expect(await call("revokeStatus")).toMatchObject({ grants: 2 });
    expect((await call("get", { awardId: needy.id })).grantCount).toBe(0);
  });

  test("inactive awards, awards with no conditions and grants made by hand are left as they are", async () => {
    const { ctx, call, posts, drain, events } = setup();
    const member = insertUser(ctx);
    const inactive = await call("create", { name: "Off", tier: "bronze", xp: 1, rule: postRule });
    const emptied = await call("create", {
      name: "Emptied",
      tier: "bronze",
      xp: 1,
      rule: postRule,
    });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    await call("update", { awardId: inactive.id, isActive: false });
    await call("update", { awardId: emptied.id, rule: { match: "all", conditions: [] } });
    posts([member.id], 0);
    await call("revokeUnqualified", { apply: true });
    await drain();
    expect(await call("revokeStatus")).toMatchObject({ state: "done", grants: 0 });
    expect((await call("member", { userId: member.id })).items).toHaveLength(2);
  });

  test("chunks of members resume where they stopped and end with the same totals as one pass", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const awards = [];
    for (let i = 0; i < 6; i++)
      awards.push(
        await call("create", {
          name: `Posts ${i}`,
          tier: "bronze",
          xp: 1,
          credits: 1,
          rule: postRule,
        }),
      );
    const members: number[] = [];
    for (let i = 0; i < REVOKE_CHUNK * 2 + 9; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    for (const id of members) evaluateMember(ctx, id);
    await events();
    const losing = members.filter((_, i) => i % 4 !== 0);
    posts(losing, 0);
    // A page holds more grants than one transaction takes.
    expect(REVOKE_CHUNK * awards.length).toBeGreaterThan(REVOKE_BUDGET);

    await call("revokeUnqualified", { apply: true });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    const partway = await call("revokeStatus");
    expect(partway.state).toBe("running");
    expect(partway.progress).toBeGreaterThan(0);
    expect(partway.progress).toBeLessThan(1);
    // The chunk took the members whose grants stay within the budget, not the whole page.
    expect(partway.members).toBe(Math.floor(REVOKE_BUDGET / awards.length));
    expect(partway.members).toBeLessThan(REVOKE_CHUNK);
    expect(partway.grants).toBeLessThanOrEqual(REVOKE_BUDGET);
    expect(
      sql("SELECT payload FROM jobs WHERE unique_key = ?1", REVOKE_JOB).map(
        (row) => JSON.parse((row as { payload: string }).payload).after,
      ),
    ).toHaveLength(1);

    await drain();
    await events();
    const done = await call("revokeStatus");
    expect(done).toMatchObject({
      state: "done",
      progress: 1,
      members: members.length,
      affectedMembers: losing.length,
      grants: losing.length * awards.length,
      xp: losing.length * awards.length,
    });
    for (const award of awards)
      expect((await call("get", { awardId: award.id })).grantCount).toBe(
        members.length - losing.length,
      );
    expect(
      sql("SELECT id FROM jobs WHERE type = ?1 AND status IN ('pending', 'running')", REVOKE_JOB),
    ).toEqual([]);
    // Run again: nothing is left to take.
    await call("revokeUnqualified", { apply: false });
    await drain();
    expect(await call("revokeStatus")).toMatchObject({ mode: "count", grants: 0 });
  });

  test("a run that stopped on an error resumes where it stopped when started again", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    const members: number[] = [];
    for (let i = 0; i < REVOKE_CHUNK * 2; i++) members.push(insertUser(ctx).id);
    posts(members, 1);
    for (const id of members) evaluateMember(ctx, id);
    await events();
    posts(members, 0);
    await call("revokeUnqualified", { apply: true });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    const passed = members[REVOKE_CHUNK - 1]!;
    expect(await call("revokeStatus")).toMatchObject({
      members: REVOKE_CHUNK,
      grants: REVOKE_CHUNK,
    });
    // From the second chunk on, every revocation fails.
    ctx.sqlite.exec(
      `CREATE TRIGGER refuse BEFORE UPDATE ON member_awards WHEN NEW.revoked_at IS NOT NULL AND NEW.user_id > ${passed} BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    );
    for (let attempt = 0; attempt < 6; attempt++) {
      ctx.clock.advance(2 * 3_600_000);
      await runDueJobs(ctx);
    }
    const failed = await call("revokeStatus");
    expect(failed).toMatchObject({ state: "failed", members: REVOKE_CHUNK, grants: REVOKE_CHUNK });
    expect(failed.error).toContain("disk full");
    expect(
      sql("SELECT action FROM moderator_log ORDER BY id").map(
        (row) => (row as { action: string }).action,
      ),
    ).toEqual(["awards.revokeUnqualified.start", "awards.revokeUnqualified.failed"]);
    // A count is a different run and starts over; the same run starts from the member it stopped at.
    ctx.sqlite.exec("DROP TRIGGER refuse");
    expect(await call("revokeUnqualified", { apply: true })).toEqual({ queued: true });
    expect(await call("revokeStatus")).toMatchObject({
      state: "running",
      members: REVOKE_CHUNK,
      error: null,
    });
    expect(
      JSON.parse(
        (
          sql("SELECT payload FROM jobs WHERE unique_key = ?1", REVOKE_JOB)[0] as {
            payload: string;
          }
        ).payload,
      ),
    ).toEqual({ after: passed });
    await drain();
    await events();
    expect(await call("revokeStatus")).toMatchObject({
      state: "done",
      members: members.length,
      grants: members.length,
    });
    expect(sql("SELECT id FROM member_awards WHERE revoked_at IS NULL")).toEqual([]);
  });

  test("a run under way is not started twice, and a chunk that is not the run's does nothing", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = insertUser(ctx);
    await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    posts([member.id], 0);
    expect(await call("revokeUnqualified", { apply: true })).toEqual({ queued: true });
    expect(await call("revokeUnqualified", { apply: true })).toEqual({ queued: false });
    expect(await call("revokeUnqualified", { apply: false })).toEqual({ queued: false });
    expect(sql("SELECT id FROM jobs WHERE type = ?1", REVOKE_JOB)).toHaveLength(1);
    expect(await call("revokeStatus")).toMatchObject({ mode: "revoke" });
    // A claim for another position, and a claim that was handed to another run, change nothing.
    const job = sql("SELECT id FROM jobs WHERE type = ?1", REVOKE_JOB)[0] as { id: number };
    const lease = ctx.now() + 1000;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(lease + 500, job.id);
    await revokeChunk(ctx, 0, { id: job.id, lockedUntil: lease });
    expect(sql("SELECT id FROM member_awards WHERE revoked_at IS NOT NULL")).toEqual([]);
    ctx.sqlite.prepare("UPDATE jobs SET locked_until = ?1 WHERE id = ?2").run(lease, job.id);
    await revokeChunk(ctx, 7, { id: job.id, lockedUntil: lease });
    expect(sql("SELECT id FROM member_awards WHERE revoked_at IS NOT NULL")).toEqual([]);
    expect(sql("SELECT status FROM jobs WHERE id = ?1", job.id)).toEqual([{ status: "done" }]);
    expect(await call("revokeStatus")).toMatchObject({ state: "running", members: 0 });
    // A stopped record that is not running gives the next start a fresh run.
    expect(await call("revokeUnqualified", { apply: true })).toEqual({ queued: true });
    await drain();
    expect(await call("revokeStatus")).toMatchObject({ state: "done", grants: 1 });
  });

  test("the sweep, a new award and registering the jobs revoke nothing and start no run", async () => {
    const { ctx, call, posts, drain, events, sql } = setup();
    const member = insertUser(ctx);
    await call("create", { name: "Posts", tier: "bronze", xp: 1, rule: postRule });
    posts([member.id], 1);
    evaluateMember(ctx, member.id);
    await events();
    posts([member.id], 0);
    await call("run");
    enqueueJob(ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
    await sweepChunk(ctx);
    await call("create", { name: "More", tier: "bronze", rule: postRule });
    await drain();
    await events();
    expect(sql("SELECT id FROM member_awards WHERE revoked_at IS NOT NULL")).toEqual([]);
    expect(sql("SELECT id FROM jobs WHERE type = ?1", REVOKE_JOB)).toEqual([]);
    expect(await call("revokeStatus")).toMatchObject({ state: "idle" });
  });

  test("only award administrators start it or read it", async () => {
    const { ctx, call, sql } = setup();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const member = userActor(insertUser(ctx));
    for (const actor of [member, moderator]) {
      await expect(call("revokeUnqualified", { apply: true }, actor)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(call("revokeStatus", {}, actor)).rejects.toThrow(ForbiddenError);
    }
    await expect(call("revokeUnqualified", { apply: true }, GUEST)).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(call("revokeStatus", {}, GUEST)).rejects.toThrow(UnauthenticatedError);
    expect(sql("SELECT id FROM jobs WHERE type = ?1", REVOKE_JOB)).toEqual([]);
    expect(sql("SELECT id FROM site_settings WHERE key LIKE 'awards.%'")).toEqual([]);
  });
});
