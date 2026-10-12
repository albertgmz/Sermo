import { afterEach, describe, expect, test } from "bun:test";
import { CREDIT_TRIGGERS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { type DomainEvent, dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { moveCredits } from "../../shared/credits";
import { createTestContext, insertNode, insertUser, userActor } from "../../testing";
import {
  creditRulesCreateOp,
  creditRulesDeleteOp,
  creditRulesUpdateOp,
  registerCreditRuleJobs,
} from ".";
import type { Trigger } from "./storage";
import { handleCreditRuleEvent } from "./subscriber";

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
  function comment() {
    return Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Body', '<p>Body</p>')",
        )
        .run(profile(), author.id, ctx.now()).lastInsertRowid,
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
    ctx.sqlite.prepare(`UPDATE ${tables[type]} SET state = ?1 WHERE id = ?2`).run(next, id);
    return event(next === "deleted" ? "content.deleted" : "content.state_changed", type, id, {
      state: next,
    });
  }
  async function replay() {
    const before = ledger();
    const balances = ctx.sqlite.prepare("SELECT id, credits FROM users ORDER BY id").all();
    for (const item of events.toReversed()) handleCreditRuleEvent(ctx, item);
    registerCreditRuleJobs(ctx);
    await dispatchEvents(ctx);
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
  await f.replay();
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
  for (const type of [
    "thread",
    "post",
    "profile_post",
    "profile_post_comment",
    "conversation_message",
  ] as const) {
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
              : type === "profile_post_comment"
                ? f.comment()
                : f.message();
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
