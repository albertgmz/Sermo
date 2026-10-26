import { afterEach, describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { createTestContext, insertNode, insertUser, userActor } from "../../testing";
import { registerAwardJobs } from "../awards";
import { LEASE_MS, runDueJobs } from "../jobs/queue";
import { registerNotificationJobs } from "../notifications";
import { registerPromotionJobs } from "../promotions";
import { BACKFILL_CHUNK, BACKFILL_JOB } from "./backfill";
import { registerCreditRuleJobs } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

/** A UTC time, e.g. "2025-03-01" or "2025-03-01T10:00". */
const at = (time: string) => Date.parse(time.length === 10 ? `${time}T12:00Z` : `${time}Z`);
const RANGE = { from: "2020-01-01", until: "2026-06-01", cap: 20_000 };

type Run = {
  id: number;
  state: string;
  summary: {
    members: number;
    credits: number;
    heldAtCap: number;
    byTrigger: { trigger: string; credits: number }[];
    paid: { p50: number; p90: number; p99: number; max: number };
    top: { user: { id: number; username: string }; total: number; paid: number }[];
  } | null;
};

function world() {
  // The rules are created on 2026-01-01 (the test clock); the activity is older.
  const ctx = createTestContext();
  contexts.push(ctx);
  registerCreditRuleJobs(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const forum = insertNode(ctx, {});
  const call = (name: string, input: unknown = {}, actor = admin) =>
    execute(ctx, getOperation(`creditRules.${name}`), actor, input) as Promise<never>;
  const rule = (trigger: string, extra: Record<string, unknown> = {}) =>
    call("create", { title: trigger, trigger, amount: 10, ...extra }) as Promise<{ id: number }>;
  const insert = (sql: string, ...params: (string | number | null)[]) =>
    Number(ctx.sqlite.prepare(sql).run(...params).lastInsertRowid);
  const sql = <T>(text: string, ...params: (string | number | null)[]) =>
    ctx.sqlite.prepare<T, (string | number | null)[]>(text).all(...params);
  const positions = new Map<number, number>();
  const body = (postId: number, text: string) =>
    insert(
      "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (?1, ?2, ?2, ?2)",
      postId,
      text,
    );
  function reply(
    threadId: number,
    userId: number,
    time: string,
    { state = "visible", text = "A reply" } = {},
  ) {
    const position = positions.get(threadId) ?? 0;
    positions.set(threadId, position + 1);
    const id = insert(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      threadId,
      userId,
      position,
      state,
      at(time),
    );
    body(id, text);
    return id;
  }
  function thread(
    userId: number,
    time: string,
    { state = "visible", nodeId = forum.id, text = "A first post" } = {},
  ) {
    const id = insert(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'T', ?3, ?4, ?4, ?2)",
      nodeId,
      userId,
      state,
      at(time),
    );
    const first = reply(id, userId, time, { text });
    ctx.sqlite.prepare("UPDATE threads SET first_post_id = ?1 WHERE id = ?2").run(first, id);
    return id;
  }
  const profilePost = (ownerId: number, userId: number, time: string, state = "visible") =>
    insert(
      "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, 'Body', 'Body')",
      ownerId,
      userId,
      state,
      at(time),
    );
  const comment = (profileId: number, userId: number, time: string) =>
    insert(
      "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Body', 'Body')",
      profileId,
      userId,
      at(time),
    );
  function message(userId: number, time: string) {
    const conversation = insert(
      "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('C', ?1, ?2, ?2, ?1)",
      userId,
      at(time),
    );
    return insert(
      "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 'Body', 'Body')",
      conversation,
      userId,
      at(time),
    );
  }
  const dislike = () =>
    insert("INSERT INTO reaction_types (title, emoji, score) VALUES ('Dislike', 'x', -1)");
  // The seeded Like is type 1 (score 1).
  const react = (
    type: string,
    contentId: number,
    userId: number,
    authorId: number,
    time: string,
    typeId = 1,
  ) =>
    insert(
      "INSERT INTO reactions (content_type, content_id, user_id, content_user_id, reaction_type_id, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
      type,
      contentId,
      userId,
      authorId,
      typeId,
      at(time),
    );
  const follow = (userId: number, followedId: number, time: string) =>
    insert(
      "INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)",
      userId,
      followedId,
      at(time),
    );
  function grant(userId: number, time: string, revoked = false) {
    const award = insert(
      "INSERT INTO awards (name, tier, created_at, updated_at) VALUES ('A', 'bronze', 0, 0)",
    );
    return insert(
      "INSERT INTO member_awards (user_id, award_id, xp, credits, created_at, revoked_at) VALUES (?1, ?2, 0, 0, ?3, ?4)",
      userId,
      award,
      at(time),
      revoked ? at(time) : null,
    );
  }
  const drain = async () => {
    while (await runDueJobs(ctx, { limit: 1 })) {}
  };
  const status = () =>
    call("backfillStatus") as Promise<{
      latest: Run | null;
      paidRange: { from: string; until: string } | null;
    }>;
  async function preview(input: Partial<typeof RANGE> = {}): Promise<Run> {
    await call("backfillPreview", { ...RANGE, ...input });
    await drain();
    return (await status()).latest!;
  }
  async function apply(previewId: number): Promise<Run> {
    await call("backfillApply", { previewId });
    await drain();
    return (await status()).latest!;
  }
  /** The members a run counted: user id to [total, paid]. */
  const results = (runId: number) =>
    Object.fromEntries(
      sql<{ user_id: number; total: number; paid: number }>(
        "SELECT user_id, total, paid FROM credit_backfill_members WHERE run_id = ?1 ORDER BY user_id",
        runId,
      ).map((row) => [row.user_id, [row.total, row.paid]]),
    );
  const ledger = () =>
    sql<{ user_id: number; amount: number; type: string }>(
      "SELECT user_id, amount, type, source_type, reason, actor_id FROM credit_transactions ORDER BY id",
    );
  const balance = (userId: number) =>
    sql<{ credits: number }>("SELECT credits FROM users WHERE id = ?1", userId)[0]!.credits;
  return {
    ctx,
    admin,
    adminUser,
    forum,
    call,
    rule,
    sql,
    thread,
    reply,
    profilePost,
    comment,
    message,
    dislike,
    react,
    follow,
    grant,
    drain,
    status,
    preview,
    apply,
    results,
    ledger,
    balance,
  };
}
type World = ReturnType<typeof world>;

describe("paying past activity", () => {
  test("a preview pays nothing and reports what the apply then pays", async () => {
    const w = world();
    const [a, b, c] = [insertUser(w.ctx), insertUser(w.ctx), insertUser(w.ctx)];
    await w.rule("thread_created", { amount: 5 });
    await w.rule("reply_received", { amount: 2 });
    const t = w.thread(a.id, "2024-05-01");
    w.reply(t, b.id, "2024-05-02");
    w.reply(t, c.id, "2024-05-03");
    w.thread(b.id, "2023-01-01");

    const previewed = await w.preview();
    expect(previewed.state).toBe("done");
    expect(w.ledger()).toEqual([]);
    expect([a, b, c].map((m) => w.balance(m.id))).toEqual([0, 0, 0]);
    expect(previewed.summary).toEqual({
      members: 2,
      credits: 14,
      heldAtCap: 0,
      byTrigger: expect.arrayContaining([
        { trigger: "thread_created", credits: 10 },
        { trigger: "reply_received", credits: 4 },
        { trigger: "followed", credits: 0 },
      ]),
      paid: { p50: 5, p90: 9, p99: 9, max: 9 },
      top: [
        { user: { id: a.id, username: a.username }, total: 9, paid: 9 },
        { user: { id: b.id, username: b.username }, total: 5, paid: 5 },
      ],
    });

    const applied = await w.apply(previewed.id);
    expect(applied).toMatchObject({ state: "done", previewId: previewed.id, ...RANGE });
    expect(applied.summary).toEqual(previewed.summary);
    expect(w.results(applied.id)).toEqual(w.results(previewed.id));
    // One ledger row per member, by the system, with no words stored.
    expect(w.ledger()).toEqual([
      {
        user_id: a.id,
        amount: 9,
        type: "backfill",
        source_type: "credit_backfill",
        reason: "",
        actor_id: null,
      },
      {
        user_id: b.id,
        amount: 5,
        type: "backfill",
        source_type: "credit_backfill",
        reason: "",
        actor_id: null,
      },
    ] as never);
    expect([a, b, c].map((m) => w.balance(m.id))).toEqual([9, 5, 0]);
    // The live rules paid nothing more: imported activity has no events.
    expect(w.sql("SELECT * FROM credit_rule_applications")).toEqual([]);
  });

  // Each case: the rule's trigger, the activity, and what each member is paid (all others: 0).
  const cases: Record<string, (w: World) => Record<number, number>> = {
    thread_created(w) {
      const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
      w.thread(a, "2024-01-01");
      w.thread(a, "2024-01-02", { state: "deleted" });
      w.thread(a, "2024-01-03", { state: "moderated" });
      w.thread(GUEST_ACCOUNT_ID, "2024-01-04");
      w.thread(b, "2026-02-01"); // after the rule was created
      return { [a]: 10 };
    },
    reply_posted(w) {
      const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
      const open = w.thread(b, "2024-01-01");
      w.reply(open, a, "2024-01-02");
      w.reply(open, a, "2024-01-03", { state: "deleted" });
      const hidden = w.thread(b, "2024-01-01", { state: "deleted" });
      w.reply(hidden, a, "2024-01-02");
      // Starting a thread is not a reply.
      w.thread(a, "2024-01-05");
      return { [a]: 10 };
    },
    reply_received(w) {
      const [a, b, c] = [insertUser(w.ctx).id, insertUser(w.ctx).id, insertUser(w.ctx).id];
      const own = w.thread(a, "2024-01-01");
      w.reply(own, b, "2024-01-02");
      w.reply(own, c, "2024-01-03");
      w.reply(own, a, "2024-01-04"); // self reply
      w.reply(own, GUEST_ACCOUNT_ID, "2024-01-05");
      w.reply(own, b, "2024-01-06", { state: "moderated" });
      const hidden = w.thread(c, "2024-01-01", { state: "deleted" });
      w.reply(hidden, b, "2024-01-02");
      return { [a]: 20 };
    },
    reaction_given(w) {
      const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
      const dislike = w.dislike();
      const t = w.thread(b, "2024-01-01");
      const post = w.reply(t, b, "2024-01-02");
      const another = w.reply(t, b, "2024-01-02");
      const profile = w.profilePost(b, b, "2024-01-01");
      const comment = w.comment(profile, b, "2024-01-01");
      const hidden = w.thread(b, "2024-01-01", { state: "deleted" });
      const hiddenPost = w.reply(hidden, b, "2024-01-02");
      w.react("post", post, a, b, "2024-01-03");
      w.react("post", another, a, b, "2024-01-03", dislike);
      w.react("profile_post", profile, a, b, "2024-01-03");
      w.react("profile_post_comment", comment, a, b, "2024-01-03");
      w.react("conversation_message", w.message(b, "2024-01-01"), a, b, "2024-01-03");
      w.react("post", hiddenPost, a, b, "2024-01-03");
      return { [a]: 30 };
    },
    reaction_received(w) {
      const [a, b, c] = [insertUser(w.ctx).id, insertUser(w.ctx).id, insertUser(w.ctx).id];
      const dislike = w.dislike();
      const t = w.thread(a, "2024-01-01");
      const post = w.reply(t, a, "2024-01-02");
      const disliked = w.reply(t, a, "2024-01-02");
      const hiddenPost = w.reply(t, a, "2024-01-02", { state: "deleted" });
      w.react("post", post, b, a, "2024-01-03");
      w.react("post", post, c, a, "2024-01-03");
      w.react("post", disliked, b, a, "2024-01-03", dislike);
      w.react("post", hiddenPost, b, a, "2024-01-03");
      w.react("conversation_message", w.message(a, "2024-01-01"), b, a, "2024-01-03");
      w.react("post", post, a, GUEST_ACCOUNT_ID, "2024-01-03");
      return { [a]: 20 };
    },
    profile_post_created(w) {
      const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
      w.profilePost(b, a, "2024-01-01");
      w.profilePost(a, a, "2024-01-01"); // on their own profile
      w.profilePost(b, a, "2024-01-01", "deleted");
      return { [a]: 10 };
    },
    profile_post_received(w) {
      const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
      w.profilePost(a, b, "2024-01-01");
      w.profilePost(a, a, "2024-01-01");
      w.profilePost(a, b, "2024-01-01", "moderated");
      return { [a]: 10 };
    },
    followed(w) {
      const [a, b, c] = [insertUser(w.ctx).id, insertUser(w.ctx).id, insertUser(w.ctx).id];
      w.follow(b, a, "2024-01-01");
      w.follow(c, a, "2024-01-01");
      w.follow(a, b, "2026-03-01"); // after the rule was created
      return { [a]: 20 };
    },
    award_received(w) {
      const a = insertUser(w.ctx).id;
      w.grant(a, "2024-01-01");
      w.grant(a, "2024-01-01", true);
      return { [a]: 10 };
    },
    registered(w) {
      insertUser(w.ctx);
      return {};
    },
  };
  for (const [trigger, setup] of Object.entries(cases))
    test(`${trigger}: pays what its rule would have paid, and nothing for the excluded cases`, async () => {
      const w = world();
      await w.rule(trigger);
      const expected = setup(w);
      const run = await w.preview();
      expect(
        Object.fromEntries(
          Object.entries(w.results(run.id)).map(([id, [total]]) => [Number(id), total]),
        ),
      ).toEqual(expected);
    });

  test("only the dates asked for, and never after the rule was created", async () => {
    const w = world();
    const a = insertUser(w.ctx).id;
    await w.rule("thread_created", { amount: 1 });
    w.thread(a, "2024-12-31T23:59");
    w.thread(a, "2025-01-01T00:00"); // the from day counts
    w.thread(a, "2025-06-30T23:59");
    w.thread(a, "2025-07-01T00:00"); // the until day does not
    w.thread(a, "2026-01-02");
    const run = await w.preview({ from: "2025-01-01", until: "2025-07-01" });
    expect(w.results(run.id)).toEqual({ [a]: [2, 2] });
    const later = await w.preview({ until: "2027-01-01" });
    expect(w.results(later.id)).toEqual({ [a]: [4, 4] });
  });

  test("each rule's forums, filters and amount apply; inactive rules and erased members get nothing", async () => {
    const w = world();
    const [a, erased] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
    const other = insertNode(w.ctx, {}).id;
    await w.rule("thread_created", { amount: 3, nodeIds: [w.forum.id] });
    await w.rule("thread_created", {
      amount: 100,
      filters: { createdFrom: "2024-03-01", minLength: 10 },
    });
    await w.rule("thread_created", { amount: 1000, isActive: false });
    w.thread(a, "2024-02-01", { text: "A long enough first post" }); // 3: before createdFrom
    w.thread(a, "2024-04-01", { nodeId: other, text: "Too short" }); // nothing
    w.thread(a, "2024-04-02", { nodeId: other, text: "A long enough first post" }); // 100
    w.thread(erased, "2024-04-02");
    w.sql("UPDATE users SET erased_at = 1 WHERE id = ?1", erased);
    const run = await w.preview();
    expect(w.results(run.id)).toEqual({ [a]: [103, 103] });
  });

  test("a source the live rule already paid is not paid again", async () => {
    const w = world();
    const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
    const rule = await w.rule("reply_received");
    const t = w.thread(a, "2024-01-01");
    const paid = w.reply(t, b, "2024-01-02");
    w.reply(t, b, "2024-01-03");
    // Approved after the rule was created: the subscriber paid it then.
    w.sql(
      "INSERT INTO credit_rule_applications (rule_id, user_id, source_type, source_id, source_user_id, amount, created_at) VALUES (?1, ?2, 'post', ?3, ?4, 10, 0)",
      rule.id,
      a,
      paid,
      b,
    );
    const run = await w.preview();
    expect(w.results(run.id)).toEqual({ [a]: [10, 10] });
  });

  test("a rule's window limit holds: seven threads in a day with a limit of five in 24 hours pay five", async () => {
    const w = world();
    const a = insertUser(w.ctx).id;
    await w.rule("thread_created", { limit: { count: 5, windowHours: 24 } });
    for (let hour = 10; hour < 17; hour++) w.thread(a, `2024-01-01T${hour}:00`);
    // The window ends at each source: the first thread of the day is out of it 24 hours later.
    w.thread(a, "2024-01-02T10:00");
    w.thread(a, "2024-01-02T10:30");
    const run = await w.preview();
    expect(w.results(run.id)).toEqual({ [a]: [60, 60] });
  });

  test("the cap holds; a second apply pays nothing and a higher cap pays only the difference", async () => {
    const w = world();
    const [a, b] = [insertUser(w.ctx).id, insertUser(w.ctx).id];
    await w.rule("thread_created");
    for (let day = 1; day <= 3; day++) w.thread(a, `2024-01-0${day}`);
    w.thread(b, "2024-01-01");
    const first = await w.apply((await w.preview({ cap: 25 })).id);
    expect(first.summary).toMatchObject({ members: 2, credits: 35, heldAtCap: 1 });
    expect([w.balance(a), w.balance(b)]).toEqual([25, 10]);

    const again = await w.preview({ cap: 25 });
    expect(w.results(again.id)).toEqual({ [a]: [30, 0], [b]: [10, 0] });
    expect(again.summary).toMatchObject({ members: 0, credits: 0, heldAtCap: 1 });
    await w.apply(again.id);
    expect(w.ledger()).toHaveLength(2);

    const higher = await w.apply((await w.preview({ cap: 100 })).id);
    expect(w.results(higher.id)).toEqual({ [a]: [30, 5], [b]: [10, 0] });
    expect([w.balance(a), w.balance(b)]).toEqual([30, 10]);
    expect(w.ledger().map((row) => row.amount)).toEqual([25, 10, 5]);
  });

  test("a range that does not include the dates already paid is refused", async () => {
    const w = world();
    const a = insertUser(w.ctx).id;
    await w.rule("thread_created");
    w.thread(a, "2021-01-01");
    // A preview that was never paid does not bind later dates.
    await w.preview({ from: "2019-01-01" });
    await w.apply((await w.preview()).id);
    expect((await w.status()).paidRange).toEqual({ from: RANGE.from, until: RANGE.until });
    for (const dates of [{ from: "2020-01-02" }, { until: "2026-05-31" }])
      await expect(w.call("backfillPreview", { ...RANGE, ...dates })).rejects.toThrow(
        new ConflictError(
          "The dates must include 2020-01-01 to 2026-06-01, the dates already paid.",
        ),
      );
    const wider = await w.preview({ from: "2019-01-01", until: "2026-07-01" });
    expect(wider.state).toBe("done");
    // Paying a narrower preview made before is refused too.
    const narrow = await w.preview({ from: "2020-01-01" });
    await w.apply((await w.preview({ from: "2019-01-01", until: "2026-07-01" })).id);
    await expect(w.call("backfillApply", { previewId: narrow.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("the percentiles of what members are paid are exact, and the top lists the most paid", async () => {
    const w = world();
    await w.rule("thread_created", { amount: 1 });
    const members = Array.from({ length: 10 }, () => insertUser(w.ctx));
    members.forEach((member, index) => {
      for (let n = 0; n <= index; n++)
        w.thread(member.id, `2024-02-${String(n + 1).padStart(2, "0")}`);
    });
    const run = await w.preview();
    expect(run.summary?.paid).toEqual({ p50: 5, p90: 9, p99: 10, max: 10 });
    expect(run.summary?.top.map((top) => top.paid)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(run.summary?.top[0]?.user.id).toBe(members[9]!.id);
  });

  test("an apply interrupted in a chunk and resumed pays every member exactly once", async () => {
    const w = world();
    await w.rule("thread_created", { amount: 7 });
    const members = Array.from({ length: BACKFILL_CHUNK + 20 }, () => insertUser(w.ctx).id);
    for (const id of members) w.thread(id, "2024-01-01");
    const previewed = await w.preview();
    // The second chunk fails on one member's ledger row, as a crash in the middle would.
    const victim = members[BACKFILL_CHUNK + 5]!;
    w.ctx.sqlite.run(
      `CREATE TEMP TRIGGER crash BEFORE INSERT ON credit_transactions WHEN NEW.user_id = ${victim} BEGIN SELECT RAISE(ABORT, 'crash'); END`,
    );
    await w.call("backfillApply", { previewId: previewed.id });
    await runDueJobs(w.ctx, { limit: 2 });
    expect(new Set(w.ledger().map((row) => row.user_id)).size).toBe(BACKFILL_CHUNK - 1);
    expect(w.sql("SELECT last_error FROM jobs WHERE type = ?1", BACKFILL_JOB)).toContainEqual({
      last_error: "crash",
    });
    w.ctx.sqlite.run("DROP TRIGGER crash");
    // A claim that died with the process: its lease runs out and the chunk runs again.
    w.ctx.clock.advance(30_000);
    w.sql(
      "UPDATE jobs SET status = 'running', locked_until = ?1 WHERE type = ?2 AND status = 'pending'",
      w.ctx.now() + LEASE_MS,
      BACKFILL_JOB,
    );
    w.ctx.clock.advance(LEASE_MS + 1);
    await w.drain();
    const latest = (await w.status()).latest!;
    expect(latest.state).toBe("done");
    const rows = w.ledger();
    expect(rows.map((row) => row.user_id)).toEqual(members);
    expect(rows.every((row) => row.amount === 7)).toBe(true);
    expect(latest.summary).toEqual(previewed.summary);
    // The first chunk delivered again (a duplicate job) pays nothing more.
    w.sql(
      "INSERT INTO jobs (type, payload, run_at, created_at, updated_at) VALUES (?1, ?2, 0, 0, 0)",
      BACKFILL_JOB,
      JSON.stringify({ runId: latest.id, after: 0 }),
    );
    await w.drain();
    expect(w.ledger()).toHaveLength(members.length);
  });

  test("balance-based awards follow the payment; no member is notified of it", async () => {
    const w = world();
    registerAwardJobs(w.ctx);
    registerPromotionJobs(w.ctx);
    registerNotificationJobs(w.ctx);
    const a = insertUser(w.ctx).id;
    await w.rule("thread_created", { amount: 50 });
    const award = (await execute(w.ctx, getOperation("awards.create"), w.admin, {
      name: "Rich",
      tier: "bronze",
      rule: { match: "all", conditions: [{ criterion: "credits_at_least", value: 50 }] },
    })) as { id: number };
    w.thread(a, "2024-01-01");
    await w.apply((await w.preview()).id);
    for (let i = 0; i < 20 && (await dispatchEvents(w.ctx)) > 0; i++) await w.drain();
    expect(
      w.sql("SELECT award_id FROM member_awards WHERE user_id = ?1 AND revoked_at IS NULL", a),
    ).toEqual([{ award_id: award.id }]);
    expect(w.sql("SELECT * FROM notifications WHERE user_id = ?1", a)).toEqual([]);
    expect(w.sql("SELECT * FROM jobs WHERE type = 'notifications.fanout'")).toEqual([]);
  });

  test("one run at a time, only a finished preview is paid, and the dates must be in order", async () => {
    const w = world();
    insertUser(w.ctx);
    await w.rule("thread_created");
    const started = (await w.call("backfillPreview", RANGE)) as Run;
    expect(started).toMatchObject({
      state: "running",
      mode: "preview",
      progress: 0,
      summary: null,
    });
    await expect(w.call("backfillPreview", RANGE)).rejects.toThrow(
      new ConflictError("A payment of past activity is under way."),
    );
    await expect(w.call("backfillApply", { previewId: started.id })).rejects.toThrow(
      new ConflictError("Only a finished preview can be paid."),
    );
    await w.drain();
    await w.call("backfillPreview", RANGE);
    await expect(w.call("backfillApply", { previewId: started.id })).rejects.toThrow(
      new ConflictError("A payment of past activity is under way."),
    );
    await w.drain();
    await expect(w.call("backfillApply", { previewId: started.id + 5 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const applying = (await w.call("backfillApply", { previewId: started.id })) as Run;
    await w.drain();
    await expect(w.call("backfillApply", { previewId: applying.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      w.call("backfillPreview", { ...RANGE, from: "2026-06-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a run stops when the administrator who started it can no longer manage credit rules", async () => {
    const w = world();
    insertUser(w.ctx);
    await w.rule("thread_created");
    await w.call("backfillPreview", RANGE);
    w.sql("UPDATE users SET group_id = 2 WHERE id = ?1", w.adminUser.id);
    await w.drain();
    const other = userActor(insertUser(w.ctx, { groupId: 4 }));
    expect(((await w.call("backfillStatus", {}, other)) as { latest: Run }).latest).toMatchObject({
      state: "failed",
      error: "The administrator who started the run can no longer manage credit rules.",
    });
  });

  for (const name of ["backfillPreview", "backfillApply", "backfillStatus"])
    test(`${name} requires admin.creditRules`, async () => {
      const w = world();
      const input =
        name === "backfillPreview" ? RANGE : name === "backfillApply" ? { previewId: 1 } : {};
      const member = userActor(insertUser(w.ctx));
      const moderator = userActor(insertUser(w.ctx, { groupId: 3 }));
      await expect(w.call(name, input, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(w.call(name, input, member)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.call(name, input, moderator)).rejects.toBeInstanceOf(ForbiddenError);
    });
});
