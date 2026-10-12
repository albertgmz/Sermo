import { expect, test } from "bun:test";
import { writeTx } from "../../db/tx";
import { dispatchEvents, publishEvent } from "../../events";
import { moveCredits } from "../../shared/credits";
import { createTestContext, insertUser } from "../../testing";
import { registerNotificationJobs } from "./delivery";

test("economy events queue no notification fan-out", async () => {
  const ctx = createTestContext();
  const user = insertUser(ctx);
  registerNotificationJobs(ctx);
  writeTx(ctx, () => {
    moveCredits(ctx, [{ userId: user.id, amount: 5, type: "adjustment" }]);
    publishEvent(ctx, {
      type: "member.active_day",
      targetType: "user",
      targetId: user.id,
      payload: { day: 1 },
    });
    publishEvent(ctx, {
      type: "member.followed",
      targetType: "user",
      targetId: user.id,
      payload: { followerId: user.id },
    });
  });
  await dispatchEvents(ctx);
  const jobs = ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type = 'notifications.fanout'",
    )
    .get()!.n;
  expect(jobs).toBe(1);
});
