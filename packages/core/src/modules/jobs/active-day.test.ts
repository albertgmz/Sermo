import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../context";
import { createTestContext, insertUser } from "../../testing";
import { flushActivity } from "./queue";

const DAY = 86_400_000;

const activeDays = (ctx: Ctx, userId?: number) =>
  ctx.sqlite
    .prepare<{ target_type: string; target_id: number; payload: string }, []>(
      "SELECT target_type, target_id, payload FROM domain_events WHERE type = 'member.active_day' ORDER BY id",
    )
    .all()
    .filter((row) => userId === undefined || row.target_id === userId)
    .map((row) => ({ targetType: row.target_type, ...JSON.parse(row.payload) }));

function touch(ctx: Ctx & { clock: { now(): number } }, userId: number, at = ctx.clock.now()) {
  ctx.activity.set(userId, at);
  return flushActivity(ctx);
}

describe("member.active_day", () => {
  test("is published on a member's first activity of a UTC day, once per day", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const start = ctx.clock.now();
    const day = Math.floor(start / DAY);
    touch(ctx, user.id, start + 1_000);
    expect(activeDays(ctx)).toEqual([{ targetType: "user", day }]);
    expect(
      ctx.sqlite
        .prepare<{ target_id: number }, []>(
          "SELECT target_id FROM domain_events WHERE type = 'member.active_day'",
        )
        .get()!.target_id,
    ).toBe(user.id);

    // Later the same day: no second event.
    touch(ctx, user.id, start + 5_000);
    touch(ctx, user.id, start + DAY - 1 - (start % DAY));
    expect(activeDays(ctx)).toHaveLength(1);

    // The next day: one more, with the next day number.
    touch(ctx, user.id, start + DAY + 10);
    expect(activeDays(ctx).map((e) => e.day)).toEqual([day, day + 1]);
    // And again the same day: nothing.
    touch(ctx, user.id, start + DAY + 20);
    expect(activeDays(ctx)).toHaveLength(2);
  });

  test("follows the test clock", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const first = Math.floor(ctx.clock.now() / DAY);
    touch(ctx, user.id);
    ctx.clock.advance(DAY * 3);
    touch(ctx, user.id);
    expect(activeDays(ctx).map((e) => e.day)).toEqual([first, first + 3]);
  });

  test("the UTC midnight boundary starts a new day", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const midnight = Math.ceil(ctx.clock.now() / DAY) * DAY + DAY;
    touch(ctx, user.id, midnight - 1);
    touch(ctx, user.id, midnight);
    expect(activeDays(ctx).map((e) => e.day)).toEqual([
      Math.floor((midnight - 1) / DAY),
      Math.floor(midnight / DAY),
    ]);
  });

  test("activity older than the stored one publishes nothing and keeps last_activity_at", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const now = ctx.clock.now();
    touch(ctx, user.id, now + 2 * DAY);
    touch(ctx, user.id, now);
    expect(activeDays(ctx)).toHaveLength(1);
    expect(
      ctx.sqlite
        .prepare<{ at: number }, [number]>("SELECT last_activity_at AS at FROM users WHERE id = ?1")
        .get(user.id)!.at,
    ).toBe(now + 2 * DAY);
  });

  test("each member in a batch gets their own event, in one flush", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx), insertUser(ctx), insertUser(ctx)];
    const now = ctx.clock.now();
    touch(ctx, b.id, now);
    ctx.activity.set(a.id, now);
    ctx.activity.set(b.id, now + 100); // already active today
    ctx.activity.set(c.id, now + DAY);
    expect(flushActivity(ctx)).toBe(3);
    expect(activeDays(ctx, a.id)).toHaveLength(1);
    expect(activeDays(ctx, b.id)).toHaveLength(1);
    expect(activeDays(ctx, c.id)).toHaveLength(1);
    expect(activeDays(ctx, c.id)[0].day).toBe(Math.floor((now + DAY) / DAY));
  });

  test("a user id that does not exist publishes nothing and does not stop the others", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.activity.set(987_654, ctx.clock.now());
    ctx.activity.set(user.id, ctx.clock.now());
    expect(() => flushActivity(ctx)).not.toThrow();
    expect(activeDays(ctx, 987_654)).toEqual([]);
    expect(activeDays(ctx, user.id)).toHaveLength(1);
    expect(ctx.activity.size).toBe(0);
  });

  test("an empty buffer publishes nothing", () => {
    const ctx = createTestContext();
    insertUser(ctx);
    expect(flushActivity(ctx)).toBe(0);
    expect(activeDays(ctx)).toEqual([]);
  });

  test("a failed flush keeps the activity and publishes nothing", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const other = insertUser(ctx);
    // Make the second member's update fail so the whole transaction rolls back.
    ctx.sqlite.run(
      `CREATE TRIGGER fail_activity BEFORE UPDATE OF last_activity_at ON users WHEN new.id = ${other.id} BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    ctx.activity.set(user.id, ctx.clock.now());
    ctx.activity.set(other.id, ctx.clock.now());
    expect(() => flushActivity(ctx)).toThrow();
    expect(activeDays(ctx)).toEqual([]);
    expect(ctx.activity.get(user.id)).toBe(ctx.clock.now());
    ctx.sqlite.run("DROP TRIGGER fail_activity");
    expect(flushActivity(ctx)).toBe(2);
    expect(activeDays(ctx)).toHaveLength(2);
  });
});
