import { afterEach, describe, expect, test } from "bun:test";
import { CREDIT_TRIGGERS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { type DomainEvent, dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { moveCredits } from "../../shared/credits";
import { createTestContext, insertNode, insertUser, userActor } from "../../testing";
import { threadsCreateOp, threadsMergeOp } from "../forums";
import {
  creditRulesCreateOp,
  creditRulesDeleteOp,
  creditRulesUpdateOp,
  registerCreditRuleJobs,
} from ".";
import type { Trigger } from "./storage";
import { FLIP_BATCH_SIZE, handleCreditRuleEvent } from "./subscriber";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
});

function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const author = insertUser(ctx);
  const other = insertUser(ctx);
  const third = insertUser(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const forum = insertNode(ctx, {});
  const events: DomainEvent[] = [];
  const createRule = (trigger: Trigger, extra: Record<string, unknown> = {}) =>
    execute(ctx, creditRulesCreateOp, admin, { title: trigger, trigger, amount: 10, ...extra });
  const balance = (id = author.id) =>
    ctx.sqlite
      .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
      .get(id)!.credits;
  const ledger = () => ctx.sqlite.prepare("SELECT * FROM credit_transactions ORDER BY id").all();
  function event(
    type: DomainEvent["type"],
    targetType: string,
    targetId: number,
    payload: DomainEvent["payload"] = {},
  ) {
    // Reactions default to the seeded Like (id 1, score 1).
    if (type === "reaction.added") payload = { reactionTypeId: 1, ...payload };
    const id = writeTx(ctx, () => publishEvent(ctx, { type, targetType, targetId, payload }));
    const result = { id, type, targetType, targetId, payload, createdAt: ctx.now() };
    events.push(result);
    handleCreditRuleEvent(ctx, result);
    const before = ledger();
    handleCreditRuleEvent(ctx, result);
    expect(ledger()).toEqual(before);
    return result;
  }
  function thread(state = "visible", userId = author.id, nodeId = forum.id) {
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Credits', ?3, ?4, ?4, ?2)",
        )
        .run(nodeId, userId, state, ctx.now()).lastInsertRowid,
    );
  }
  function post(threadId: number, position = 1, state = "visible", userId = other.id) {
    const id = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .run(threadId, userId, position, state, ctx.now()).lastInsertRowid,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'Body', '<p>Body</p>')",
      )
      .run(id);
    if (position === 0)
      ctx.sqlite.prepare("UPDATE threads SET first_post_id = ?1 WHERE id = ?2").run(id, threadId);
    return id;
  }
  function profile(state = "visible", userId = other.id, ownerId = author.id) {
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, 'Body', '<p>Body</p>')",
        )
        .run(ownerId, userId, state, ctx.now()).lastInsertRowid,
    );
  }
  function comment(profileId = profile()) {
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Body', '<p>Body</p>')",
        )
        .run(profileId, author.id, ctx.now()).lastInsertRowid,
    );
  }
  function message() {
    const conversationId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('Credits', ?1, ?2, ?2, ?1)",
        )
        .run(author.id, ctx.now()).lastInsertRowid,
    );
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Body', '<p>Body</p>')",
        )
        .run(conversationId, author.id, ctx.now()).lastInsertRowid,
    );
  }
  function grant() {
    const awardId = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO awards (name, tier, created_at, updated_at) VALUES ('Credits', 'bronze', ?1, ?1)",
        )
        .run(ctx.now()).lastInsertRowid,
    );
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO member_awards (user_id, award_id, xp, credits, created_at) VALUES (?1, ?2, 0, 0, ?3)",
        )
        .run(author.id, awardId, ctx.now()).lastInsertRowid,
    );
  }
  const tables = {
    thread: "threads",
    post: "posts",
    profile_post: "profile_posts",
    profile_post_comment: "profile_post_comments",
    conversation_message: "conversation_messages",
  };
  function state(type: keyof typeof tables, id: number, next: string) {
    const previous = ctx.sqlite
      .prepare<{ state: string }, [number]>(`SELECT state FROM ${tables[type]} WHERE id = ?1`)
      .get(id)!;
    ctx.sqlite.prepare(`UPDATE ${tables[type]} SET state = ?1 WHERE id = ?2`).run(next, id);
    return event(next === "deleted" ? "content.deleted" : "content.state_changed", type, id, {
      previousState: previous.state,
      state: next,
    });
  }
  async function replay(advanceMs = 0) {
    const before = ledger();
    const balances = ctx.sqlite.prepare("SELECT id, credits FROM users ORDER BY id").all();
    for (const item of events.toReversed()) handleCreditRuleEvent(ctx, item);
    registerCreditRuleJobs(ctx);
    await dispatchEvents(ctx);
    ctx.clock.advance(advanceMs);
    ctx.sqlite
      .prepare("UPDATE event_subscribers SET last_event_id = 0 WHERE name = 'credit-rules'")
      .run();
    await dispatchEvents(ctx);
    expect(ledger()).toEqual(before);
    expect(ctx.sqlite.prepare("SELECT id, credits FROM users ORDER BY id").all()).toEqual(balances);
  }
  return {
    ctx,
    author,
    other,
    third,
    admin,
    forum,
    createRule,
    balance,
    ledger,
    event,
    thread,
    post,
    profile,
    comment,
    message,
    grant,
    state,
    replay,
  };
}

