import { afterEach, describe, expect, test } from "bun:test";
import type { Ctx } from "./context";
import { writeTx } from "./db/tx";
import { consumeEvents, publishEvent } from "./events";
import { createTestContext } from "./testing";

describe("durable domain events", () => {
  const contexts: Ctx[] = [];
  afterEach(() => {
    for (const ctx of contexts) ctx.sqlite.close(true);
    contexts.length = 0;
  });

  test("rolls back with content and retries a failed subscriber", async () => {
    const ctx = createTestContext();
    contexts.push(ctx);
    expect(() =>
      writeTx(ctx, () => {
        publishEvent(ctx, { type: "content.created", targetType: "post", targetId: 1 });
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(await consumeEvents(ctx, "indexnow", () => {})).toBe(0);

    writeTx(ctx, () => {
      publishEvent(ctx, {
        type: "content.edited",
        targetType: "post",
        targetId: 2,
        payload: { public: true },
      });
    });
    await expect(
      consumeEvents(ctx, "indexnow", () => {
        throw new Error("retry");
      }),
    ).rejects.toThrow("retry");
    const seen: number[] = [];
    expect(
      await consumeEvents(ctx, "indexnow", (event) => {
        seen.push(event.targetId);
      }),
    ).toBe(1);
    expect(seen).toEqual([2]);
    expect(await consumeEvents(ctx, "indexnow", () => {})).toBe(0);
    expect(await consumeEvents(ctx, "file_cleanup", () => {})).toBe(1);
  });
});
