import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser } from "../../testing";
import { flushActivity } from "./queue";
import { runViewsTask } from "./scheduler";

describe("member activity", () => {
  test("buffered activity is written by the views task and never moves backwards", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const lastActivity = () =>
      ctx.sqlite
        .prepare<{ at: number | null }, [number]>(
          "SELECT last_activity_at AS at FROM users WHERE id = ?1",
        )
        .get(user.id)!.at;
    expect(flushActivity(ctx)).toBe(0);
    ctx.activity.set(user.id, 5_000);
    runViewsTask(ctx);
    expect(lastActivity()).toBe(5_000);
    expect(ctx.activity.size).toBe(0);
    ctx.activity.set(user.id, 4_000);
    expect(flushActivity(ctx)).toBe(1);
    expect(lastActivity()).toBe(5_000);
  });
});
