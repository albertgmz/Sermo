import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { writeTx } from "../../db/tx";
import { UnauthenticatedError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { runDueJobs } from "../jobs";
import {
  notificationsListOp,
  notificationsMarkReadOp,
  notificationsMarkViewedOp,
  registerNotificationJobs,
} from "./index";

function fixture() {
  const ctx = createTestContext();
  registerNotificationJobs(ctx);
  const recipient = insertUser(ctx);
  const followers = [insertUser(ctx), insertUser(ctx), insertUser(ctx)];
  return { ctx, recipient, followers };
}
type Fixture = ReturnType<typeof fixture>;

async function follow(f: Fixture, index: number) {
  writeTx(f.ctx, () =>
    publishEvent(f.ctx, {
      type: "member.followed",
      targetType: "user",
      targetId: f.recipient.id,
      payload: { followerId: f.followers[index]!.id },
    }),
  );
  await dispatchEvents(f.ctx);
  await runDueJobs(f.ctx);
}
const badge = async (f: Fixture) =>
  (
    (await execute(f.ctx, getOperation("auth.counters"), userActor(f.recipient), {})) as {
      notifications: number;
    }
  ).notifications;
const list = (f: Fixture) =>
  execute(f.ctx, notificationsListOp, userActor(f.recipient), { limit: 10 });

describe("alerts viewed", () => {
  test("opening the alerts empties the badge but leaves every alert unread", async () => {
    const f = fixture();
    await follow(f, 0);
    await follow(f, 1);
    expect(await badge(f)).toBe(2);
    f.ctx.clock.advance(1000);
    await execute(f.ctx, notificationsMarkViewedOp, userActor(f.recipient), {});
    expect(await badge(f)).toBe(0);
    const page = await list(f);
    expect(page.unreadCount).toBe(2);
    expect(page.items.map((item) => item.read)).toEqual([false, false]);
  });

  test("an alert that arrives after opening counts again, and opening again clears it", async () => {
    const f = fixture();
    await follow(f, 0);
    f.ctx.clock.advance(1000);
    await execute(f.ctx, notificationsMarkViewedOp, userActor(f.recipient), {});
    f.ctx.clock.advance(1000);
    await follow(f, 1);
    expect(await badge(f)).toBe(1);
    f.ctx.clock.advance(1000);
    await execute(f.ctx, notificationsMarkViewedOp, userActor(f.recipient), {});
    expect(await badge(f)).toBe(0);
    expect((await list(f)).unreadCount).toBe(2);
  });

  test("reading one alert marks only that one read, and a viewed alert read leaves the badge alone", async () => {
    const f = fixture();
    await follow(f, 0);
    await follow(f, 1);
    f.ctx.clock.advance(1000);
    await execute(f.ctx, notificationsMarkViewedOp, userActor(f.recipient), {});
    f.ctx.clock.advance(1000);
    await follow(f, 2);
    const items = (await list(f)).items;
    const viewed = items.at(-1)!;
    await execute(f.ctx, notificationsMarkReadOp, userActor(f.recipient), { ids: [viewed.id] });
    const after = await list(f);
    expect(after.items.filter((item) => item.read).map((item) => item.id)).toEqual([viewed.id]);
    expect(after.unreadCount).toBe(2);
    expect(await badge(f)).toBe(1);
  });

  test("a guest cannot mark alerts viewed", async () => {
    const f = fixture();
    await expect(execute(f.ctx, notificationsMarkViewedOp, GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
