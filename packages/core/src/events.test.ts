import { afterEach, describe, expect, test } from "bun:test";
import type { Ctx } from "./context";
import { invalidate } from "./context";
import { writeTx } from "./db/tx";
import { consumeEvents, dispatchEvents, publishEvent, registerEventSubscriber } from "./events";
import { postsCreateOp, postsDeleteOp, postsRestoreOp, threadsCreateOp } from "./modules/forums";
import { execute } from "./operation";
import { createTestContext, insertNode, insertUser, userActor } from "./testing";

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

  test("forum writes publish committed events and update content time", async () => {
    const ctx = createTestContext();
    contexts.push(ctx);
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const created = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "First",
    });
    ctx.clock.advance(1000);
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: created.thread.id,
      body: "Second",
    });
    await execute(ctx, postsDeleteOp, author, { postId: reply.id });
    await execute(ctx, postsRestoreOp, moderator, { postId: reply.id });
    const events: string[] = [];
    expect(
      await consumeEvents(ctx, "test", (event) => {
        events.push(`${event.type}:${event.targetType}`);
      }),
    ).toBe(5);
    expect(events).toEqual([
      "content.created:thread",
      "content.created:post",
      "content.created:post",
      "content.deleted:post",
      "content.state_changed:post",
    ]);
    const updated = ctx.sqlite
      .prepare<{ content_updated_at: number }, [number]>(
        "SELECT content_updated_at FROM threads WHERE id = ?1",
      )
      .get(created.thread.id);
    expect(updated?.content_updated_at).toBe(ctx.now());
  });

  test("registered subscribers are fed in batches until caught up", async () => {
    const ctx = createTestContext();
    contexts.push(ctx);
    writeTx(ctx, () => {
      for (let i = 1; i <= 250; i++)
        publishEvent(ctx, { type: "reaction.added", targetType: "post", targetId: i });
    });
    const first: number[] = [];
    const second: number[] = [];
    registerEventSubscriber(ctx, "first", (event) => {
      first.push(event.targetId);
    });
    registerEventSubscriber(ctx, "second", (event) => {
      second.push(event.targetId);
    });
    expect(await dispatchEvents(ctx)).toBe(500);
    expect(first).toHaveLength(250);
    expect(second).toEqual(first);
    expect(await dispatchEvents(ctx)).toBe(0);
    // A zero budget hands nothing over; nothing is lost.
    writeTx(ctx, () => {
      publishEvent(ctx, { type: "member.followed", targetType: "user", targetId: 7 });
    });
    expect(await dispatchEvents(ctx, { budgetMs: 0 })).toBe(0);
    expect(await dispatchEvents(ctx)).toBe(2);
  });
});