test("all triggers pay the right members and source keys; every event replays safely", async () => {
  const f = fixture();
  for (const trigger of CREDIT_TRIGGERS) await f.createRule(trigger);
  const threadId = f.thread();
  f.event("content.created", "thread", threadId);
  f.event("content.created", "post", f.post(threadId, 0, "visible", f.author.id));
  const postId = f.post(threadId);
  f.event("content.created", "post", postId);
  f.event("reaction.added", "post", postId, { userId: f.third.id, contentUserId: f.other.id });
  const profileId = f.profile();
  f.event("content.created", "profile_post", profileId);
  f.event("member.followed", "user", f.author.id, { followerId: f.third.id });
  f.event("member.registered", "user", f.author.id);
  f.event("member.active_day", "user", f.author.id, { day: 20454 });
  f.event("member.warned", "user", f.author.id, { warningId: 71 });
  const grantId = f.grant();
  f.event("award.granted", "user", f.author.id, { memberAwardId: grantId });
  expect(f.balance()).toBe(80);
  expect(f.balance(f.other.id)).toBe(30);
  expect(f.balance(f.third.id)).toBe(10);
  const rows = f.ctx.sqlite
    .prepare(
      "SELECT r.trigger, a.user_id, a.source_type, a.source_id, a.source_user_id FROM credit_rule_applications a JOIN credit_rules r ON r.id = a.rule_id ORDER BY r.trigger",
    )
    .all();
  expect(rows).toEqual(
    [
      ["award_received", f.author.id, "member_award", grantId, 0],
      ["daily_activity", f.author.id, "day", 20454, 0],
      ["followed", f.author.id, "user", f.third.id, 0],
      ["profile_post_created", f.other.id, "profile_post", profileId, 0],
      ["profile_post_received", f.author.id, "profile_post", profileId, f.other.id],
      ["reaction_given", f.third.id, "post", postId, 0],
      ["reaction_received", f.other.id, "post", postId, f.third.id],
      ["registered", f.author.id, "user", f.author.id, 0],
      ["reply_posted", f.other.id, "post", postId, 0],
      ["reply_received", f.author.id, "post", postId, f.other.id],
      ["thread_created", f.author.id, "thread", threadId, 0],
      ["warning_received", f.author.id, "warning", 71, 0],
    ].map(([trigger, user_id, source_type, source_id, source_user_id]) => ({
      trigger,
      user_id,
      source_type,
      source_id,
      source_user_id,
    })),
  );
  await f.replay(7_200_000);
});

