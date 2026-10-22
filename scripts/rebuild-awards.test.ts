import { afterEach, describe, expect, test } from "bun:test";
import { type Ctx, closeContext, registerAwardJobs, startRebuild, writeTx } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { runDueJobs } from "../packages/core/src/modules/jobs/queue";
import { formatSummary, parseArgs, rebuildAwards } from "./rebuild-awards-lib";

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
const options = { pollMs: 1 };

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
    expect(formatSummary(run)).toContain("Members whose XP or award count was corrected: 1");
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

  test("arguments", () => {
    expect(parseArgs([])).toEqual({ pollMs: 2000 });
    expect(parseArgs(["--admin", "7", "--poll-ms", "50"])).toEqual({ admin: 7, pollMs: 50 });
    expect(() => parseArgs(["--admin", "x"])).toThrow("--admin takes a member id.");
    expect(() => parseArgs(["--nope"])).toThrow("Unknown option --nope.");
  });
});
