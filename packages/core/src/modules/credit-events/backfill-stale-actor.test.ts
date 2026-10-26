import { expect, setDefaultTimeout, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { runDueJobs } from "../jobs/queue";
import { registerCreditRuleJobs } from "./index";

// These tests are slow only when the full suite shares the machine (disk and CPU): the 5 s default is too short.
setDefaultTimeout(30_000);

const op = (name: string) => getOperation(name);
const RANGE = { from: "2020-01-01", until: "2026-06-01", cap: 100 };

/**
 * A founder, and a manager who gets `admin.creditRules` from a custom group, with a finished
 * preview. `here` is the manager's process (actor resolved, permission state warm); `elsewhere` is
 * another process, where the founder takes the manager out of the group.
 */
async function scenario() {
  const fixture = createTestContext();
  registerCreditRuleJobs(fixture);
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const group = (await execute(fixture, op("groups.create"), founder, {
    title: "Economists",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: group.id,
    entries: [{ permission: "admin.creditRules", value: "allow" }],
  });
  const manager = insertUser(fixture, { groupId: group.id });
  const preview = (await execute(fixture, op("creditRules.backfillPreview"), founder, RANGE)) as {
    id: number;
  };
  while (await runDueJobs(fixture, { limit: 1 })) {}
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, manager.id);
  expect(can(here, actor, "admin.creditRules")).toBe(true);
  await execute(elsewhere, op("users.setGroups"), founder, {
    userId: manager.id,
    primaryGroupId: 2,
  });
  return { database, here, elsewhere, actor, preview };
}

const runs = (ctx: Ctx) => ctx.sqlite.prepare("SELECT * FROM credit_backfills ORDER BY id").all();

for (const [name, input] of [
  ["creditRules.backfillPreview", () => RANGE],
  ["creditRules.backfillApply", (previewId: number) => ({ previewId })],
] as const)
  test(`${name} is refused to a member revoked meanwhile`, async () => {
    const s = await scenario();
    try {
      const before = runs(s.elsewhere);
      await expect(execute(s.here, op(name), s.actor, input(s.preview.id))).rejects.toThrow(
        ForbiddenError,
      );
      expect(runs(s.elsewhere)).toEqual(before);
    } finally {
      s.database.close();
    }
  });