test("self replies only pay reply_posted; self profile posts and lifted warnings pay nothing", async () => {
  const f = fixture();
  for (const trigger of [
    "reply_posted",
    "reply_received",
    "profile_post_created",
    "profile_post_received",
    "warning_received",
  ] as const)
    await f.createRule(trigger);
  f.event("content.created", "post", f.post(f.thread(), 1, "visible", f.author.id));
  f.event("content.created", "profile_post", f.profile("visible", f.author.id));
  f.event("member.warned", "user", f.author.id, { warningId: 1, lifted: true });
  expect(f.balance()).toBe(10);
  expect(f.ledger()).toHaveLength(1);
  await f.replay();
});

describe("visibility and reversals", () => {
  for (const type of ["thread", "post", "profile_post", "profile_post_comment"] as const) {
    test(`${type}: delete, restore, delete, restore uses the stored amount`, async () => {
      const f = fixture();
      const isCreation = type === "thread" || type === "profile_post";
      const rule = await f.createRule(
        type === "thread"
          ? "thread_created"
          : type === "profile_post"
            ? "profile_post_created"
            : "reaction_received",
      );
      const id =
        type === "thread"
          ? f.thread()
          : type === "post"
            ? f.post(f.thread(), 1, "visible", f.author.id)
            : type === "profile_post"
              ? f.profile("visible", f.author.id, f.other.id)
              : f.comment();
      f.event(
        isCreation ? "content.created" : "reaction.added",
        type,
        id,
        isCreation ? {} : { userId: f.other.id, contentUserId: f.author.id },
      );
      expect(f.balance()).toBe(10);
      await execute(f.ctx, creditRulesUpdateOp, f.admin, {
        ruleId: rule.id,
        amount: 500,
        isActive: false,
      });
      for (const state of ["deleted", "visible", "deleted", "visible"]) {
        f.state(type, id, state);
        expect(f.balance()).toBe(state === "visible" ? 10 : 0);
      }
      expect(f.ledger().map((row) => (row as { amount: number }).amount)).toEqual([
        10, -10, 10, -10, 10,
      ]);
      await f.replay();
    });
  }
  for (const type of ["thread", "post", "profile_post"] as const) {
    test(`${type} awaiting approval pays creation rules once on approval`, async () => {
      const f = fixture();
      await f.createRule(
        type === "thread"
          ? "thread_created"
          : type === "post"
            ? "reply_posted"
            : "profile_post_created",
      );
      const id =
        type === "thread"
          ? f.thread("moderated")
          : type === "post"
            ? f.post(f.thread(), 1, "moderated", f.author.id)
            : f.profile("moderated", f.author.id, f.other.id);
      f.event("content.created", type, id);
      expect(f.balance()).toBe(0);
      f.state(type, id, "visible");
      expect(f.balance()).toBe(10);
      expect(f.ledger()).toHaveLength(1);
      await f.replay();
    });
  }

  test("deleted rules retain applications and ids never get reused", async () => {
    const f = fixture();
    const rule = await f.createRule("thread_created", { amount: -10 });
    const id = f.thread();
    f.event("content.created", "thread", id);
    await execute(f.ctx, creditRulesDeleteOp, f.admin, { ruleId: rule.id });
    const next = await f.createRule("registered");
    expect(next.id).toBeGreaterThan(rule.id);
    f.state("thread", id, "deleted");
    expect(f.balance()).toBe(0);
    f.state("thread", id, "visible");
    expect(f.balance()).toBe(-10);
    await f.replay();
  });

  for (const type of ["thread", "post", "profile_post"] as const) {
    for (const hidden of ["deleted", "moderated"]) {
      test(`${type}: ${hidden} content that already had its chance only re-applies stored payments`, async () => {
        const f = fixture();
        const trigger =
          type === "thread"
            ? "thread_created"
            : type === "post"
              ? "reply_posted"
              : "profile_post_created";
        await f.createRule(trigger);
        const inactive = await f.createRule(trigger, { isActive: false });
        // This member has exhausted the limited rule before the target becomes visible.
        const limited = await f.createRule(trigger, { limit: { count: 1, windowHours: 1 } });
        const make = () =>
          type === "thread"
            ? f.thread()
            : type === "post"
              ? f.post(f.thread(), 1, "visible", f.author.id)
              : f.profile("visible", f.author.id, f.other.id);
        f.event("content.created", type, make());
        const id = make();
        f.event("content.created", type, id);
        expect(f.balance()).toBe(30);
        f.state(type, id, hidden);
        expect(f.balance()).toBe(20);
        await execute(f.ctx, creditRulesUpdateOp, f.admin, { ruleId: inactive.id, isActive: true });
        await execute(f.ctx, creditRulesUpdateOp, f.admin, { ruleId: limited.id, limit: null });
        await f.createRule(trigger, { amount: 100 });
        f.ctx.clock.advance(3_600_000);
        f.state(type, id, "visible");
        expect(f.balance()).toBe(30);
        expect(f.ledger()).toHaveLength(5);
      });
    }
  }

  test("delayed creation of moderated content leaves its first chance to the approval event", async () => {
    const f = fixture();
    await f.createRule("thread_created", { limit: { count: 1, windowHours: 1 } });
    const id = f.thread("moderated");
    const created = f.event("content.created", "thread", id);
    f.ctx.clock.advance(3_600_000);
    const approvedAt = f.ctx.now();
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(id);
    const payload = { previousState: "moderated", state: "visible" };
    const eventId = writeTx(f.ctx, () =>
      publishEvent(f.ctx, {
        type: "content.state_changed",
        targetType: "thread",
        targetId: id,
        payload,
      }),
    );
    handleCreditRuleEvent(f.ctx, created);
    expect(f.balance()).toBe(0);
    handleCreditRuleEvent(f.ctx, {
      id: eventId,
      type: "content.state_changed",
      targetType: "thread",
      targetId: id,
      payload,
      createdAt: approvedAt,
    });
    expect(f.balance()).toBe(10);
    expect(f.ctx.sqlite.prepare("SELECT created_at FROM credit_rule_applications").all()).toEqual([
      { created_at: approvedAt },
    ]);
    await f.replay(7_200_000);
  });

  for (const parentState of ["deleted", "moderated"]) {
    test(`a comment under a ${parentState} profile post cannot pay new reactions, but its own restore re-applies`, async () => {
      const f = fixture();
      await f.createRule("reaction_given");
      await f.createRule("reaction_received");
      const parentId = f.profile(parentState);
      const id = f.comment(parentId);
      const reaction = { userId: f.other.id, contentUserId: f.author.id };
      f.event("reaction.added", "profile_post_comment", id, reaction);
      expect(f.ledger()).toHaveLength(0);
      f.state("profile_post", parentId, "visible");
      f.event("reaction.added", "profile_post_comment", id, reaction);
      expect(f.balance()).toBe(10);
      expect(f.balance(f.other.id)).toBe(10);
      f.state("profile_post_comment", id, "deleted");
      f.state("profile_post", parentId, parentState);
      f.state("profile_post_comment", id, "visible");
      expect(f.balance()).toBe(10);
      expect(f.balance(f.other.id)).toBe(10);
      expect(f.ledger()).toHaveLength(6);
      f.event("reaction.added", "profile_post_comment", id, {
        userId: f.third.id,
        contentUserId: f.author.id,
      });
      expect(f.balance()).toBe(10);
      expect(f.balance(f.third.id)).toBe(0);
      await f.replay();
    });
  }

  test("hidden threads prevent new reply payments but hiding only reverses the thread source", async () => {
    const f = fixture();
    for (const trigger of ["thread_created", "reply_posted", "reply_received"] as const)
      await f.createRule(trigger);
    const id = f.thread();
    f.event("content.created", "thread", id);
    f.event("content.created", "post", f.post(id));
    f.state("thread", id, "deleted");
    expect(f.balance()).toBe(10);
    expect(f.balance(f.other.id)).toBe(10);
    f.event("content.created", "post", f.post(id, 2));
    expect(f.balance(f.other.id)).toBe(10);
    f.state("thread", id, "visible");
    expect(f.balance()).toBe(20);
  });

  test("out-of-order events use current content state and older events cannot flip an application", async () => {
    const f = fixture();
    await f.createRule("thread_created");
    const id = f.thread();
    const created = f.event("content.created", "thread", id);
    const deleted = f.state("thread", id, "deleted");
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(id);
    handleCreditRuleEvent(f.ctx, deleted);
    handleCreditRuleEvent(f.ctx, created);
    expect(f.balance()).toBe(0);
    // A newer event reconciles to the current state, despite an obsolete payload.
    f.event("content.deleted", "thread", id, { state: "deleted" });
    expect(f.balance()).toBe(10);
    await f.replay();
  });
});

