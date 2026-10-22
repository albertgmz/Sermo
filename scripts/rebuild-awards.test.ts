import { afterEach, describe, expect, test } from "bun:test";
import { type Ctx, closeContext, registerAwardJobs, startRebuild, writeTx } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { runDueJobs } from "../packages/core/src/modules/jobs/queue";
import { formatSummary, parseArgs, rebuildAwards, stopRun } from "./rebuild-awards-lib";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  registerAwardJobs(ctx);
  const lines: string[] = [];
  // The server's job worker, run one chunk at a time between looks.
  const deps = {
    sleep: async () => void (await runDueJobs(ctx, { limit: 1 })),
    log: (line: string) => void lines.push(line),
  };
  return { ctx, lines, deps };
}
const options = { dryRun: false, stop: false, pollMs: 1 };

describe("rebuild-awards", () => {
  test("starts the run, follows it to the end and summarises what it changed", async () => {
    const { ctx, lines, deps } = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    ctx.sqlite
      .prepare("UPDATE users SET award_xp = 40, award_count = 2 WHERE id = ?1")
      .run(member.id);

    const run = await rebuildAwards(ctx, options, deps);

    expect(run).toMatchObject({ state: "done", xpCorrected: 1, granted: 0, takenBack: 0 });
    expect(formatSummary(run)).toContain("Members whose XP or award counters were corrected: 1");
    expect(lines[0]).toBe("Run started.");
    expect(ctx.sqlite.prepare("SELECT actor_id FROM moderator_log ORDER BY id").get()).toEqual({
      actor_id: admin.id,
    });
    expect(ctx.sqlite.prepare("SELECT award_xp FROM users WHERE id = ?1").get(member.id)).toEqual({
      award_xp: 0,
    });
  });

  test("a member who may not manage awards cannot be the administrator", async () => {
    const { ctx, deps } = setup();
    const member = insertUser(ctx);
    insertUser(ctx, { groupId: 4 });
    await expect(rebuildAwards(ctx, { ...options, admin: member.id }, deps)).rejects.toThrow(
      `Member ${member.id} may not manage awards.`,
    );
    expect(ctx.sqlite.prepare("SELECT id FROM jobs").all()).toEqual([]);
  });

  test("a run under way is followed, not started twice", async () => {
    const { ctx, lines, deps } = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    writeTx(ctx, () => startRebuild(ctx, admin.id));

    const run = await rebuildAwards(ctx, options, deps);

    expect(run.state).toBe("done");
    expect(lines[0]).toBe("A run is already under way; following it.");
    expect(
      ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'awards.rebuild'").all(),
    ).toHaveLength(1);
  });

  test("a preview leaves the site as it was and says what a run would do; a stop ends the run under way", async () => {
    const { ctx, lines, deps } = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    ctx.sqlite
      .prepare("UPDATE users SET award_xp = 40, award_count = 2 WHERE id = ?1")
      .run(member.id);

    const run = await rebuildAwards(ctx, { ...options, dryRun: true }, deps);

    expect(run).toMatchObject({ state: "done", dryRun: true, xpCorrected: 1 });
    expect(formatSummary(run)).toContain("Members whose XP would change: 1");
    expect(ctx.sqlite.prepare("SELECT award_xp FROM users WHERE id = ?1").get(member.id)).toEqual({
      award_xp: 40,
    });
    expect(lines[0]).toBe("Run started.");

    expect(stopRun(ctx)).toBe(false);
    writeTx(ctx, () => startRebuild(ctx, admin.id));
    expect(stopRun(ctx)).toBe(true);
    await expect(rebuildAwards(ctx, options, deps)).rejects.toThrow("The run was stopped.");
  });

  test("a run of the other kind is not followed as if it were the one asked for", async () => {
    const { ctx, deps } = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET award_xp = 40 WHERE id = ?1").run(member.id);
    writeTx(ctx, () => startRebuild(ctx, admin.id, true));
    await expect(rebuildAwards(ctx, options, deps)).rejects.toThrow("A preview is under way");
    expect(ctx.sqlite.prepare("SELECT award_xp FROM users WHERE id = ?1").get(member.id)).toEqual({
      award_xp: 40,
    });
    // The preview goes on to its end, and then a real run is started.
    await rebuildAwards(ctx, { ...options, dryRun: true }, deps);
    const real = await rebuildAwards(ctx, options, deps);
    expect(real.dryRun).toBe(false);
    expect(ctx.sqlite.prepare("SELECT award_xp FROM users WHERE id = ?1").get(member.id)).toEqual({
      award_xp: 0,
    });

    writeTx(ctx, () => startRebuild(ctx, admin.id, false));
    await expect(rebuildAwards(ctx, { ...options, dryRun: true }, deps)).rejects.toThrow(
      "A real rebuild is under way",
    );
  });

  test("a preview's summary says what it leaves out", async () => {
    const { ctx, deps } = setup();
    insertUser(ctx, { groupId: 4 });
    const run = await rebuildAwards(ctx, { ...options, dryRun: true }, deps);
    expect(formatSummary(run)).toContain("credit rules");
    expect(formatSummary({ ...run, dryRun: false })).not.toContain("credit rules");
  });

  test("arguments", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, stop: false, pollMs: 2000 });
    expect(parseArgs(["--admin", "7", "--poll-ms", "50"])).toEqual({
      admin: 7,
      dryRun: false,
      stop: false,
      pollMs: 50,
    });
    expect(parseArgs(["--dry-run", "--stop"])).toMatchObject({ dryRun: true, stop: true });
    expect(() => parseArgs(["--admin", "x"])).toThrow("--admin takes a member id.");
    expect(() => parseArgs(["--nope"])).toThrow("Unknown option --nope.");
  });
});
