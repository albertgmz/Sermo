import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, tokenActor, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { levelFor } from "../../shared/levels";
import { runDueJobs } from "../jobs/queue";
import { evaluateMember } from "./automatic";
import { registerAwardJobs } from "./index";
import { REBUILD_CHUNK, REBUILD_JOB } from "./rebuild";

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
    expect(status.levelsChanged).toBe(1);
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
      levelsChanged: 0,
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
});