test("several active rules each pay; inactive rules and rules newer than the event do not", async () => {
  const f = fixture();
  await f.createRule("registered");
  await f.createRule("registered", { amount: -3 });
  await f.createRule("registered", { isActive: false });
  f.event("member.registered", "user", f.author.id);
  expect(f.balance()).toBe(7);
  f.ctx.clock.advance(1);
  await f.createRule("registered", { amount: 100 });
  await f.replay();
  expect(f.balance()).toBe(7);
});

test("a rule never pays an earlier event even when both have the same millisecond timestamp", async () => {
  const f = fixture();
  const oldEvent = f.event("member.registered", "user", f.author.id);
  await f.createRule("registered");
  handleCreditRuleEvent(f.ctx, oldEvent);
  expect(f.balance()).toBe(0);
  expect(f.ledger()).toHaveLength(0);
  f.event("member.registered", "user", f.other.id);
  expect(f.balance(f.other.id)).toBe(10);
});

test("limits include reverted applications and open again for new sources after the window", async () => {
  const f = fixture();
  await f.createRule("thread_created", { limit: { count: 2, windowHours: 1 } });
  const first = f.thread();
  f.event("content.created", "thread", first);
  f.event("content.created", "thread", f.thread());
  f.state("thread", first, "deleted");
  f.event("content.created", "thread", f.thread());
  expect(f.balance()).toBe(10);
  expect(f.ledger()).toHaveLength(3);
  await f.replay();
  f.ctx.clock.advance(3_600_000);
  f.event("content.created", "thread", f.thread());
  expect(f.balance()).toBe(20);
  expect(f.ledger()).toHaveLength(4);
});

