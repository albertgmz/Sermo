import { afterEach, describe, expect, spyOn, test } from "bun:test";
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

describe("event dispatch isolation", () => {
  test("slow failures cannot exhaust another subscriber's turn", async () => {
    const ctx = createTestContext();
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const attempts: number[] = [];
    const healthy: number[] = [];
    registerEventSubscriber(ctx, "slow", async (event) => {
      attempts.push(event.targetId);
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error("slow failure");
    });
    registerEventSubscriber(ctx, "healthy", (event) => {
      healthy.push(event.targetId);
    });
    try {
      const handled: number[] = [];
      for (let id = 1; id <= 3; id++) {
        writeTx(ctx, () => {
          publishEvent(ctx, { type: "reaction.added", targetType: "post", targetId: id });
        });
        handled.push(await dispatchEvents(ctx, { budgetMs: 5 }));
        ctx.clock.advance(1000);
      }
      expect(handled).toEqual([1, 1, 1]);
      expect(healthy).toEqual([1, 2, 3]);
      expect(attempts).toEqual([1, 1, 1]);
      expect(
        ctx.sqlite.prepare("SELECT last_event_id FROM event_subscribers WHERE name = 'slow'").get(),
      ).toBeNull();
    } finally {
      errors.mockRestore();
      ctx.sqlite.close(true);
    }
  });

  test("a slow successful subscriber gives every later subscriber a turn", async () => {
    const ctx = createTestContext();
    writeTx(ctx, () => {
      publishEvent(ctx, { type: "reaction.added", targetType: "post", targetId: 1 });
    });
    const seen: string[] = [];
    for (const name of ["slow", "second", "third"]) {
      registerEventSubscriber(ctx, name, async () => {
        if (name === "slow") await new Promise((resolve) => setTimeout(resolve, 15));
        seen.push(name);
      });
    }
    try {
      expect(await dispatchEvents(ctx, { budgetMs: 5 })).toBe(3);
      expect(seen).toEqual(["slow", "second", "third"]);
    } finally {
      ctx.sqlite.close(true);
    }
  });

  test("failed subscribers back off independently and resume at the failed event", async () => {
    const ctx = createTestContext();
    const other = createTestContext();
    const errors = spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    let failing = true;
    for (const context of [ctx, other]) {
      writeTx(context, () => {
        publishEvent(context, { type: "reaction.added", targetType: "post", targetId: 1 });
      });
    }
    registerEventSubscriber(ctx, "same-name", () => {
      attempts++;
      if (failing) throw new Error("retry later");
    });
    registerEventSubscriber(other, "same-name", () => {});
    try {
      expect(await dispatchEvents(ctx)).toBe(0);
      for (let i = 0; i < 5; i++) expect(await dispatchEvents(ctx)).toBe(0);
      expect(attempts).toBe(1);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(await dispatchEvents(other)).toBe(1);
      ctx.clock.advance(999);
      expect(await dispatchEvents(ctx)).toBe(0);
      expect(attempts).toBe(1);
      failing = false;
      ctx.clock.advance(1);
      expect(await dispatchEvents(ctx)).toBe(1);
      expect(attempts).toBe(2);
      expect(await dispatchEvents(ctx)).toBe(0);
    } finally {
      errors.mockRestore();
      ctx.sqlite.close(true);
      other.sqlite.close(true);
    }
  });

  test("a throwing subscriber is logged and retried while the others proceed", async () => {
    const ctx = createTestContext();
    writeTx(ctx, () => {
      for (let i = 1; i <= 3; i++)
        publishEvent(ctx, { type: "reaction.added", targetType: "post", targetId: i });
    });
    let failing = true;
    const attempts: number[] = [];
    const healthy: number[] = [];
    registerEventSubscriber(ctx, "a-failing", (event) => {
      attempts.push(event.targetId);
      if (failing && event.targetId === 2) throw new Error("boom");
    });
    registerEventSubscriber(ctx, "b-healthy", (event) => {
      healthy.push(event.targetId);
    });
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      // a-failing handles event 1, then fails on 2; b-healthy still handles all three.
      expect(await dispatchEvents(ctx)).toBe(4);
    } finally {
      console.error = original;
    }
    expect(healthy).toEqual([1, 2, 3]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]![0])).toContain("a-failing");
    const cursor = ctx.sqlite
      .prepare<{ last_event_id: number }, [string]>(
        "SELECT last_event_id FROM event_subscribers WHERE name = ?1",
      )
      .get("a-failing");
    expect(cursor?.last_event_id).toBe(1);

    failing = false;
    expect(await dispatchEvents(ctx)).toBe(0);
    ctx.clock.advance(1000);
    expect(await dispatchEvents(ctx)).toBe(2);
    expect(attempts).toEqual([1, 2, 2, 3]);
    ctx.sqlite.close(true);
  });
});