test("delayed delivery evaluates limits at event time and excludes later applications", async () => {
  const f = fixture();
  await f.createRule("daily_activity", { limit: { count: 1, windowHours: 1 } });
  const earlierTime = f.ctx.now();
  const earlierId = writeTx(f.ctx, () =>
    publishEvent(f.ctx, {
      type: "member.active_day",
      targetType: "user",
      targetId: f.author.id,
      payload: { day: 1 },
    }),
  );
  f.ctx.clock.advance(1_000);
  f.event("member.active_day", "user", f.author.id, { day: 2 });
  f.ctx.clock.advance(7_200_000);
  const earlier: DomainEvent = {
    id: earlierId,
    type: "member.active_day",
    targetType: "user",
    targetId: f.author.id,
    payload: { day: 1 },
    createdAt: earlierTime,
  };
  handleCreditRuleEvent(f.ctx, earlier);
  expect(f.balance()).toBe(20);
  expect(
    f.ctx.sqlite
      .prepare("SELECT source_id, created_at FROM credit_rule_applications ORDER BY source_id")
      .all(),
  ).toEqual([
    { source_id: 1, created_at: earlierTime },
    { source_id: 2, created_at: earlierTime + 1_000 },
  ]);
  const before = f.ledger();
  handleCreditRuleEvent(f.ctx, earlier);
  expect(f.ledger()).toEqual(before);
  await f.replay();
});

test("forum restrictions filter creation and only allow reactions on matching posts", async () => {
  const f = fixture();
  const elsewhere = insertNode(f.ctx, {});
  for (const trigger of [
    "thread_created",
    "reply_posted",
    "reply_received",
    "reaction_given",
    "reaction_received",
  ] as const)
    await f.createRule(trigger, { nodeIds: [f.forum.id] });
  for (const nodeId of [f.forum.id, elsewhere.id]) {
    const id = f.thread("visible", f.author.id, nodeId);
    f.event("content.created", "thread", id);
    const postId = f.post(id);
    f.event("content.created", "post", postId);
    f.event("reaction.added", "post", postId, { userId: f.author.id, contentUserId: f.other.id });
  }
  for (const [type, id] of [
    ["profile_post", f.profile()],
    ["profile_post_comment", f.comment()],
    ["conversation_message", f.message()],
  ] as const)
    f.event("reaction.added", type, id, { userId: f.author.id, contentUserId: f.other.id });
  expect(f.balance()).toBe(30);
  expect(f.balance(f.other.id)).toBe(20);
  await f.replay();
});

test("reactions in a private conversation pay neither the reactor nor the author", async () => {
  const f = fixture();
  for (const trigger of ["reaction_given", "reaction_received"] as const)
    await f.createRule(trigger);
  const messageId = f.message();
  f.event("reaction.added", "conversation_message", messageId, {
    userId: f.other.id,
    contentUserId: f.author.id,
  });
  expect(f.balance()).toBe(0);
  expect(f.balance(f.other.id)).toBe(0);
  f.event("reaction.added", "profile_post_comment", f.comment(), {
    userId: f.other.id,
    contentUserId: f.author.id,
  });
  expect(f.balance()).toBe(10);
  expect(f.balance(f.other.id)).toBe(10);
  await f.replay();
});

test("a reaction type with a negative score, or an unknown one, pays neither the reactor nor the author", async () => {
  const f = fixture();
  for (const trigger of ["reaction_given", "reaction_received"] as const)
    await f.createRule(trigger);
  const [dislike, like] = [-1, 1].map((score) =>
    Number(
      f.ctx.sqlite
        .prepare("INSERT INTO reaction_types (title, emoji, score) VALUES ('Credits', 'x', ?1)")
        .run(score).lastInsertRowid,
    ),
  );
  const postId = f.post(f.thread(), 1, "visible", f.author.id);
  f.event("reaction.added", "post", postId, {
    userId: f.other.id,
    contentUserId: f.author.id,
    reactionTypeId: dislike,
  });
  expect(f.balance()).toBe(0);
  expect(f.balance(f.other.id)).toBe(0);
  f.event("reaction.added", "post", postId, {
    userId: f.third.id,
    contentUserId: f.author.id,
    reactionTypeId: like,
  });
  expect(f.balance()).toBe(10);
  expect(f.balance(f.third.id)).toBe(10);
  for (const reactionTypeId of [9_999, undefined])
    f.event("reaction.added", "profile_post_comment", f.comment(), {
      userId: f.other.id,
      contentUserId: f.author.id,
      reactionTypeId,
    });
  expect(f.balance()).toBe(10);
  expect(f.balance(f.other.id)).toBe(0);
  await f.replay();
});

test("unreact/react and unfollow/follow never pay twice, but different reactors do", async () => {
  const f = fixture();
  for (const trigger of ["reaction_given", "reaction_received", "followed"] as const)
    await f.createRule(trigger);
  const postId = f.post(f.thread(), 1, "visible", f.author.id);
  for (let i = 0; i < 2; i++) {
    f.event("reaction.added", "post", postId, { userId: f.other.id, contentUserId: f.author.id });
    f.event("member.followed", "user", f.author.id, { followerId: f.other.id });
  }
  expect(f.balance()).toBe(20);
  expect(f.balance(f.other.id)).toBe(10);
  f.event("reaction.added", "post", postId, { userId: f.third.id, contentUserId: f.author.id });
  expect(f.balance()).toBe(30);
  await f.replay();
});

test("revoked grants reverse stored credits and never pay on grant-event replay", async () => {
  const f = fixture();
  await f.createRule("award_received");
  const id = f.grant();
  f.event("award.granted", "user", f.author.id, { memberAwardId: id });
  expect(f.balance()).toBe(10);
  f.ctx.sqlite
    .prepare("UPDATE member_awards SET revoked_at = ?1 WHERE id = ?2")
    .run(f.ctx.now(), id);
  f.event("award.revoked", "user", f.author.id, { memberAwardId: id });
  expect(f.balance()).toBe(0);
  await f.replay();
  const alreadyRevoked = f.grant();
  f.ctx.sqlite
    .prepare("UPDATE member_awards SET revoked_at = ?1 WHERE id = ?2")
    .run(f.ctx.now(), alreadyRevoked);
  f.event("award.granted", "user", f.author.id, { memberAwardId: alreadyRevoked });
  expect(f.ledger()).toHaveLength(2);
});

test("one failing movement rolls back every application, ledger row and balance for the event", async () => {
  const f = fixture();
  await f.createRule("registered", { amount: 1 });
  await f.createRule("registered", { amount: 2 });
  writeTx(f.ctx, () =>
    moveCredits(f.ctx, [
      { userId: f.author.id, amount: Number.MAX_SAFE_INTEGER - 2, type: "event" },
    ]),
  );
  const before = f.ledger();
  expect(() => f.event("member.registered", "user", f.author.id)).toThrow(ConflictError);
  expect(f.balance()).toBe(Number.MAX_SAFE_INTEGER - 2);
  expect(f.ledger()).toEqual(before);
  expect(f.ctx.sqlite.prepare("SELECT id FROM credit_rule_applications").all()).toEqual([]);
});

test("a reply restored while its thread is hidden is re-applied from its own state", async () => {
  const f = fixture();
  await f.createRule("reply_posted");
  const threadId = f.thread();
  const postId = f.post(threadId, 1, "visible", f.other.id);
  f.event("content.created", "post", postId);
  expect(f.balance(f.other.id)).toBe(10);
  f.state("post", postId, "deleted");
  expect(f.balance(f.other.id)).toBe(0);
  f.state("thread", threadId, "deleted");
  f.state("post", postId, "visible");
  expect(f.balance(f.other.id)).toBe(10);
  f.state("thread", threadId, "visible");
  expect(f.balance(f.other.id)).toBe(10);
  expect(f.ledger()).toHaveLength(3);
  await f.replay();
});

test("a second recipient is not paid for a source after the thread owner changes", async () => {
  const f = fixture();
  await f.createRule("reply_received");
  const threadId = f.thread();
  const created = f.event("content.created", "post", f.post(threadId));
  expect(f.balance()).toBe(10);
  f.ctx.sqlite.prepare("UPDATE threads SET user_id = ?1 WHERE id = ?2").run(f.third.id, threadId);
  handleCreditRuleEvent(f.ctx, created);
  expect(f.balance(f.third.id)).toBe(0);
  expect(f.balance()).toBe(10);
  expect(f.ctx.sqlite.prepare("SELECT id FROM credit_rule_applications").all()).toHaveLength(1);
  await f.replay();
});

test("merging a thread away takes back what it paid, through the real operation", async () => {
  const f = fixture();
  await f.createRule("thread_created");
  registerCreditRuleJobs(f.ctx);
  const moderator = userActor(insertUser(f.ctx, { groupId: 3 }));
  const targetOwner = userActor(f.other);
  const sourceOwner = userActor(f.author);
  const target = await execute(f.ctx, threadsCreateOp, targetOwner, {
    nodeId: f.forum.id,
    title: "Target",
    body: "Target",
  });
  const source = await execute(f.ctx, threadsCreateOp, sourceOwner, {
    nodeId: f.forum.id,
    title: "Source",
    body: "Source",
  });
  await dispatchEvents(f.ctx);
  expect(f.balance()).toBe(10);
  expect(f.balance(f.other.id)).toBe(10);
  const merged = await execute(f.ctx, threadsMergeOp, moderator, {
    threadId: target.thread.id,
    sourceThreadIds: [source.thread.id],
  });
  expect(merged.completed).toBe(true);
  await dispatchEvents(f.ctx);
  expect(f.balance()).toBe(0);
  expect(f.balance(f.other.id)).toBe(10);
  const before = f.ledger();
  f.ctx.sqlite
    .prepare("UPDATE event_subscribers SET last_event_id = 0 WHERE name = 'credit-rules'")
    .run();
  await dispatchEvents(f.ctx);
  expect(f.ledger()).toEqual(before);
});

describe("hiding popular content", () => {
  const COUNT = FLIP_BATCH_SIZE * 2 + 200;
  async function popular() {
    const f = fixture();
    await f.createRule("reaction_received");
    const postId = f.post(f.thread(), 1, "visible", f.author.id);
    const insert = f.ctx.sqlite.prepare(
      "INSERT INTO credit_rule_applications (rule_id, user_id, source_type, source_id, source_user_id, amount, state, last_event_id, created_at) VALUES (1, ?1, 'post', ?2, ?3, 10, 'applied', 0, ?4)",
    );
    for (let i = 1; i <= COUNT; i++) insert.run(f.author.id, postId, i, f.ctx.now());
    writeTx(f.ctx, () =>
      moveCredits(f.ctx, [{ userId: f.author.id, amount: COUNT * 10, type: "event" }]),
    );
    const hide = () => {
      f.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(postId);
      const id = writeTx(f.ctx, () =>
        publishEvent(f.ctx, {
          type: "content.deleted",
          targetType: "post",
          targetId: postId,
          payload: { previousState: "visible", state: "deleted" },
        }),
      );
      return {
        id,
        type: "content.deleted",
        targetType: "post",
        targetId: postId,
        payload: { previousState: "visible", state: "deleted" },
        createdAt: f.ctx.now(),
      } satisfies DomainEvent;
    };
    const reverted = () =>
      f.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM credit_rule_applications WHERE state = 'reverted'",
        )
        .get()!.n;
    return { f, hide, reverted };
  }

  test("is flipped in bounded batches, once, and a replay changes nothing", async () => {
    const { f, hide, reverted } = await popular();
    const event = hide();
    const pending = handleCreditRuleEvent(f.ctx, event);
    expect(pending).toBeInstanceOf(Promise);
    // The first transaction committed only one batch.
    expect(reverted()).toBe(FLIP_BATCH_SIZE);
    expect(f.balance()).toBe((COUNT - FLIP_BATCH_SIZE) * 10);
    await pending;
    expect(reverted()).toBe(COUNT);
    expect(f.balance()).toBe(0);
    expect(f.ledger().filter((row) => (row as { amount: number }).amount < 0)).toHaveLength(COUNT);
    const before = f.ledger();
    await handleCreditRuleEvent(f.ctx, event);
    expect(f.ledger()).toEqual(before);
  });

  test("an interrupted flip resumes when the event is handled again", async () => {
    const { f, hide, reverted } = await popular();
    f.ctx.sqlite.exec(
      `CREATE TRIGGER stop_flip BEFORE UPDATE ON credit_rule_applications WHEN NEW.source_user_id = ${FLIP_BATCH_SIZE + 5} AND NEW.state = 'reverted' BEGIN SELECT RAISE(ABORT, 'interrupted'); END`,
    );
    const event = hide();
    await expect(Promise.resolve(handleCreditRuleEvent(f.ctx, event))).rejects.toThrow(
      "interrupted",
    );
    expect(reverted()).toBe(FLIP_BATCH_SIZE);
    expect(f.balance()).toBe((COUNT - FLIP_BATCH_SIZE) * 10);
    f.ctx.sqlite.exec("DROP TRIGGER stop_flip");
    await handleCreditRuleEvent(f.ctx, event);
    expect(reverted()).toBe(COUNT);
    expect(f.balance()).toBe(0);
    expect(f.ledger().filter((row) => (row as { amount: number }).amount < 0)).toHaveLength(COUNT);
    const before = f.ledger();
    await handleCreditRuleEvent(f.ctx, event);
    expect(f.ledger()).toEqual(before);
  });
});
